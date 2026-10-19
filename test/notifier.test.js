import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../notifier/engine.js';
import { normalizeAd, propertyKey, matches } from '../notifier/model.js';
import { MobileSource } from '../notifier/source.js';
import { Telegram, caption } from '../notifier/telegram.js';
import { RedisStore } from '../notifier/store.js';
import { config } from '../notifier/config.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

const signal = () => AbortSignal.timeout(10000);
const raw = (id = 1, extra = {}) => ({ id, city: 'Tatabánya', addressTitle: 'Tatabánya, Teszt utca',
    listingOwnerType: 'PRIVATE', priceHuf: 45000000, price: '45 millió Ft', areaSizeSqm: 60, roomCount: '2',
    photos: [{ url: 'https://images.example/one.jpg' }], properties: [{ name: 'Ingatlan állapota', value: 'Jó állapotú' }], ...extra });
const ad = (id = 1, extra = {}) => normalizeAd(raw(id, extra));
class MemoryStore {
    state = { version: 1, searches: {}, seen: {}, properties: {}, delivered: {}, outbox: {} };
    lock = null;
    async acquire() { if (this.lock) return null; this.lock = 'lease'; return this.lock; }
    async load() { return structuredClone(this.state); }
    async save(state, token) { assert.equal(token, this.lock); this.state = structuredClone(state); }
    async release(token) { assert.equal(token, this.lock); this.lock = null; }
}
function setup(options = {}) {
    const store = new MemoryStore();
    const source = { ads: [], calls: 0, async scan() { this.calls++; return this.ads; } };
    const telegram = { sent: [], async send(chat, item) { this.sent.push([chat, item]); } };
    const searches = [{ id: 'tata', query: 'elado+lakas+tatabanya', chatIds: ['123'] }];
    let time = Date.now();
    const engine = new Engine({ store, source, telegram, searches, clock: () => time, ...options });
    return { engine, store, source, telegram, searches, advance: ms => { time += ms; } };
}
const template = 'https://mobile-gateway.ingatlan.com/unverified/users/ads/search/{query}?page={page}';
const page = (list, pages = 1, totalFound = list.length) => new Response(JSON.stringify({ status: 'success', data: { list, pages, totalFound } }), { headers: { 'Content-Type': 'application/json' } });

