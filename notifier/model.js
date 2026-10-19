import { createHash } from 'node:crypto';

const text = value => typeof value === 'string' ? value.trim() : '';
const fold = value => text(value).normalize('NFKC').toLocaleLowerCase('hu').replace(/\s+/g, ' ');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function normalizeAd(raw, now = new Date().toISOString()) {
    if (!raw || !/^[0-9]+$/.test(String(raw.id))) throw new Error('API_SCHEMA: missing numeric ad ID');
    const properties = Array.isArray(raw.properties) ? raw.properties : [];
    const condition = properties.find(p => ['állapot', 'ingatlan állapota', 'az ingatlan állapota'].includes(fold(p.name)));
    const photos = [...(raw.photos ?? []), ...(raw.mediumLargePhotos ?? []), ...(raw.detailedPhotos ?? [])];
    const images = [...new Set(photos.map(p => text(typeof p === 'string' ? p : p?.url)).filter(u => /^https:\/\//.test(u)))];
    return {
        source: 'ingatlan.com', id: String(raw.id), url: `https://ingatlan.com/${raw.id}`,
        title: text(raw.listingAndPropertyType) || [text(raw.listingTypeFormatted), text(raw.propertyTypeFormatted)].filter(Boolean).join(' ') || 'Ingatlan',
        price: text(raw.price), priceHuf: Number.isFinite(raw.priceHuf) ? raw.priceHuf : null,
        city: text(raw.city), address: text(raw.addressTitle) || text(raw.location?.address),
        area: raw.areaSizeSqm > 0 ? raw.areaSizeSqm : null, rooms: text(raw.roomCount),
        condition: text(condition?.value), description: text(raw.description), images,
        sellerType: text(raw.listingOwnerType).toUpperCase(), inactive: raw.inactive === true,
        // Preserve the source's field name until its time semantics have been verified.
        sourceCreatedAtRaw: raw.createdAt ?? null, firstSeenAt: now,
        agenciesAccepted: raw.agenciesAccepted === true, agenciesNotAccepted: raw.agenciesNotAccepted === true,
    };
}

// Deliberately conservative: exact content + physical details + two identical image URLs.
// Recompressed/copied photos on other portals need a separately validated image matcher.
export function propertyKey(ad) {
    if (!ad.city || !ad.area || !ad.rooms || ad.description.length < 120 || ad.images.length < 2) return null;
    return hash(JSON.stringify([fold(ad.city), fold(ad.address), ad.area, fold(ad.rooms),
        fold(ad.description), [...ad.images].sort()]));
}
export function matches(ad, filter = {}) {
    if (ad.sellerType !== 'PRIVATE' || ad.inactive) return false;
    if (filter.city && fold(ad.city) !== fold(filter.city)) return false;
    for (const [field, min, max] of [['priceHuf', filter.minPrice, filter.maxPrice], ['area', filter.minArea, filter.maxArea]]) {
        if ((min != null || max != null) && ad[field] == null) return false;
        if (min != null && ad[field] < min || max != null && ad[field] > max) return false;
    }
    return true;
}
