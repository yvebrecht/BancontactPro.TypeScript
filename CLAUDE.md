# BancontactPro.TypeScript

Idiomatische TypeScript-client voor de Bancontact Pro-API's (Payment, Refund, Reconciliation). Geen officieel Bancontact-project.

## Bronnen in volgorde van gezag

1. Bancontact Pro-documentatie en OpenAPI-specs: https://docs.bancontactpro.com/ (Payment v3.6.5, Refund v3.0.3, Reconciliation v3.0.1, productgidsen, callback-gids).
2. `../BancontactPro.Net` als vergelijking en bron van testvectoren (`../BancontactPro.Python` is de zusterimplementatie op dezelfde bronnen). Dit is **geen directe port**. Bij conflict wint de documentatie.

Verzin geen Bancontact-gedrag. Elke gedragsbeslissing verwijst naar een documentatiepagina of spec-operatie (docstring of commentaar). Wat niet gedocumenteerd is, noteer je als open vraag in het issue. Afwijkingen met de .NET-code meld je in BancontactPro.Net met het label `spec-discrepancy`.

Werk met `claude --add-dir ../BancontactPro.Net` om de .NET-code te kunnen lezen (zijn CLAUDE.md wordt niet geladen).

## Ontwerp

- Strikte TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM, Node.js >= 20 (CI: 20, 22, 24), `async`/`await`, `camelCase`. Fouten zijn `Error`-subklassen in `errors.ts`.
- Pakketnaam: `@yvebrecht/bancontactpro` (nog niet gereserveerd).
- Versie: major.minor loopt gelijk met alle taalversies (nu 0.2); patch en prerelease-deel zijn vrij per taal. SemVer-formaat `0.2.0-preview.1`, enige bron `src/version.ts` (een test houdt `package.json` gelijk); git-tags `v0.2.0-preview.1`.
- **Geen runtime-afhankelijkheden.** `node:crypto` doet ES256 (raw `r || s`) en JWK-import; de globale `fetch` is de HTTP-client en is injecteerbaar. Dit wijkt af van het idee in de issues om `jose` te gebruiken: `jose` kan de eigen `crit`/`path`/`iat`-regels en de cache-regels niet vervangen, dus het zou enkel een extra afhankelijkheid zijn.
- Modellen zijn interfaces; `src/schema.ts` beschrijft ze tijdens runtime (parsen, verplichte velden, datums naar `Date`) en voedt de contracttests. Wire-namen = eigenschapsnamen, ook `_links`. Ongezette optionele velden worden weggelaten, nooit als `null` verstuurd. Een expliciete `null` in een antwoord geldt als afwezig.
- Onbekende enumwaarden crashen niet: `const`-object + uniontype met `(string & {})`.
- Credentials worden per aanroep gelezen (`BancontactClientFactory`) en nooit gecachet; een client is gebonden aan één product.
- Payment-calls: alleen `Authorization: Bearer`. Refund en Reconciliation: ook `Signature`.
- Er wordt nooit automatisch herhaald (ook niet bij 429/503); dat is een keuze van de aanroeper.
- `totalAmount` niet modelleren (verplicht maar niet gedefinieerd in de specs).
- Geen telemetrie en geen netwerkverkeer naar de aanbieder.

## Commando's

```bash
npm install
npm test                      # vitest, gemockte HTTP, geen echt netwerk
npm run lint                  # eslint + tsc --noEmit
npm run build                 # tsc -> dist/
npm run check                 # alles, zoals de CI
```

Tests: vitest met een eigen `FakeFetch` (`tests/helpers.ts`). Geen echte credentials of netwerk.

## Status en grenzen

- De repo staat onder Apache-2.0 (LICENSE en NOTICE, copyright Axel Dewaele). Het project is onafhankelijk en maakt geen aanspraak op de merken Bancontact of Bancontact Pro (zie NOTICE). **Er wordt niets gepubliceerd (npm, tags, releases, publiek maken) zonder uitdrukkelijk akkoord.**
- Open punten bij Bancontact: zie BancontactPro.Net#1, #2, #9 en #10 (`..` in de Signature, scheiding in de signing input, callback-retries, callback-headerclaims), de JWKS-URL's en de preprod-payhost.
- Commit alleen op verzoek, met het Gmail-adres (zie geheugen), nooit met het werkadres.