test('bootstrap is silent; next new private ad sends once, even after price changes', async () => {
    const x = setup(); x.source.ads = [ad(1)];
    assert.equal((await x.engine.run(signal())).bootstrapped, 1);
    assert.equal(x.telegram.sent.length, 0);
    x.source.ads = [ad(1), ad(2)];
    assert.equal((await x.engine.run(signal())).sent, 1);
    x.source.ads = [ad(1), ad(2, { priceHuf: 42000000 })];
    assert.equal((await x.engine.run(signal())).sent, 0);
    assert.equal(x.telegram.sent[0][1].id, '2');
});
test('office, unknown and inactive listings are not sent', async () => {
    const x = setup(); await x.engine.run(signal());
    x.source.ads = [ad(1, { listingOwnerType: 'OFFICE' }), ad(2, { listingOwnerType: '' }), ad(3, { inactive: true })];
    assert.equal((await x.engine.run(signal())).sent, 0);
});
test('all distinct recipients receive the same new listing; shared query is scanned once', async () => {
    const x = setup(); x.searches.push({ id: 'other', query: x.searches[0].query, chatIds: ['456'] });
    await x.engine.run(signal()); x.source.calls = 0; x.source.ads = [ad(1)];
    assert.equal((await x.engine.run(signal())).sent, 2);
    assert.equal(x.source.calls, 1);
    assert.deepEqual(x.telegram.sent.map(([chat]) => chat), ['123', '456']);
});
test('overlapping searches to the same chat send one message', async () => {
    const x = setup(); x.searches.push({ id: 'second', query: 'elado+haz+tatabanya', chatIds: ['123'] });
    await x.engine.run(signal()); x.source.ads = [ad(1)];
    assert.equal((await x.engine.run(signal())).sent, 1);
});
test('incomplete bootstrap leaves state untouched and releases lock', async () => {
    const x = setup(); x.source.scan = async () => { throw new Error('SOURCE_INCOMPLETE'); };
    await assert.rejects(x.engine.run(signal()), /SOURCE_INCOMPLETE/);
    assert.deepEqual(x.store.state.searches, {}); assert.equal(x.store.lock, null);
});
test('outbox is persisted before send, and failed delivery survives restart', async () => {
    const x = setup(); await x.engine.run(signal()); x.source.ads = [ad(1)];
    x.telegram.send = async () => { assert.equal(Object.keys(x.store.state.outbox).length, 1); throw new Error('fail'); };
    assert.equal((await x.engine.run(signal())).failed, 1);
    assert.equal(Object.keys(x.store.state.outbox).length, 1);
    x.advance(120000);
    const sent = [];
    const restarted = new Engine({ store: x.store, source: x.source, searches: x.searches,
        telegram: { send: async (...args) => sent.push(args) }, clock: () => Date.now() + 120000 });
    assert.equal((await restarted.run(signal())).sent, 1);
    assert.equal(sent.length, 1); assert.equal(Object.keys(x.store.state.outbox).length, 0);
});
test('Telegram retry_after is honored without losing outbox entry', async () => {
    const x = setup(); await x.engine.run(signal()); x.source.ads = [ad(1)];
    x.telegram.send = async () => { throw Object.assign(new Error('rate'), { retryAfter: 300 }); };
    await x.engine.run(signal()); x.advance(120000);
    assert.equal((await x.engine.run(signal())).failed, 0);
    assert.equal(Object.keys(x.store.state.outbox).length, 1);
});
test('concurrent execution cannot send a second copy', async () => {
    const x = setup(); x.store.lock = 'held';
    assert.equal((await x.engine.run(signal())).status, 'busy'); assert.equal(x.source.calls, 0);
});
test('new search bootstraps and does not backfill existing inventory', async () => {
    const x = setup(); await x.engine.run(signal()); x.source.ads = [ad(1)];
    x.searches.push({ id: 'new', query: 'elado+lakas+tata', chatIds: ['456'] });
    await x.engine.run(signal());
    assert.deepEqual(x.telegram.sent.map(([chat]) => chat), ['123']);
});
test('strong exact property duplicate is suppressed, weak similarity is not', async () => {
    const x = setup(); await x.engine.run(signal());
    const extras = { description: 'Ez egy egyedi leírás. '.repeat(10), photos: [{ url: 'https://img.example/1.jpg' }, { url: 'https://img.example/2.jpg' }] };
    x.source.ads = [ad(1, extras), ad(2, { ...extras, priceHuf: 43000000 })];
    assert.equal((await x.engine.run(signal())).sent, 1);
    x.source.ads.push(ad(3, { ...extras, description: 'Másik lakás az épületben. '.repeat(10) }));
    assert.equal((await x.engine.run(signal())).sent, 1);
    assert.equal(propertyKey(ad(99)), null);
});
test('filters exclude unknown price instead of treating it as zero', () => {
    assert.equal(matches(ad(), { maxPrice: 50000000, city: 'tatabánya' }), true);
    assert.equal(matches(ad(1, { priceHuf: null }), { maxPrice: 50000000 }), false);
    assert.equal(matches(ad(), { minArea: 70 }), false);
});
test('model preserves unknown publication semantics and extracts condition and photos', () => {
    const item = ad(1, { createdAt: 'raw-source-value' });
    assert.equal(item.sourceCreatedAtRaw, 'raw-source-value'); assert.equal(item.sourcePublishedAt, undefined);
    assert.equal(item.condition, 'Jó állapotú'); assert.equal(item.images[0], 'https://images.example/one.jpg');
    assert.throws(() => normalizeAd({ id: 'wrong' }), /API_SCHEMA/);
});
test('API adapter collects all pages and deduplicates source IDs', async () => {
    const requests = [];
    const source = new MobileSource({ urlTemplate: template, fetchImpl: async url => {
        requests.push(url); return page([raw(requests.length)], 2, 2);
    } });
    assert.equal((await source.scan('elado+lakas+tatabánya', signal())).length, 2);
    assert.match(requests[0], /elado\+lakas\+tatab%C3%A1nya/); assert.match(requests[1], /page=2/);
});
test('too many pages refuses partial bootstrap', async () => {
    const source = new MobileSource({ urlTemplate: template, maxPages: 1, fetchImpl: async () => page([raw()], 2, 2) });
    await assert.rejects(source.scan('query', signal()), /SOURCE_PAGE_LIMIT/);
});
test('API schema mismatch, duplicate-page gap and changing totals are errors', async () => {
    for (const fn of [async () => new Response('{}'), async () => page([raw()], 2, 2)]) {
        const source = new MobileSource({ urlTemplate: template, fetchImpl: fn });
        await assert.rejects(source.scan('query', signal()), /SOURCE_API_ERROR|SOURCE_SCHEMA|SOURCE_INCOMPLETE/);
    }
    let i = 0;
    const source = new MobileSource({ urlTemplate: template, fetchImpl: async () => page([raw(++i)], 2, i === 1 ? 2 : 3) });
    await assert.rejects(source.scan('query', signal()), /SOURCE_CHANGED_DURING_SCAN/);
});
test('auth and rate-limit failures stop without retries or evasive fallback', async () => {
    for (const status of [401,403,429]) {
        let calls = 0;
        const source = new MobileSource({ urlTemplate: template, fetchImpl: async () => { calls++; return new Response('{}', { status }); } });
        await assert.rejects(source.scan('query', signal()), /SOURCE_AUTH_REQUIRED|SOURCE_RATE_LIMIT/);
        assert.equal(calls, 1);
    }
});
test('API adapter rejects arbitrary hosts and credentials in URL', () => {
    for (const urlTemplate of ['http://mobile-gateway.ingatlan.com/{query}/{page}', 'https://evil.example/{query}/{page}', 'https://user:secret@mobile-gateway.ingatlan.com/{query}/{page}']) {
        assert.throws(() => new MobileSource({ urlTemplate }));
    }
});
test('Telegram photo message has price, location, condition, safe HTML and source button', async () => {
    let request;
    const telegram = new Telegram({ token: 'TEST_TOKEN', fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }));
    } });
    assert.equal(await telegram.send('123', ad(1, { addressTitle: '<b>fake</b>' }), signal()), 10);
    assert.match(request.url, /sendPhoto$/);
    assert.equal(request.body.photo, 'https://images.example/one.jpg');
    for (const text of ['45 millió Ft', '&lt;b&gt;fake&lt;/b&gt;', 'Jó állapotú', '60 m²']) assert.ok(request.body.caption.includes(text));
    assert.equal(request.body.reply_markup.inline_keyboard[0][0].url, 'https://ingatlan.com/1');
});
test('Telegram text fallback for no image, rejects API ok:false and preserves retry_after', async () => {
    let method;
    const telegram = new Telegram({ token: 'TEST', fetchImpl: async url => { method = url; return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 120 } }), { status: 429 }); } });
    await assert.rejects(telegram.send('123', ad(1, { photos: [] }), signal()), e => e.retryAfter === 120);
    assert.match(method, /sendMessage$/);
});
test('caption remains below Telegram photo caption UTF-16 limit', () => {
    const value = caption(ad(1, { addressTitle: '😀'.repeat(2000), price: '😀'.repeat(2000), listingAndPropertyType: '😀'.repeat(2000), roomCount: '😀'.repeat(2000), properties: [{ name: 'állapot', value: '😀'.repeat(2000) }] }));
    assert.ok(value.length <= 1024, `caption length ${value.length}`);
});
test('full pipeline sends a photo request to an HTTP Telegram stand-in only after bootstrap', async () => {
    const received = [];
    const server = createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        received.push({ url: req.url, body: JSON.parse(body) });
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { message_id: 7 } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const telegram = new Telegram({ token: 'TEST_ONLY', fetchImpl: (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options) });
        let items = [raw(1)];
        const source = new MobileSource({ urlTemplate: template, fetchImpl: async () => page(items) });
        const x = setup({ source, telegram });
        await x.engine.run(signal()); assert.equal(received.length, 0);
        items = [raw(1), raw(2)]; await x.engine.run(signal()); await x.engine.run(signal());
        assert.equal(received.length, 1); assert.match(received[0].url, /sendPhoto$/);
        assert.equal(received[0].body.chat_id, '123'); assert.match(received[0].body.caption, /Jó állapotú/);
    } finally { server.close(); server.closeAllConnections(); }
});
test('Redis saves are fenced, release is token-checked and state errors fail closed', async () => {
    const commands = [];
    const store = new RedisStore({ url: 'https://redis.example', token: 'SECRET', fetchImpl: async (_, options) => {
        const command = JSON.parse(options.body); commands.push(command);
        return new Response(JSON.stringify({ result: command[0] === 'SET' ? 'OK' : 0 }));
    } });
    const token = await store.acquire(); assert.ok(token);
    await assert.rejects(store.save({ any: 1 }, token), /STATE_LOCK_LOST/);
    await store.release(token);
    assert.ok(commands[1][1].includes("redis.call('GET',KEYS[1])"));
    assert.ok(commands[2][1].includes("redis.call('DEL',KEYS[1])"));
});
test('config rejects invalid filters, recipient IDs and duplicate search IDs', () => {
    const searches = [{ id: 'one', query: 'elado+lakas', chatIds: ['123'] }];
    assert.equal(config({ NOTIFIER_SEARCHES_JSON: JSON.stringify(searches) }).interval, 60);
    for (const changed of [{ ...searches[0], chatIds: ['@wrong'] }, { ...searches[0], filters: { maxPrice: -1 } }, { ...searches[0], filters: { minPrice: 20, maxPrice: 10 } }]) {
        assert.throws(() => config({ NOTIFIER_SEARCHES_JSON: JSON.stringify([changed]) }));
    }
    assert.throws(() => config({ NOTIFIER_SEARCHES_JSON: JSON.stringify([...searches, ...searches]) }));
});

