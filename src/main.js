import { Actor } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://ingatlan.com/lista/elado+lakas+budapest',
    maxPages = 5,
    minPrice,
    maxPrice,
    minSize,
    maxSize,
} = input;

console.log('🏠 Ingatlan.com Scraper indítása...');
console.log(`URL: ${searchUrl}`);
console.log(`Max oldalak: ${maxPages}`);

const results = [];

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestRetries: 3,

    async requestHandler({ page, request, log }) {
        log.info(`Feldolgozás: ${request.url}`);

        // Várjuk meg az oldalak betöltését
        await page.waitForSelector('.listing__card, .listing-card, [class*="listing"]', {
            timeout: 15000,
        }).catch(() => log.warning('Listázás selector nem található, próbálkozás másképp...'));

        await sleep(2000);

        // Scrape az összes hirdetést az oldalon
        const listings = await page.evaluate(() => {
            const items = [];

            // Próbáljuk meg a különböző lehetséges selectorokat
            const cards = document.querySelectorAll(
                '.listing__card, .listing-card, article[class*="listing"], .property-card, [data-testid="listing-card"]'
            );

            cards.forEach((card) => {
                try {
                    // Ár kinyerése
                    const priceEl = card.querySelector(
                        '[class*="price"], .price, .listing__price, [data-testid="price"]'
                    );
                    const price = priceEl?.innerText?.trim() ?? '';

                    // Cím kinyerése
                    const addressEl = card.querySelector(
                        '[class*="address"], .address, .listing__address, [class*="location"]'
                    );
                    const address = addressEl?.innerText?.trim() ?? '';

                    // Méret kinyerése
                    const sizeEl = card.querySelector(
                        '[class*="size"], [class*="area"], .listing__size'
                    );
                    const size = sizeEl?.innerText?.trim() ?? '';

                    // Szobák száma
                    const roomsEl = card.querySelector(
                        '[class*="room"], .rooms, .listing__rooms'
                    );
                    const rooms = roomsEl?.innerText?.trim() ?? '';

                    // Link kinyerése
                    const linkEl = card.querySelector('a');
                    const link = linkEl?.href ?? '';

                    // Kép URL
                    const imgEl = card.querySelector('img');
                    const imageUrl = imgEl?.src ?? imgEl?.dataset?.src ?? '';

                    // Típus (eladó/kiadó)
                    const typeEl = card.querySelector('[class*="type"], [class*="badge"]');
                    const type = typeEl?.innerText?.trim() ?? '';

                    // Csak akkor adjuk hozzá ha van valami hasznos adat
                    if (price || address || link) {
                        items.push({
                            price,
                            address,
                            size,
                            rooms,
                            type,
                            link: link.startsWith('http') ? link : `https://ingatlan.com${link}`,
                            imageUrl,
                            scrapedAt: new Date().toISOString(),
                        });
                    }
                } catch (e) {
                    // Silently skip problematic cards
                }
            });

            return items;
        });

        // Szűrés ha vannak feltételek megadva
        for (const listing of listings) {
            // Ár szűrés
            if (minPrice || maxPrice) {
                const priceNum = parseInt(listing.price.replace(/\D/g, ''));
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;
            }

            results.push(listing);
            await Actor.pushData(listing);
        }

        log.info(`✅ ${listings.length} hirdetés találva ezen az oldalon`);

        // Következő oldal keresése
        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages) {
            const nextPageUrl = await page.evaluate((pageNum) => {
                const nextBtn = document.querySelector(
                    '[aria-label="Következő oldal"], .pagination__next, [class*="next"], a[rel="next"]'
                );
                if (nextBtn?.href) return nextBtn.href;

                // URL alapú lapozás
                const url = new URL(window.location.href);
                url.searchParams.set('page', pageNum + 1);
                return url.toString();
            }, currentPage);

            if (nextPageUrl && nextPageUrl !== request.url) {
                await crawler.addRequests([{
                    url: nextPageUrl,
                    userData: { pageNum: currentPage + 1 },
                }]);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Sikertelen: ${request.url}`);
    },
});

await crawler.run([{
    url: searchUrl,
    userData: { pageNum: 1 },
}]);

console.log(`\n🎉 Kész! Összesen ${results.length} hirdetés mentve.`);

await Actor.exit();
