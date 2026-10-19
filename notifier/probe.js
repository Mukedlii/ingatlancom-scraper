import { MobileSource } from './source.js';
try {
    // Source-only check: no bot, Redis, recipient, or deployment needed.
    const query = process.argv[2] || 'elado+haz+kecsked';
    if (!/^[\p{L}\p{N}+,._-]+$/u.test(query)) throw new Error('Invalid query');
    const headers = JSON.parse(process.env.INGATLAN_API_HEADERS_JSON || '{}');
    const source = new MobileSource({ urlTemplate: process.env.INGATLAN_SEARCH_URL_TEMPLATE || undefined, headers });
    const result = await source.page(query, 1, AbortSignal.timeout(15000));
    console.log(JSON.stringify({ status: 'ok', query, pages: result.pages, total: result.total, count: result.ads.length,
        privateCount: result.ads.filter(ad => ad.sellerType === 'PRIVATE').length,
        fields: Object.keys(result.ads[0] ?? {}),
        sample: result.ads.filter(ad => ad.sellerType === 'PRIVATE').slice(0, 1).map(ad => ({
            id: ad.id, title: ad.title, price: ad.price, city: ad.city, area: ad.area, rooms: ad.rooms,
            condition: ad.condition, imageCount: ad.images.length, url: ad.url,
        })) }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'PROBE_CONFIG_OR_NETWORK_ERROR', httpStatus: error.status }));
    process.exitCode = 1;
}
