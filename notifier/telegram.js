const clip = (s, n) => {
    let result = '';
    for (const char of String(s)) { if (result.length + char.length > n) break; result += char; }
    return result;
};
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function caption(ad) {
    const price = ad.price || (ad.priceHuf != null ? `${new Intl.NumberFormat('hu-HU').format(ad.priceHuf)} Ft` : 'Nincs megadva');
    return [ '<b>🏠 Új magánhirdetés</b>', esc(clip(ad.title, 100)),
        `💰 ${esc(clip(price, 100))}`, `📍 ${esc(clip(ad.address || ad.city || 'Nincs megadva', 180))}`,
        `📐 ${ad.area ?? '?'} m² · ${esc(clip(ad.rooms || '?', 50))} szoba`,
        `🏗️ Állapot: ${esc(clip(ad.condition || 'Nincs megadva', 100))}`, 'Forrás: ingatlan.com',
        `<a href="${ad.url}">Hirdetés megnyitása</a>` ].join('\n');
}
export class Telegram {
    constructor({ token, fetchImpl = fetch }) {
        if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
        this.token = token; this.fetch = fetchImpl;
    }
    async send(chatId, ad, signal) {
        const method = ad.images.length ? 'sendPhoto' : 'sendMessage';
        const content = caption(ad);
        const body = { chat_id: chatId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Hirdetés megnyitása', url: ad.url }]] },
            ...(ad.images.length ? { photo: ad.images[0], caption: content } : { text: content }) };
        let response;
        try { response = await this.fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: 'error' }); }
        catch { throw new Error('TELEGRAM_NETWORK'); }
        let result;
        try { result = await response.json(); } catch { throw new Error('TELEGRAM_RESPONSE'); }
        // Don't log response/request bodies: they can contain tokens or personal data.
        if (!response.ok || !result.ok) {
            const error = new Error(response.status === 429 ? 'TELEGRAM_RATE_LIMIT' : 'TELEGRAM_REJECTED');
            error.retryAfter = Number(result.parameters?.retry_after) || 60;
            throw error;
        }
        return result.result?.message_id;
    }
}
