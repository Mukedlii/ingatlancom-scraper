export function config(env = process.env) {
    const searches = JSON.parse(env.NOTIFIER_SEARCHES_JSON || '[]');
    if (!Array.isArray(searches) || searches.length === 0 || searches.length > 20) throw new Error('Set 1–20 searches');
    const ids = new Set();
    for (const search of searches) {
        if (!search.id || ids.has(search.id) || typeof search.query !== 'string' || !/^[\p{L}\p{N}+,._-]+$/u.test(search.query)) throw new Error('Invalid or duplicate search');
        ids.add(search.id);
        if (!Array.isArray(search.chatIds) || !search.chatIds.length || !search.chatIds.every(id => typeof id === 'string' && /^-?\d+$/.test(id))) throw new Error('chatIds must be numeric strings');
        search.chatIds = [...new Set(search.chatIds)];
        const filter = search.filters ?? {};
        const allowed = new Set(['city', 'minPrice', 'maxPrice', 'minArea', 'maxArea']);
        for (const [key, value] of Object.entries(filter)) {
            if (!allowed.has(key) || (key === 'city' ? typeof value !== 'string' : !Number.isFinite(value) || value < 0)) throw new Error('Invalid search filter');
        }
        for (const [min, max] of [['minPrice','maxPrice'], ['minArea','maxArea']]) if (filter[min] != null && filter[max] != null && filter[min] > filter[max]) throw new Error('Invalid filter range');
    }
    const headers = JSON.parse(env.INGATLAN_API_HEADERS_JSON || '{}');
    if (!headers || Array.isArray(headers) || typeof headers !== 'object' || !Object.values(headers).every(v => typeof v === 'string' && !/[\r\n]/.test(v))) throw new Error('Invalid API headers');
    const interval = Number(env.POLL_INTERVAL_SECONDS || 60);
    if (!Number.isInteger(interval) || interval < 15 || interval > 3600) throw new Error('Invalid polling interval');
    const maxPages = Number(env.MAX_SCAN_PAGES || 20);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('Invalid MAX_SCAN_PAGES');
    return { searches, headers, interval, maxPages, urlTemplate: env.INGATLAN_SEARCH_URL_TEMPLATE || undefined,
        redisUrl: env.UPSTASH_REDIS_REST_URL, redisToken: env.UPSTASH_REDIS_REST_TOKEN,
        namespace: env.STATE_NAMESPACE || 'ingatlan-notifier:v1', telegramToken: env.TELEGRAM_BOT_TOKEN };
}
