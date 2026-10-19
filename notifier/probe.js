import { config } from './config.js';
import { MobileSource } from './source.js';
try {
    const c = config();
    const source = new MobileSource({ urlTemplate: c.urlTemplate, headers: c.headers, maxPages: c.maxPages });
    const result = await source.page(c.searches[0].query, 1, AbortSignal.timeout(10000));
    console.log(JSON.stringify({ status: 'ok', pages: result.pages, total: result.total, count: result.ads.length,
        privateCount: result.ads.filter(ad => ad.sellerType === 'PRIVATE').length,
        fields: Object.keys(result.ads[0] ?? {}) }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'PROBE_CONFIG_OR_NETWORK_ERROR', httpStatus: error.status }));
    process.exitCode = 1;
}