test('removing a search cancels its pending message even if chat has another query', async () => {
    const x = setup(); await x.engine.run(signal()); x.source.ads = [ad(1)];
    x.telegram.send = async () => { throw new Error('failure'); };
    await x.engine.run(signal());
    x.searches.splice(0, 1, { id: 'different', query: 'kiado+haz+budapest', chatIds: ['123'] });
    x.advance(120000);
    await x.engine.run(signal());
    assert.equal(Object.keys(x.store.state.outbox).length, 0);
});
test('failed scan after an earlier successful search does not commit partial bootstrap', async () => {
    const x = setup(); x.searches.push({ id: 'bad', query: 'bad', chatIds: ['123'] });
    x.source.scan = async query => { if (query === 'bad') throw new Error('SOURCE_SCHEMA'); return [ad(1)]; };
    await assert.rejects(x.engine.run(signal()), /SOURCE_SCHEMA/);
    assert.deepEqual(x.store.state.seen, {}); assert.deepEqual(x.store.state.searches, {});
});
test('a lost state lease prevents the Telegram side effect', async () => {
    const x = setup(); await x.engine.run(signal()); x.source.ads = [ad(1)];
    const save = x.store.save.bind(x.store); let calls = 0;
    x.store.save = async (...args) => { if (++calls === 2) throw new Error('STATE_LOCK_LOST'); await save(...args); };
    await assert.rejects(x.engine.run(signal()), /STATE_LOCK_LOST/);
    assert.equal(x.telegram.sent.length, 0);
});

