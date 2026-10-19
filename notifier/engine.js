import { hash, matches, propertyKey } from './model.js';

export class Engine {
    constructor({ source, store, telegram, searches, clock = () => Date.now() }) {
        Object.assign(this, { source, store, telegram, searches, clock });
    }
    async run(signal = AbortSignal.timeout(60000)) {
        signal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
        const token = await this.store.acquire();
        if (!token) return { status: 'busy', sent: 0 };
        try {
            const state = await this.store.load();
            const previousSeen = new Set(Object.keys(state.seen));
            const stats = { status: 'ok', bootstrapped: 0, queued: 0, sent: 0, failed: 0 };
            const scans = new Map();
            for (const search of this.searches) {
                signal.throwIfAborted();
                if (!scans.has(search.query)) scans.set(search.query, await this.source.scan(search.query, signal));
                const ads = scans.get(search.query);
                const searchKey = hash(JSON.stringify(search));
                const bootstrap = !state.searches[searchKey];
                for (const ad of ads) {
                    const listingKey = `${ad.source}:${ad.id}`;
                    const pkey = propertyKey(ad);
                    if (!state.seen[listingKey]) state.seen[listingKey] = ad.firstSeenAt;
                    if (!matches(ad, search.filters)) continue;
                    for (const chatId of search.chatIds) {
                        const delivery = hash(JSON.stringify([chatId, listingKey]));
                        const propertyDelivery = pkey ? hash(JSON.stringify([chatId, pkey])) : null;
                        if (bootstrap) {
                            if (!state.outbox[delivery]) state.delivered[delivery] = 'bootstrap';
                            if (propertyDelivery && !state.properties[propertyDelivery]) state.properties[propertyDelivery] = delivery;
                            continue;
                        }
                        if (state.outbox[delivery]) {
                            if (!state.outbox[delivery].queries.includes(search.query)) state.outbox[delivery].queries.push(search.query);
                            continue;
                        }
                        if (state.delivered[delivery]) continue;
                        if (propertyDelivery && state.properties[propertyDelivery]) continue;
                        if (previousSeen.has(listingKey)) continue;
                        state.outbox[delivery] = { chatId, ad, queries: [search.query], attempts: 0, nextAttemptAt: 0 };
                        if (propertyDelivery) state.properties[propertyDelivery] = delivery;
                        stats.queued++;
                    }
                }
                state.searches[searchKey] = { initializedAt: state.searches[searchKey]?.initializedAt ?? new Date(this.clock()).toISOString() };
                if (bootstrap) stats.bootstrapped++;
            }
            // Persist outbox before sending. Failed/incomplete scans never bootstrap.
            await this.store.save(state, token);
            for (const [key, entry] of Object.entries(state.outbox)) {
                if (signal.aborted) break;
                if (entry.nextAttemptAt > this.clock()) continue;
                const active = this.searches.some(s => s.chatIds.includes(entry.chatId) && entry.queries.includes(s.query) && matches(entry.ad, s.filters));
                if (!active) { delete state.outbox[key]; await this.store.save(state, token); continue; }
                await this.store.save(state, token); // verifies lease before side effect
                try {
                    await this.telegram.send(entry.chatId, entry.ad, signal);
                    state.delivered[key] = new Date(this.clock()).toISOString();
                    delete state.outbox[key];
                    stats.sent++;
                } catch (error) {
                    entry.attempts++;
                    entry.nextAttemptAt = this.clock() + Math.max(error.retryAfter ?? 0, Math.min(3600, 30 * 2 ** Math.min(entry.attempts, 7))) * 1000;
                    stats.failed++;
                }
                await this.store.save(state, token);
                if (Object.keys(state.outbox).length && !signal.aborted) {
                    const { setTimeout } = await import('node:timers/promises');
                    await setTimeout(1100, undefined, { signal }).catch(() => {});
                }
            }
            state.lastRun = { at: new Date(this.clock()).toISOString(), ...stats };
            await this.store.save(state, token);
            return stats;
        } finally { await this.store.release(token); }
    }
}
