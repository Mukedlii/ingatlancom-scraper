# Ingatlan Telegram-értesítő

Node.js-alapú, Apify és böngészőautomatizálás nélküli értesítő. **Az ingatlan.com mobil keresési adatkapcsolata élő HTTP 200 válasszal ellenőrzött.** A teljes szolgáltatás még nincs telepítve vagy elindítva. Nincs Vercel-integráció, telepítés vagy automatikusan indított időzítés.

## Ami elkészült

- Az Android 4.0.5 / build 273 alkalmazásból azonosított interfészhez mobil-API adapter.
- Privát (`PRIVATE`) hirdetők szűrése; ismeretlen és irodai hirdetők kizárása.
- Város-, ár- és alapterület-szűrők; ugyanazt a keresést több címzett közösen használja.
- Minden új vagy módosított keresés első teljes állapotfelvétele csendes.
- Új forrásazonosítók felismerése; azonos hirdetés és árváltozás nem generál új üzenetet.
- Telegram-kép, ár, cím, méret, szobaszám, állapot (ha elérhető) és eredeti link.
- Upstash REST tartós állapot, lejáró zárolás, tulajdonoshoz kötött mentés, kimenő üzenetsor és késleltetett újrapróbálás.
- Konzervatív tartalmi egyezés: teljes normalizált leírás, fizikai jellemzők és legalább két azonos kép-URL. Az ár nem része az egyezésnek.
- Node beépített tesztfuttatóval tesztek, köztük teljes HTTP küldési folyamat helyi Telegram-helyettesítővel.

## Élő ellenőrzés és további korlátok

- Az ellenőrzött anonim keresési cím: `https://mobile-gateway.ingatlan.com/v1/ads/search/{query}?page={page}`. A szükséges `apiLevel`, `buildNumber`, `channel` verziófejlécek automatikusak. Tatabányai és kecskédi keresés HTTP 200 választ adott bejelentkezés és App Check token nélkül.
- Az `elado+lakas+tatabanya` és `elado+haz+kecsked` keresési kifejezések élőben működtek. Más szűrők, a legújabb szerinti rendezés és a szerveroldali időmezők pontos jelentése még külön ellenőrzendő.
- Firebase App Check és tokenkezelés szerepel a kliensben, de a tesztelt anonim keresés ezeket nem igényelte. Más végpontokra és későbbi változásokra ez nem garancia. A program nem állít elő vagy nyer ki ilyen tokent.
- Facebook, Jófogás, Zenga stb. adatkapcsolat még nincs. A közös modell és küldő később új adapterrel bővíthető.
- Keresztportálos perceptuális kép-összehasonlítás nincs: eltérő képcím/tömörítés mellett az első verzió inkább kettőt küld, mint tévesen elnyomjon egy új lakást.
- Nincs előfizetéskezelés, fizetés, Telegram-beállítómenü vagy 60 másodperces SLA.

## Tesztek – fiók és titkos kulcs nélkül

Node.js **22.9+** szükséges. Külső npm-függőség nincs.

```bash
npm ci
npm test
```

A tesztek nem érik el az ingatlan.com-ot vagy a valódi Telegramot, és nem küldenek üzenetet valódi felhasználónak. Az integrációs teszt valódi HTTP-n fogadja és ellenőrzi a létrejött `sendPhoto` kérést egy ideiglenes helyi szerveren.

## Élő API-próba – bot és Redis nélkül

Az ellenőrzött cím és verziófejlécek alapértelmezettek; a próbához `.env` sem szükséges. Opcionálisan az `INGATLAN_SEARCH_URL_TEMPLATE` és `INGATLAN_API_HEADERS_JSON` felülírhatja őket. A későbbi worker `NOTIFIER_SEARCHES_JSON` beállításában numerikus Telegram-chat ID-k legyenek karakterláncként.

```bash
npm run probe
npm run probe -- elado+lakas+tatabanya
npm run test:live
```

A `probe` az első oldalt kérdezi le, mezőneveket, darabszámokat és egy publikus magánhirdetés fő adatait írja ki. A `test:live` két teljes, kis körzetre szűrt élő lekérést futtat a valódi feldolgozóval, memóriabeli állapottal és tesztküldővel: ellenőrzi a csendes bootstrapot és az ismételt feldolgozást. Egyik parancs sem küld valódi Telegram-üzenetet vagy ír Redisbe. A CI csak offline teszteket futtat.

A `data.list`, `data.pages`, `data.totalFound`, ár-, képi és hirdetőtípus-mezőket éles válasszal ellenőriztük. 401/403/429 esetén megáll, 426 esetén külön verziófrissítési hibát jelez.

## Valódi Telegram-próba

Állítsd be a saját projekt `TELEGRAM_BOT_TOKEN` és `TELEGRAM_TEST_CHAT_ID` értékeit, és indítsd el a botot Telegramon a `/start` paranccsal.

```bash
npm run test:telegram
```

Egy egyértelműen **TESZT** feliratú, kitalált ingatlant küld, az ingatlan.com lekérdezése és Redis nélkül. Alapból szöveges; `TELEGRAM_TEST_IMAGE_URL` megadásával képes küldés is tesztelhető. Ez nem valódi hirdetés vagy piaci találat.

## Későbbi futtatás

API-hozzáférés, bot és Upstash beállítása után:

```bash
npm run check
npm start
```

Az első parancs egy ciklus, a második folyamatos worker. Most nem telepítünk semmit. Alapértelmezett periódus 60 másodperc; ez nem jelent 60 másodperces kézbesítési garanciát. A 15–3600 másodperc közötti periódus csak a forrás korlátaihoz igazítva használható. Hiba esetén exponenciális várakozás következik.

A teljes keresési készletet olvassuk be, legfeljebb `MAX_SCAN_PAGES` oldalig. A korlát elérése, hiányzó lap vagy lapozás közben változó találatszám hibát jelent: nincs részleges állapotfelvétel. Indulásnak kis körzetet válassz. A magas forgalmú országos gyűjtéshez validált legújabb/cursor alapú adapter szükséges.

## Kézbesítési és tárolási korlátok

- A kimenő sor mentése megelőzi a küldést; sikertelen küldés megmarad. A forrás hibája esetén a ciklus leáll, a függő küldések a következő sikeres ciklusban folytatódnak.
- A Telegram nem biztosít kliensoldali idempotenciakulcsot. Ha a küldés sikerül, de a válasz vagy az utána következő mentés elvész, újrapróbáláskor ritkán kettős üzenet lehet. Ez nem pontosan-egyszer kézbesítés.
- A 180 másodperces Redis-lease hosszabb a legfeljebb 60 másodperces feldolgozási ciklusnál. Az írás Lua-feltétellel ellenőrzi a lock tulajdonosát.
- A fejlesztési változat egy JSON-állapotot tárol. 8 MB felett szándékosan megáll; éles, nagy volumen előtt indexelt tárolás és archiválás szükséges. A `seen` rekordokat nem töröljük automatikusan, így régi hirdetés nem válik ismét újvá egy rövid TTL miatt.
- Az új keresés vagy címzett hozzáadása csendes alapállapotot kap. Ár-/szűrőváltozás nem tölt vissza korábbi hirdetéseket.
- Ne commitolj valódi tokeneket, alkalmazástanúsítványokat vagy APK-t. Az APK elemzésének publikus technikai eredménye: [docs/mobile-api.md](docs/mobile-api.md).
