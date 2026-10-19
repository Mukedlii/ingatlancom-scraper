# Ingatlan Telegram-értesítő

Node.js-alapú, Apify és böngészőautomatizálás nélküli értesítő. Jelenleg **fejlesztési alap, nem igazoltan működő éles ingatlan.com-adatkapcsolat**. Nincs Vercel-integráció, telepítés vagy automatikusan indított időzítés.

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

## Ami még nincs igazolva / nincs megvalósítva

- A végleges, interceptorok után előálló API-URL, az auth követelménye és az éles JSON-válasz. A host gyökércímére adott első HEAD-próba HTTP 401-et kapott; ebből nem következik minden keresési végpont hozzáférése.
- A teljes keresési kifejezés, a legújabb szerinti rendezés és a szerveroldali időmezők jelentése. A query példa nem igazolt mobil-API hívás.
- Firebase App Check és tokenkezelés szerepel a kliensben; a program nem állít elő, nem hamisít és nem nyer ki ilyen tokent.
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

## Későbbi API-próba

Másold a `.env.example` fájlt `.env` névre. Az `INGATLAN_SEARCH_URL_TEMPLATE` értékébe a ténylegesen validált teljes címet kell írni `{query}` és `{page}` helyőrzőkkel. A program nem találgat útvonalakat. A `NOTIFIER_SEARCHES_JSON` beállításban numerikus Telegram-chat ID-k legyenek karakterláncként.

```bash
npm run probe
```

Ez csak az első oldalt kérdezi le, mezőneveket és darabszámokat ír ki; nem ment állapotot és nem küld értesítést. 401/403/429 esetén megáll. A válaszban `data.list`, `data.pages`, `data.totalFound` szerkezetet vár a kódbeli DTO alapján. Ezt még éles válasszal ellenőrizni kell.

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
