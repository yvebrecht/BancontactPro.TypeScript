# Stored OpenAPI specs

Verbatim copies of Bancontact's published specs, used by `tests/contract.test.ts`:

| File | Source | Version |
|---|---|---|
| `merchant-payment.openapi.json` | https://docs.bancontactpro.com/_bundle/apis/merchant-payment.openapi.json | 3.6.5 |
| `refund-public.openapi.json` | https://docs.bancontactpro.com/_bundle/apis/refund-public.openapi.json | 3.0.3 |
| `merchant-reconciliation.openapi.json` | https://docs.bancontactpro.com/_bundle/apis/merchant-reconciliation.openapi.json | 3.0.1 |

Copied on 2026-10-19. They remain Bancontact's documentation; they are here only as test fixtures.

## Refreshing

1. Download the three files again from the URLs above, replacing these copies.
2. Run `npm test -- contract`. A failure lists what changed: properties in the spec that are not modelled, modelled
   properties that left the spec, changed required flags or value kinds, changed enum values, undocumented error codes, and added or removed operations.
3. Update the models (interface and schema), clients and docs for every difference, then bump `VERSIONS` and `OPERATIONS` in the test.
4. Report anything that contradicts the guides or the .NET library in BancontactPro.Net with the label `spec-discrepancy`.
