import { config } from './config.js';
import { MobileSource } from './source.js';
import { RedisStore } from './store.js';
import { Telegram } from './telegram.js';
import { Engine } from './engine.js';
export function createRuntime(env = process.env) {
    const c = config(env);
    return { config: c, engine: new Engine({
        searches: c.searches,
        source: new MobileSource({ urlTemplate: c.urlTemplate, headers: c.headers, maxPages: c.maxPages }),
        store: new RedisStore({ url: c.redisUrl, token: c.redisToken, namespace: c.namespace }),
        telegram: new Telegram({ token: c.telegramToken }),
    }) };
}
