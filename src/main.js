import { Actor } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://ingatlan.com/lista/elado+lakas+budapest',
    maxPages = 5,
    minPrice,
    maxPrice,
} = input;

console.log('🏠 Ingatlan.com Scraper (Playwright) indítása...');
console.log(`URL: ${searchUrl}`);
console.log(`Max oldalak: ${maxPages}`);

let totalResults = 0;

const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 3,
    maxConcurrency: 1,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,

    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            // Elrejtjük a bot jeleket
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['hu-HU', 'hu', 'en-US'] });
                window.chrome = { runtime: {} };
            });

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            });
        },
    ],

    async requestHandler({ page, request, log }) {
        log.info(`📄 Oldal betöltése: ${request.url}`);

        // Várakozás hogy Cloudflare challenge lefusson
        await sleep(3000);

        const title = await page.title();
        if (title.includes('Just a moment') || title.includes('Cloudflare')) {
            log.info('⏳ Cloudflare challenge észlelve, várakozás...');
            await sleep(8000);
        }

        // Várjuk a tartalom megjelenését
        try {
            await page.waitForSelector(
                '[class*="listing"], [class*="property"], article, .card',
                { timeout: 20000 }
            );
        } catch {
            log.warning('Nem találtuk a listázó elemet, megpróbáljuk így is...');
        }

        // Scroll - lazy-load elemek betöltéséhez
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await sleep(1500);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1500);

        // Adatok kinyerése
        const listings = await page.evaluate(() => {
            const results = [];

            const selectors = [
                '[class*="listing-card"]',
                '[class*="property-card"]',
                '[class*="listing__card"]',
                'article[class*="listing"]',
                '[data-testid*="listing"]',
                '[data-id]',
            ];

            let cards = [];
            for (const sel of selectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    cards = Array.from(found);
                    break;
                }
            }

            for (const card of cards) {
                try {
                    const priceEl = card.querySelector('[class*="price"], [class*="ar"], [data-testid*="price"]');
                    const price = priceEl?.textContent?.trim() ?? '';

                    const addrEl = card.querySelector('[class*="address"], [class*="location"], [class*="city"], [class*="cim"]');
                    const address = addrEl?.textContent?.trim() ?? '';

                    const sizeEl = card.querySelector('[class*="area"], [class*="size"], [class*="meret"]');
                    const size = sizeEl?.textContent?.trim() ?? '';

                    const roomEl = card.querySelector('[class*="room"], [class*="szoba"]');
                    const rooms = roomEl?.textContent?.trim() ?? '';

                    const linkEl = card.querySelector('a');
                    const href = linkEl?.getAttribute('href') ?? '';
                    const link = href.startsWith('http') ? href : `https://ingatlan.com${href}`;

                    const imgEl = card.querySelector('img');
                    const imageUrl = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? '';

                    if (price || address || href) {
                        results.push({ price, address, size, rooms, link, imageUrl });
                    }
                } catch { /* skip */ }
            }

            // JSON-LD fallback ha nem találtunk kártyákat
            if (results.length === 0) {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of scripts) {
                    try {
                        const data = JSON.parse(script.textContent);
                        const items = Array.isArray(data) ? data : [data];
                        for (const item of items) {
                            if (item['@type'] === 'RealEstateListing' || item.name) {
                                results.push({
                                    price: String(item.price ?? item.offers?.price ?? ''),
                                    address: item.address?.streetAddress ?? item.name ?? '',
                                    size: String(item.floorSize?.value ?? ''),
                                    rooms: String(item.numberOfRooms ?? ''),
                                    link: item.url ?? '',
                                    imageUrl: item.image ?? '',
                                });
                            }
                        }
                    } catch { /* skip */ }
                }
            }

            return results;
        });

        log.info(`✅ ${listings.length} hirdetés találva`);

        const now = new Date().toISOString();
        for (const listing of listings) {
            if (minPrice || maxPrice) {
                const priceNum = parseInt(listing.price.replace(/\D/g, ''));
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;
            }
            await Actor.pushData({ ...listing, scrapedAt: now, sourceUrl: request.url });
            totalResults++;
        }

        // Következő oldal keresése
        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages && listings.length > 0) {
            const nextUrl = await page.evaluate(() => {
                const nextEl = document.querySelector(
                    'a[rel="next"], [class*="pagination__next"], [aria-label="Következő"], [aria-label="next"]'
                );
                return nextEl?.href ?? null;
            });

            if (nextUrl && nextUrl !== request.url) {
                log.info(`➡️ Következő oldal: ${nextUrl}`);
                await crawler.addRequests([{ url: nextUrl, userData: { pageNum: currentPage + 1 } }]);
            } else {
                const url = new URL(request.url);
                url.searchParams.set('page', String(currentPage + 1));
                const fallbackUrl = url.toString();
                if (fallbackUrl !== request.url) {
                    await crawler.addRequests([{ url: fallbackUrl, userData: { pageNum: currentPage + 1 } }]);
                }
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`❌ Sikertelen: ${request.url}`);
    },
});

await crawler.run([{ url: searchUrl, userData: { pageNum: 1 } }]);

console.log(`\n🎉 Kész! Összesen ${totalResults} hirdetés mentve.`);

await Actor.exit();
