// Explicit, read-only integration check. No Telegram message, Redis writes or deployment.
import assert from 'node:assert/strict';
import { MobileSource } from '../notifier/source.js';
import { Engine } from '../notifier/engine.js';
import { caption } from '../notifier/telegram.js';
const query = process.argv[2] || 'elado+haz+kecsked';
const source = new MobileSource({
    urlTemplate: process.env.INGATLAN_SEARCH_URL_TEMPLATE || undefined,
    headers: JSON.parse(process.env.INGATLAN_API_HEADERS_JSON || '{}'),
    maxPages: Number(process.env.MAX_SCAN_PAGES || 20),
});
let state = { version: 1, searches: {}, seen: {}, delivered: {}, properties: {}, outbox: {} };
let held = false;
const store = {
    async acquire() { if (held) return null; held = true; return 'live-check'; },
    async load() { return structuredClone(state); },
    async save(value) { assert.equal(held, true); state = structuredClone(value); },
    async release() { held = false; },
};
const wouldSend = [];
const telegram = { async send(chat, ad) { wouldSend.push({ chat, id: ad.id, caption: caption(ad) }); } };
const engine = new Engine({ source, store, telegram, searches: [{ id: 'live-check', query, chatIds: ['0'] }] });
try {
    const started = Date.now();
    const first = await engine.run();
    assert.equal(first.bootstrapped, 1);
    assert.equal(first.sent, 0);
    assert.ok(Object.keys(state.seen).length > 0, 'Expected real listings for this integration query');
    const baselineCount = Object.keys(state.seen).length;
    const second = await engine.run();
    console.log(JSON.stringify({ status: 'ok', query, baselineCount, baselineSent: first.sent,
        secondScanNewEvents: second.queued, simulatedDeliveries: wouldSend.length,
        elapsedMs: Date.now() - started, realTelegramMessages: 0,
        note: 'Two live API scans; simulated delivery sink. Existing ads are not sent as new.' }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'LIVE_INTEGRATION_FAILED', httpStatus: error.status }));
    process.exitCode = 1;
}
