# Android-interfész: statikus bizonyítékok

Forrás: a felhasználó által feltöltött `ingatlan.com_4.0.5_APKPure.xapk`, `com.ingatlan.searcher`, build 273. DEX osztályok és Retrofit-annotációk statikus vizsgálata; az alkalmazást nem futtattuk. Nincs kinyert kulcs, tanúsítvány, session vagy személyes adat a repóban.

## Hostok

- `https://mobile-gateway.ingatlan.com`
- `https://mobile-gateway-go.ingatlan.com`

## Relatív Retrofit-sablonok

| Osztály / metódus | HTTP | Sablon |
|---|---|---|
| ApiService.searchInAds | GET | `users//ads/search/{searchQuery}` |
| ApiService.getAd | GET | `users//ads/{adId}` |
| ApiService.searchCount | GET | `users//adsCount/{url}` |
| ApiService.urlProcess | GET | `users//process/{url}` |
| ApiService.loadClusterAds | GET | `users//clusterAds/{adId}` |
| GoApiService.autoSuggest | GET | `users-sub//autosuggest` |

`searchInAds`: `searchQuery` encoded path-paraméter, `page` query-paraméter, továbbá `ProtectionTag`. A keresési interfész `/v1/` előtagot kap. A `users//` és `users-sub//` szakaszokat a `UserIdInterceptor` kezeli; az anonim keresés végleges útvonala alább szerepel.

## DTO-kban talált mezők

`PagedListDto.data` → `PagedDataDto`: `list`, `pages`, `totalFound`.

`AdDetailResponse.data` → `AdDto`.

`AdDto`: `id`, `price`, `priceHuf`, `city`, `addressTitle`, `location`, `areaSizeSqm`, `areaSize`, `lotSize`, `roomCount`, `description`, `photos`, `mediumLargePhotos`, `detailedPhotos`, `properties`, `listingOwnerType`, `createdAt`, `sentDate`, `sentDay`, `inactive`, `statusId`, `clusterCount`, `agenciesAccepted`, `agenciesNotAccepted` és további mezők.

`PhotoDto`: `url`, `title`, `type`.

`PropertyDto`: `name`, `value`.

`ListingOwnerType`: `PRIVATE`, `OFFICE`, `RESIDENTAL` (az utóbbi a kódban így szerepel).

Az éles JSON-mezőneveket az alább leírt keresési válasszal ellenőriztük; a közzétételi idő pontos jelentése továbbra sincs igazolva. A normalizáló ezért a `createdAt` értékét csak `sourceCreatedAtRaw` néven őrzi meg.

## Hozzáférés

`HeaderInterceptor`: alkalmazás-/eszközfejlécek, opcionális Bearer-kezelés. `AppCheckInterceptor`: `X-Firebase-AppCheck` fejléc kezelése. `ProtectionLevel`: `STANDARD`, `STRONG`. Ez védelmi mechanizmus jelenlétét jelzi, nem azt, hogy minden végpont azonos védelmet követel.

A gateway gyökércímének első HEAD-próbája HTTP 401 választ adott. Ez nem a keresési végpont volt; az alább dokumentált teljes keresési kérés sikeres. A produkciós adapter auth-hibánál megáll.

## A teljes kérés igazolása és élő eredmény (2026-10-19)

Az `ModuleKt.retrofitModule$lambda$0$provideRetrofit` metódus a produkciós hosthoz `/v1/` előtagot ad. A `UserIdInterceptor.addUserId` kijelentkezett ágában a `users//` teljes szakaszt üres szövegre cseréli (nem egyszerű perjel-normalizálás).

Ezért a végleges anonim keresés:

`GET https://mobile-gateway.ingatlan.com/v1/ads/search/{searchQuery}?page={page}`

A `HeaderInterceptor` konstruktorában és `addBaseHeaders` metódusában talált, működő verzióadatok:

- `apiLevel: 115`
- `buildNumber: 273`
- `channel: ANDROID`
- `Accept: application/json`

Az azonosított végpont verziófejlécek nélkül HTTP 426 választ adott (alkalmazásfrissítést kért). A fenti három verziófejléccel HTTP 200 `status: success` választ adott. Bejelentkezési token, App Check token, client certificate vagy eszközazonosító nem volt a tesztkérésben. Védelmet nem kellett megkerülni.

| Keresés | HTTP | Találat | Oldal | Első oldali magánhirdetés |
|---|---:|---:|---:|---:|
| `elado+lakas+tatabanya` | 200 | 695 | 35 | 14 / 20 |
| `elado+haz+kecsked` | 200 | 18 | 1 | 4 / 18 |

Ezek pillanatfelvétel-adatok, nem állandó darabszámok. Az éles válasz igazolja a `data.list`, `data.pages`, `data.totalFound` szerkezetet. A képek `photos` listájában URL-karakterláncok is vannak, nem csak objektumok. Az állapot neve a `properties` listában **`Az ingatlan állapota`**. A címhez a `listingTypeFormatted` és `propertyTypeFormatted` összefűzhető. Ezeket a javított normalizáló kezeli.

A `npm run test:live` a valódi `MobileSource` és `Engine` kóddal két teljes kecskédi lekérést is sikeresen lefuttatott: 18 hirdetés csendes bootstrapja, majd 0 új esemény az ismételt lekérésben, összesen kb. 6 másodperc alatt. A küldő ebben a próbában helyettesítő volt: valódi Telegram-üzenet nem ment ki. Természetesen érkező új hirdetésen még nem figyeltünk meg éles kézbesítést. Más végpontokat és az adatfelhasználás szerződéses feltételeit ez nem minősíti.