test('default mobile route strips anonymous users marker and sends required version headers', async () => {
    const requests = [];
    const source = new MobileSource({ fetchImpl: async (url, options) => {
        requests.push({ url, headers: options.headers });
        return page([raw()]);
    } });
    const ads = await source.scan('elado+haz+kecsked', signal());
    assert.equal(ads.length, 1);
    assert.equal(requests[0].url, 'https://mobile-gateway.ingatlan.com/v1/ads/search/elado+haz+kecsked?page=1');
    assert.equal(requests[0].headers.apiLevel, '115');
    assert.equal(requests[0].headers.buildNumber, '273');
    assert.equal(requests[0].headers.channel, 'ANDROID');
    assert.equal(requests[0].headers.Authorization, undefined);
});
test('observed mobile property label and separate listing/type fields are normalized', () => {
    const item = ad(1, { listingTypeFormatted: 'eladó', propertyTypeFormatted: 'ház',
        properties: [{ name: 'Az ingatlan állapota', value: 'közepes állapotú' }],
        photos: ['https://images.example/real-schema.jpg'], createdAt: '2026-07-19T20:51:29Z' });
    assert.equal(item.condition, 'közepes állapotú');
    assert.equal(item.title, 'eladó ház');
    assert.equal(item.images[0], 'https://images.example/real-schema.jpg');
});
test('unsupported mobile client versions get an actionable error', async () => {
    const source = new MobileSource({ fetchImpl: async () => new Response('{}', { status: 426 }) });
    await assert.rejects(source.page('elado+haz+kecsked', 1, signal()), error => error.code === 'SOURCE_APP_VERSION_UNSUPPORTED');
});
test('HTTP 200 API error cannot be treated as a successful snapshot', async () => {
    const source = new MobileSource({ fetchImpl: async () => new Response(JSON.stringify({ status: 'error', data: { list: [], pages: 0, totalFound: 0 } })) });
    await assert.rejects(source.scan('query', signal()), /SOURCE_API_ERROR/);
});
