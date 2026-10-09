# AliExpress official API integration — Bazunk

## Implemented
- Official signed AliExpress Affiliate `aliexpress.affiliate.product.query` search and `aliexpress.affiliate.productdetail.get` lookup in `src/providers/aliexpress/official-api.ts`.
- First-party internal routes: `GET /internal/aliexpress/search?q=...&page=1&currency=USD&country=GB` and `GET /internal/aliexpress/products/:id`, requiring `Authorization: Bearer <ALIEXPRESS_INTERNAL_TOKEN>`.
- Normalized products for the existing Bazunk importer.
- Public `/v1/products` provider stays **disabled** until commercial redistribution permission is confirmed (`ALIEXPRESS_RESALE_LICENSE_CONFIRMED=true` and `ALIEXPRESS_PROVIDER_ENABLED=true`).
- No scraper fallback in the official provider.

## Required Render secrets (Data Platform service)
- `ALIEXPRESS_APP_KEY=552320`
- `ALIEXPRESS_APP_SECRET` — secret; never commit it
- `ALIEXPRESS_TRACKING_ID` — affiliate tracking ID, if authorised
- `ALIEXPRESS_INTERNAL_TOKEN` — generate a strong random secret, shared only with Bazunk's API server
- `ALIEXPRESS_API_GATEWAY` — optional; defaults to `https://api-sg.aliexpress.com/sync`

## Required Render secrets (Bazunk marketplace API)
- `BAZUNK_DATA_API_URL` — URL of the **Data API** backend, not the developer website
- `BAZUNK_DATA_INTERNAL_TOKEN` — same value as `ALIEXPRESS_INTERNAL_TOKEN`

Set both sides before expecting live official API results. The existing scraper is still used when the first-party bridge is not configured.

## Pending before production release
1. Verify AliExpress Affiliate API permissions for App Key 552320, not just Online application status.
2. Confirm exact gateway/signature format and product search/detail response payload with live authorised calls; the adapter has **not** been verified against a real response.
3. Verify tracking ID availability and terms of use. Do not invent a tracking ID.
4. Add and test OAuth authorisation-code callback at `https://bazunk.com/api/integrations/aliexpress/callback`, secure state verification, encrypted token persistence and refresh. Registering the callback URL in AliExpress does **not** create the route. OAuth flow may not be required for all Affiliate methods; confirm method-specific requirements.
5. Test search, detail, bulk import, price/currency conversion, duplicate handling and sync against live data.
6. Remove the legacy scraper fallback after successful end-to-end tests.
7. Do **not** enable paid resale to third parties without explicit AliExpress redistribution permission.

## Internal smoke test
```bash
curl -H "Authorization: Bearer $ALIEXPRESS_INTERNAL_TOKEN" \
  "$DATA_API_URL/internal/aliexpress/search?q=lamp&page=1&currency=USD&country=GB"
```
Never put credentials or access tokens in GitHub issues, logs or screenshots.
