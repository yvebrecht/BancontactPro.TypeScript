---
paths:
  - "src/models.ts"
  - "src/schema.ts"
  - "src/enums.ts"
  - "src/clients.ts"
  - "tests/contract.test.ts"
---

# Modellen en clients

- Velden volgen de specs letterlijk, ook waar die onderling verschillen: `CreatePaymentResponse.expiresAt` tegenover `Payment.expireAt` is geen typfout. Een nieuw of gewijzigd veld hoort in de interface én in het schema (de compiler dwingt de sleutels af, `tests/contract.test.ts` de verplicht-vlag en het type).
- Optioneel is niet nullable: laat ongezette velden weg bij requests.
- Bedragen zijn gehele getallen in cents (1 - 999.999.999.999, `MIN_AMOUNT`/`MAX_AMOUNT`; de server valideert).
- Datums worden tolerant geparsed (met of zonder microseconden, `Z`, offset of zonder offset = UTC); requests sturen `yyyy-MM-ddTHH:mm:ss.fffZ` (`Date.toJSON`).
- Refundstatus kent geen `PROCESSING` (verwijderd in Refund API v3.0.2).
- Reconciliation: `startDate` en `endDate` altijd samen, hoogstens 30 dagen; `size` is vast 10000 in de spec.
- Een time-out bij `create` heeft een onbekende uitkomst: nooit blind opnieuw proberen (zoek eerst op `reference`).
