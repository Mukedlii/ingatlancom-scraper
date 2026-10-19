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

`searchInAds`: `searchQuery` encoded path-paraméter, `page` query-paraméter, továbbá `ProtectionTag`. Az alkalmazásban `/v1/` és `/v2/` konstansok is vannak, de a teljes produkciós útvonal összeállítása még nincs végigkövetve. A `users//` és `users-sub//` szakaszokat a `UserIdInterceptor` kezeli, ezért ezeket nem szabad változtatás nélkül végleges URL-ként kezelni.

## DTO-kban talált mezők

`PagedListDto.data` → `PagedDataDto`: `list`, `pages`, `totalFound`.

`AdDetailResponse.data` → `AdDto`.

`AdDto`: `id`, `price`, `priceHuf`, `city`, `addressTitle`, `location`, `areaSizeSqm`, `areaSize`, `lotSize`, `roomCount`, `description`, `photos`, `mediumLargePhotos`, `detailedPhotos`, `properties`, `listingOwnerType`, `createdAt`, `sentDate`, `sentDay`, `inactive`, `statusId`, `clusterCount`, `agenciesAccepted`, `agenciesNotAccepted` és további mezők.

`PhotoDto`: `url`, `title`, `type`.

`PropertyDto`: `name`, `value`.

`ListingOwnerType`: `PRIVATE`, `OFFICE`, `RESIDENTAL` (az utóbbi a kódban így szerepel).

Az alkalmazásmodell mezőnevei még nem bizonyítják az éles JSON-mezőneveket, null-kezelést vagy közzétételi idő jelentését. A normalizáló ezért a `createdAt` értékét csak `sourceCreatedAtRaw` néven őrzi meg.

## Hozzáférés

`HeaderInterceptor`: alkalmazás-/eszközfejlécek, opcionális Bearer-kezelés. `AppCheckInterceptor`: `X-Firebase-AppCheck` fejléc kezelése. `ProtectionLevel`: `STANDARD`, `STRONG`. Ez védelmi mechanizmus jelenlétét jelzi, nem azt, hogy minden végpont azonos védelmet követel.

2026-10-19: a gateway gyökércímére egyetlen HEAD-kérés HTTP 401 választ adott. Nem történt sikeres keresési lekérés, hitelesítési kísérlet vagy védelmi mechanizmus megkerülése. A produkciós adapter konfigurálható, és auth-hibánál megáll.
