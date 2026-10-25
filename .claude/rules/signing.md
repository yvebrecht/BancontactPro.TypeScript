---
paths:
  - "src/signing.ts"
  - "src/http.ts"
  - "src/jwks.ts"
  - "src/webhooks.ts"
  - "tests/signing.test.ts"
  - "tests/webhooks.test.ts"
---

# Signing en callbackverificatie

- ES256 over P-256. De handtekening is altijd raw `r || s` (64 bytes, IEEE P1363), nooit DER. In `node:crypto`: `dsaEncoding: 'ieee-p1363'` bij `sign` en `verify`.
- Formaat `base64url(header)..base64url(signature)` (twee punten, RFC 7797) volgens de callback-gids en de Payment-spec. Verificatie tolereert ook één punt. De signing input is `base64url(header) + "." + base64url(body)`; bevestigd met een echte preprod-callback (2026-10-24, gecontroleerd met de publieke sleutel van Bancontact). Welke vorm Bancontact op *verzoeken* accepteert (`.` of `..`) is nog niet bevestigd (BancontactPro.Net#1).
- Sign en verifieer de body-bytes exact zoals verstuurd of ontvangen, nooit een herserialisatie. `Transport.request` serialiseert één keer en verstuurt precies die bytes.
- Het `path`-claim van een uitgaand verzoek is het pad van de request-URI zonder querystring, in de verzonden (percent-encoded) vorm.
- Bij een inkomende callback is het `path`-claim de callback-URL die de merchant registreerde (echte preprod-callback: `https://host/bancontact/callback`). De verifier laat een absolute http(s)-URL gelden als het pad van die URL gelijk is aan het ontvangen pad; de host wordt niet vergeleken.
- Een onbekend of ontbrekend `crit`-claim betekent afwijzen. De verifier geeft `undefined` terug, de callback-verifier gooit `InvalidCallbackError`.
- JWKS: herladen bij onbekende `kid` (gecoalesceerd, met afkoelperiode tegen herlaadstormen), cache maximaal 12 uur, één cache per omgeving.
- Nooit een sleutel, API-key of licentiesleutel loggen of in een foutmelding tonen.
