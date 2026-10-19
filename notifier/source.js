import { normalizeAd } from './model.js';

export class SourceError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export class MobileSource {
    constructor({ urlTemplate, headers = {}, maxPages = 20, fetchImpl = fetch }) {
        if (!urlTemplate?.includes('{query}') || !urlTemplate.includes('{page}')) throw new Error('API URL template must include {query} and {page}');
        const sample = new URL(urlTemplate.replace('{query}', 'test').replace('{page}', '1'));
        if (sample.protocol !== 'https:' || sample.hostname !== 'mobile-gateway.ingatlan.com') throw new Error('Only the production ingatlan mobile gateway is supported');
        if (sample.username || sample.password) throw new Error('URL credentials are not allowed');
        this.urlTemplate = urlTemplate; this.headers = headers; this.maxPages = maxPages; this.fetch = fetchImpl;
    }
    async page(query, page, signal) {
        // searchQuery is an encoded path in Retrofit; preserve + separators, encode unsafe path characters.
        const encoded = query.split('+').map(encodeURIComponent).join('+');
        const url = this.urlTemplate.replace('{query}', encoded).replace('{page}', String(page));
        let response;
        try { response = await this.fetch(url, { headers: { Accept: 'application/json', ...this.headers }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) }); }
        catch { throw new SourceError('SOURCE_NETWORK'); }
        if ([401, 403].includes(response.status)) throw new SourceError('SOURCE_AUTH_REQUIRED', response.status);
        if (response.status === 429) throw new SourceError('SOURCE_RATE_LIMIT', 429);
        if (!response.ok) throw new SourceError('SOURCE_HTTP_ERROR', response.status);
        let body;
        try { body = await response.json(); } catch { throw new SourceError('SOURCE_NOT_JSON'); }
        const data = body?.data;
        if (!Array.isArray(data?.list) || !Number.isInteger(data.pages) || data.pages < 0 ||
            !Number.isInteger(data.totalFound) || data.totalFound < 0) throw new SourceError('SOURCE_SCHEMA');
        if (data.totalFound > 0 && data.list.length === 0 && page <= data.pages) throw new SourceError('SOURCE_INCOMPLETE');
        return { ads: data.list.map(ad => normalizeAd(ad)), pages: data.pages, total: data.totalFound };
    }
    async scan(query, signal) {
        const first = await this.page(query, 1, signal);
        if (first.pages > this.maxPages) throw new SourceError('SOURCE_PAGE_LIMIT');
        if (first.total > 0 && first.pages === 0) throw new SourceError('SOURCE_SCHEMA');
        const ads = [...first.ads];
        for (let page = 2; page <= first.pages; page++) {
            const next = await this.page(query, page, signal);
            if (next.pages !== first.pages || next.total !== first.total) throw new SourceError('SOURCE_CHANGED_DURING_SCAN');
            ads.push(...next.ads);
        }
        const unique = new Map(ads.map(ad => [ad.id, ad]));
        if (unique.size !== first.total) throw new SourceError('SOURCE_INCOMPLETE');
        return [...unique.values()];
    }
}
