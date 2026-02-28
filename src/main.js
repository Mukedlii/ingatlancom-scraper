import { Actor } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

// Stabilitás: ne omoljon össze unhandled hibákon, inkább logoljuk és lépjünk ki.
process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('UNHANDLED_REJECTION', reason);
    process.exitCode = 1;
});
process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('UNCAUGHT_EXCEPTION', err);
    process.exitCode = 1;
});

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://ingatlan.com/lista/elado+lakas+budapest',
    maxPages = 5,
    minPrice,
    maxPrice,
} = input;

console.log('🏠 Ingatlan.com Scraper v7 indítása...');
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
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,

    launchContext: {
        launcher: chromium,
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            const viewports = [
                { width: 1366, height: 768 },
                { width: 1440, height: 900 },
                { width: 1920, height: 1080 },
                { width: 1536, height: 864 },
            ];
            const vp = viewports[Math.floor(Math.random() * viewports.length)];
            await page.setViewportSize(vp);

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'max-age=0',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
            });

            await page.addInitScript(() => {
                Object.defineProperty(screen, 'width', { get: () => 1920 });
                Object.defineProperty(screen, 'height', { get: () => 1080 });
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        const arr = [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin' },
                        ];
                        arr.item = i => arr[i];
                        arr.namedItem = n => arr.find(p => p.name === n);
                        arr.refresh = () => {};
                        return arr;
                    }
                });
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) return 'Intel Inc.';
                    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                    return getParameter.call(this, parameter);
                };
                if (!window.chrome) {
                    window.chrome = {
                        app: { isInstalled: false },
                        runtime: {
                            onConnect: { addListener: () => {}, removeListener: () => {} },
                            onMessage: { addListener: () => {}, removeListener: () => {} },
                        },
                        csi: () => {},
                        loadTimes: () => {},
                    };
                }
                if (window.Notification) {
                    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
                }
            });
        },
    ],

    async requestHandler({ page, request, log }) {
        log.info(`📄 Betöltés: ${request.url}`);

        await sleep(2000 + Math.random() * 3000);

        // Cloudflare challenge kezelés
        for (let attempt = 0; attempt < 3; attempt++) {
            const title = await page.title();
            const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) ?? '');
            if (title.includes('Just a moment') || title.includes('Cloudflare') || bodyText.includes('Checking your browser')) {
                log.info(`⏳ Cloudflare challenge (${attempt + 1}/3), várakozás 10mp...`);
                await sleep(10000);
            } else break;
        }

        // Cookie banner bezárása
        try {
            await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { timeout: 4000 });
            log.info('🍪 Cookie elfogadva');
            await sleep(1500);
        } catch { /* nincs cookie banner */ }

        // Emberi scroll
        await humanScroll(page);

        // Várjuk a kártyák megjelenését
        try {
            await page.waitForSelector('.listing-card', { timeout: 25000 });
        } catch {
            log.warning('⚠️ .listing-card nem jelent meg!');
        }

        // Adatok kinyerése - PONTOS szelektorok a valódi HTML alapján
        const listings = await page.evaluate(() => {
            const results = [];
            const norm = (s) => (s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

            const cards = Array.from(document.querySelectorAll('a.listing-card[data-listing-id]'));

            for (const card of cards) {
                try {
                    // ----- LINK + ID -----
                    const href = (card.getAttribute('href') ?? '').trim();
                    const listingId = card.getAttribute('data-listing-id') ?? '';
                    const link = href.startsWith('http') ? href : `https://ingatlan.com${href}`;

                    // ----- ÁR -----
                    const price = norm(
                        card.querySelector('.fw-bold.fs-5.text-onyx')?.textContent
                        ?? card.querySelector('.fw-bold.fs-5')?.textContent
                        ?? ''
                    );

                    // ----- ÁR / m² -----
                    const pricePerSqm = norm(card.querySelector('.listing-card-area-prices')?.textContent ?? '');

                    // ----- CÍM -----
                    const address = norm(
                        card.querySelector('.listing-card-content .d-block.fs-7.text-gray-900')?.textContent
                        ?? card.querySelector('.listing-card-content .d-block.fs-7')?.textContent
                        ?? ''
                    );

                    // ----- ALAPTERÜLET + SZOBÁK -----
                    let size = '';
                    let rooms = '';

                    // A színek változhatnak (text-gray-400 vs text-blue-100), ezért ne class alapján szűrjünk.
                    const blocks = Array.from(card.querySelectorAll('div.d-flex.flex-column'));
                    for (const b of blocks) {
                        const label = norm(b.querySelector('span.fs-7')?.textContent).toLowerCase();
                        const value = norm(
                            b.querySelector('span.fs-6.fw-bold')?.textContent
                            ?? b.querySelector('span.fw-bold')?.textContent
                            ?? ''
                        );
                        if (!label || !value) continue;

                        if (label.includes('alapter')) size = value;
                        if (label.includes('szob')) rooms = value;
                    }

                    // ----- KÉP -----
                    const imgEl = card.querySelector('img');
                    const imageUrl = imgEl?.getAttribute('src')
                        ?? imgEl?.getAttribute('data-src')
                        ?? '';

                    if (link && link !== 'https://ingatlan.com') {
                        results.push({
                            listingId,
                            price,
                            pricePerSqm,
                            address,
                            size,
                            rooms,
                            link,
                            imageUrl,
                        });
                    }
                } catch {
                    /* skip */
                }
            }

            return results;
        });

        log.info(`✅ ${listings.length} hirdetés találva`);

        const now = new Date().toISOString();
        for (const listing of listings) {
            if (minPrice || maxPrice) {
                const priceNum = parseInt((listing.price ?? '').replace(/\D/g, ''));
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;
            }
            await Actor.pushData({ ...listing, scrapedAt: now, sourceUrl: request.url });
            totalResults++;
        }

        // Következő oldal
        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages && listings.length > 0) {
            const nextUrl = await page.evaluate(() => {
                const nextEl = document.querySelector('a[rel="next"]');
                return nextEl?.href ?? null;
            });

            const targetUrl = nextUrl ?? (() => {
                const url = new URL(request.url);
                url.searchParams.set('page', String(currentPage + 1));
                return url.toString();
            })();

            if (targetUrl !== request.url) {
                log.info(`➡️ Következő oldal (${currentPage + 1}): ${targetUrl}`);
                await sleep(2000 + Math.random() * 2000);
                await crawler.addRequests([{ url: targetUrl, userData: { pageNum: currentPage + 1 } }]);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`❌ Végleg sikertelen: ${request.url}`);
    },
});

async function humanScroll(page) {
    await page.evaluate(async () => {
        const totalHeight = document.body.scrollHeight;
        const step = Math.floor(totalHeight / 8);
        for (let pos = 0; pos < totalHeight; pos += step) {
            window.scrollTo(0, pos);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        }
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 500));
    });
}

await crawler.run([{ url: searchUrl, userData: { pageNum: 1 } }]);

console.log(`\n🎉 Kész! Összesen ${totalResults} hirdetés mentve.`);

await Actor.exit();
