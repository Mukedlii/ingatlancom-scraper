import { Telegram } from './telegram.js';
import { normalizeAd } from './model.js';
try {
    const chatId = process.env.TELEGRAM_TEST_CHAT_ID;
    if (!chatId || !/^-?\d+$/.test(chatId)) throw new Error('config');
    const ad = normalizeAd({ id: 0, listingAndPropertyType: 'TESZT – nem valódi ingatlanhirdetés', price: '45 000 000 Ft',
        city: 'Tatabánya', addressTitle: 'TESZT helyszín', areaSizeSqm: 60, roomCount: '2',
        photos: process.env.TELEGRAM_TEST_IMAGE_URL ? [{ url: process.env.TELEGRAM_TEST_IMAGE_URL }] : [],
        listingOwnerType: 'PRIVATE', properties: [{ name: 'Ingatlan állapota', value: 'Tesztadat' }] });
    await new Telegram({ token: process.env.TELEGRAM_BOT_TOKEN }).send(chatId, ad, AbortSignal.timeout(10000));
    console.log('TELEGRAM_TEST_SENT');
} catch { console.error('TELEGRAM_TEST_FAILED: check bot token, chat ID and /start'); process.exitCode = 1; }
