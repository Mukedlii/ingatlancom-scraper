import { randomUUID } from 'node:crypto';

export class RedisStore {
    constructor({ url, token, namespace = 'ingatlan-notifier:v1', fetchImpl = fetch }) {
        if (!url || !token) throw new Error('Missing Upstash REST credentials');
        if (new URL(url).protocol !== 'https:') throw new Error('Redis REST must use HTTPS');
        this.url = url; this.token = token; this.key = namespace; this.fetch = fetchImpl;
    }
    async command(command) {
        let response;
        try { response = await this.fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000), redirect: 'error' }); }
        catch { throw new Error('STATE_NETWORK'); }
        if (!response.ok) throw new Error('STATE_HTTP_ERROR');
        const body = await response.json();
        if (body.error) throw new Error('STATE_COMMAND_ERROR');
        return body.result;
    }
    async acquire() {
        const token = randomUUID();
        return await this.command(['SET', `${this.key}:lock`, token, 'NX', 'PX', 180000]) === 'OK' ? token : null;
    }
    async load() {
        const raw = await this.command(['GET', `${this.key}:state`]);
        if (raw == null) return { version: 1, searches: {}, seen: {}, delivered: {}, properties: {}, outbox: {} };
        const state = JSON.parse(raw);
        if (state.version !== 1 || !state.searches || !state.seen || !state.outbox || !state.properties || !state.delivered) throw new Error('STATE_SCHEMA');
        return state;
    }
    async save(state, token) {
        const raw = JSON.stringify(state);
        if (Buffer.byteLength(raw) > 8_000_000) throw new Error('STATE_CAPACITY: migrate to indexed storage');
        const result = await this.command(['EVAL', "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[2]); return 1", 2, `${this.key}:lock`, `${this.key}:state`, token, raw]);
        if (result !== 1) throw new Error('STATE_LOCK_LOST');
    }
    async release(token) {
        await this.command(['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, `${this.key}:lock`, token]);
    }
}
