# BancontactPro.TypeScript

> **Dit is geen officieel project van Bancontact.** Deze bibliotheek is onafhankelijk ontwikkeld op basis van de openbare Bancontact Pro-documentatie en is niet gemaakt, goedgekeurd of ondersteund door Bancontact (of Payconiq). 'Bancontact' en 'Bancontact Pro' zijn merken van hun eigenaars en worden enkel beschrijvend gebruikt. Overzicht: [BancontactPro.SDK](https://github.com/yvebrecht/BancontactPro.SDK).

Een TypeScript-client voor de [Bancontact Pro](https://docs.bancontactpro.com/)-API's: Payment, Refund en Reconciliation, met request-signing, verificatie van callbacks via JWKS en QR-/deeplinkgeneratie. Geen runtime-afhankelijkheden: enkel `node:crypto` en `fetch`.

> **Status: in ontwikkeling, nog niet gepubliceerd en maar gedeeltelijk getest tegen Bancontact.** Alles is getest met gemockte HTTP. De verificatie van callbacks is daarnaast getest met een echte callback van Bancontacts preprod (opgeslagen als testvector en gecontroleerd met hun publieke sleutel). Betalingen aanmaken en de andere aanroepen zijn in deze taal nog niet tegen Bancontact geprobeerd; in BancontactPro.Net wel (een betaling aanmaken en lezen). Het pakket staat nog niet op npm en de naam `@yvebrecht/bancontactpro` is nog niet gereserveerd. De bibliotheek is gebouwd op de documentatie en specs van Bancontact, niet als port van een andere taalversie.

## Vereisten

Node.js 20 of hoger (ESM). Strikte TypeScript-types worden meegeleverd.

## Credentials

Bancontact geeft per producttype (On a Display, On a Receipt, Static QR, Top Up) een API-key en een PPID. Refund- en Reconciliation-aanvragen moeten bovendien ondertekend worden met jouw eigen ES256-sleutel (P-256); de publieke sleutel host je als JWKS en deel je met Bancontact (`toPublicJwkJson` maakt die JWK). Voor de Payment-API volstaat de API-key.

```ts
import { BancontactClientFactory, BancontactEnvironment, BancontactProduct } from '@yvebrecht/bancontactpro';
import { readFileSync } from 'node:fs';

const factory = new BancontactClientFactory({
  environment: BancontactEnvironment.Preprod, // standaard; Production voor echte betalingen
  products: { [BancontactProduct.OnDisplay]: { apiKey: '...', merchantProfileId: '...' } },
  signingKey: { kid: 'mijn-kid', privateKeyPem: readFileSync('key.pem', 'utf8') },
});
```

In plaats van een vast object kun je een functie meegeven (sync of async) die de actuele credentials teruggeeft, bijvoorbeeld uit een kluis of database. De bibliotheek roept ze bij elk gebruik opnieuw aan en cachet niets. Met de optie `fetch` geef je je eigen HTTP-functie mee (proxy, tests). Er wordt nooit automatisch herhaald, ook niet bij 429 of 503.

## On a Display: een betaling aanmaken

Zie [examples/payment.ts](examples/payment.ts) en de [productgids](https://docs.bancontactpro.com/guides/instore/ondisplay052025v4).

```ts
const payments = await factory.payments(BancontactProduct.OnDisplay);
const payment = await payments.create({ amount: 1000, reference: 'order-42' });
console.log(payment._links.qrcode.href, payment._links.deeplink.href);

const status = await payments.get(payment.paymentId); // polling als terugval voor de callback
```

Bedragen zijn gehele getallen in cents (1 tot 999.999.999.999). Bij een time-out op `create` is de uitkomst onbekend: zoek eerst op `reference` met `payments.search(...)` voor je opnieuw probeert.

## Static QR

Zie [examples/payment.ts](examples/payment.ts) en de [productgids](https://docs.bancontactpro.com/guides/instore/staticqr052025v4).

```ts
const payments = await factory.payments(BancontactProduct.StaticQr);
await payments.createStaticQrPayment({ amount: 1000, posId: 'POS00001' });
```

## On a Receipt en Top Up: QR-links bouwen

Geen API-call; zie [examples/qr.ts](examples/qr.ts), de [receipt-gids](https://docs.bancontactpro.com/guides/instore/receipt052025v4) en de [top-up-gids](https://docs.bancontactpro.com/guides/online/topup052025v4).

```ts
import { BancontactEnvironment, qr } from '@yvebrecht/bancontactpro';

const payload = qr.buildFixedAmountPaymentUrl(BancontactEnvironment.Production, ppid, { amountCents: 1000, description: 'Kassabon' });
const imageUrl = qr.buildQrCodeImageUrl(BancontactEnvironment.Production, payload);
```

Gebruik voor payload en afbeelding dezelfde omgeving. De preprod-host voor zelfgebouwde links is niet gedocumenteerd (open vraag); de bibliotheek gebruikt `pay.acc.bancontact.net`. Volgens de documentatie biedt Bancontact Online Sales en Invoice niet meer rechtstreeks aan; die producten zijn hier niet uitgewerkt.

## Een callback verifiëren

Zie [examples/callback.ts](examples/callback.ts) en de [callback-gids](https://docs.bancontactpro.com/guides/general/callback052025). Geef de **ruwe** body-bytes door, niet een opnieuw geserialiseerde JSON, samen met de `Signature`-header en het pad van het verzoek.

```ts
const verifier = factory.callbackVerifier(); // hergebruik: de JWKS-cache zit erin

try {
  const { payload, requestId } = await verifier.verifyAndParse(signatureHeader, rawBody, '/callback');
  handle(payload.status, requestId); // requestId (jti) is uniek per bericht
} catch (error) {
  if (error instanceof InvalidCallbackError) { /* niet vertrouwen: antwoord met een foutstatus */ }
}
```

Antwoord pas met `200` na verificatie en verwerking. Bancontact herhaalt callbacks met identieke inhoud, dus verwerk idempotent.

**Wat Bancontact echt stuurt** (gecontroleerd op preprod, 2026-10-24):

- de `Signature`-header is `header..signature`, met twee punten (de verifier accepteert ook één punt);
- het `path`-claim is de **geregistreerde callback-URL**, niet alleen een pad: de verifier vergelijkt het pad van die URL met het pad dat je meegeeft en laat de host buiten beschouwing;
- de handtekening loopt over `base64url(header) + "." + base64url(body)`, met de body zoals ontvangen;
- Bancontact moet de URL via openbaar HTTPS bereiken. Zet er geen login, pad-herschrijving of bodywijziging voor. Bij een weigering (401) probeert Bancontact opnieuw, in bursts van vier.

Probeer het met de [sample en haar opzetgids](https://github.com/yvebrecht/BancontactPro.SDK.Samples.TypeScript/blob/main/docs/setting-up-the-samples.md): het debugpaneel toont de ruwe body en een analyse van de header.

## Terugbetalingen en reconciliatie

Zie [examples/refund.ts](examples/refund.ts), [examples/reconciliation.ts](examples/reconciliation.ts) en de gidsen over [refunds](https://docs.bancontactpro.com/guides/general/refunds052025) en [reconciliation](https://docs.bancontactpro.com/guides/general/reconciliation052025).

```ts
const refunds = await factory.refunds(BancontactProduct.OnDisplay);
await refunds.create(paymentId, { amount: 500, currency: 'EUR' }, 'refund-order-42');

const reconciliation = await factory.reconciliation(BancontactProduct.OnDisplay);
for await (const payout of reconciliation.iteratePayouts({ date: '2026-01-02' })) console.log(payout.payoutId);
```

Geef bij `refunds.create` altijd zelf een idempotency-key mee als je de aanvraag kunt herhalen (maximaal 64 tekens). Hergebruik van dezelfde sleutel met andere parameters geeft een `RefundIdempotencyConflictError`. De antwoorden van Reconciliation dragen zelf een `Signature`; die wordt voorlopig niet geverifieerd (open vraag).

## Fouten

Een niet-succesvol antwoord geeft een `BancontactApiError` met `status`, `code` (vergelijk met `BancontactErrorCode`), de ruwe `body` en, alleen bij de Payment-API, `traceId` en `spanId` voor een supportticket. Een body die niet de standaardvorm heeft (bijvoorbeeld van een gateway) blijft letterlijk bewaard. Een niet-geconfigureerd product of een ontbrekende signing-sleutel faalt bij het aanmaken van de client. Onbekende enumwaarden (bijvoorbeeld een nieuwe betalingsstatus) breken het parsen niet: houd een `default`-tak.

## Licentie

Apache License 2.0, zie [LICENSE](LICENSE) en [NOTICE](NOTICE). Copyright 2026 Axel Dewaele.

Dit is een onafhankelijk project, niet verbonden aan, goedgekeurd of ondersteund door Bancontact. "Bancontact" en "Bancontact Pro" zijn merken van hun eigenaar. De namen worden alleen gebruikt om aan te geven waarmee de bibliotheek werkt. De licentie geeft geen rechten op die merken en de rechthebbende van de code maakt er geen aanspraak op.

## Versies

SemVer in hetzelfde formaat als alle andere taalversies, bijvoorbeeld `0.2.0-preview.1`. De regels (major en minor gelijk over alle talen) staan in de [README van BancontactPro.SDK](https://github.com/yvebrecht/BancontactPro.SDK#versioning).

## Ontwikkelen

```bash
npm install
npm run check   # lint, typecontrole, tests en build
```

Zie [CLAUDE.md](CLAUDE.md) voor de ontwerpkeuzes en [tests/specs](tests/specs/README.md) voor het vernieuwen van de opgeslagen specs.
