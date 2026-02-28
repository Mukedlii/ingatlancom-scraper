import { Actor } from 'apify';
import { HttpCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://ingatlan.com/lista/elado+lakas+budapest',
    maxPages = 5,
    minPrice,
    maxPrice,
} = input;

console.log('🏠 Ingatlan.com Scraper indítása...');
console.log(`URL: ${searchUrl}`);
console.log(`Max oldalak: ${maxPages}`);

let totalResults = 0;

// Apify proxy - megkerüli a Cloudflare/403 védelmet
const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
});

const crawler = new HttpCrawler({
    maxRequestRetries: 5,
    maxConcurrency: 1,
    proxyConfiguration,

    additionalMimeTypes: ['text/html'],
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1',
            };
        },
    ],

    async requestHandler({ request, body, log }) {
        log.info(`Feldolgozás: ${request.url}`);

        const $ = cheerio.load(body);
        const listings = [];

        $('article, .listing-card, [class*="listing__card"], .property-card').each((_, el) => {
            try {
                const card = $(el);
                const price = card.find('[class*="price"], .price').first().text().trim();
                const address = card.find('[class*="address"], [class*="location"], .city').first().text().trim();
                const size = card.find('[class*="area"], [class*="size"], .area').first().text().trim();
                const rooms = card.find('[class*="room"]').first().text().trim();
                const link = card.find('a').first().attr('href') ?? '';
                const imageUrl = card.find('img').first().attr('src') ?? '';

                if (price || address || link) {
                    listings.push({
                        price,
                        address,
                        size,
                        rooms,
                        link: link.startsWith('http') ? link : `https://ingatlan.com${link}`,
                        imageUrl,
                        scrapedAt: new Date().toISOString(),
                    });
                }
            } catch (e) { /* skip */ }
        });

        // JSON-LD fallback
        if (listings.length === 0) {
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    const items = Array.isArray(json) ? json : [json];
                    for (const item of items) {
                        if (item['@type'] === 'RealEstateListing' || item.name) {
                            listings.push({
                                price: item.price ?? item.offers?.price ?? '',
                                address: item.address?.streetAddress ?? item.name ?? '',
                                size: item.floorSize?.value ?? '',
                                rooms: item.numberOfRooms ?? '',
                                link: item.url ?? request.url,
                                imageUrl: item.image ?? '',
                                scrapedAt: new Date().toISOString(),
                            });
                        }
                    }
                } catch (e) { /* skip */ }
            });
        }

        log.info(`✅ ${listings.length} hirdetés találva ezen az oldalon`);

        for (const listing of listings) {
            if (minPrice || maxPrice) {
                const priceNum = parseInt(listing.price.replace(/\D/g, ''));
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;
            }
            await Actor.pushData(listing);
            totalResults++;
        }

        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages && listings.length > 0) {
            const nextLink = $('a[rel="next"], .pagination__next, [aria-label="Következő"]').attr('href');
            let nextUrl;
            if (nextLink) {
                nextUrl = nextLink.startsWith('http') ? nextLink : `https://ingatlan.com${nextLink}`;
            } else {
                const url = new URL(request.url);
                url.searchParams.set('page', currentPage + 1);
                nextUrl = url.toString();
            }
            if (nextUrl !== request.url) {
                await crawler.addRequests([{ url: nextUrl, userData: { pageNum: currentPage + 1 } }]);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Sikertelen: ${request.url}`);
    },
});

await crawler.run([{ url: searchUrl, userData: { pageNum: 1 } }]);

console.log(`\n🎉 Kész! Összesen ${totalResults} hirdetés mentve.`);

await Actor.exit();
