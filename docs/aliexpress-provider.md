# AliExpress provider for Bazunk Data

The AliExpress provider implements the existing authenticated Bazunk Data API routes:

- `GET /v1/products/search?provider=aliexpress&q=wireless%20headphones&page=1`
- `GET /v1/products/aliexpress/1005000000000000`

Requests use the existing Bazunk Data `X-API-Key` authentication, quotas, usage metering and normalized product schema.

## Enablement

The provider is **disabled by default**. AliExpress's published API and website terms restrict redistribution/resale of product information. Obtain written permission covering the intended third-party commercial API use and verify that any intermediary provider permits redistribution before enabling it.

Once rights are confirmed, configure these **server-side** environment variables on the Bazunk Data API service:

```env
ALIEXPRESS_PROVIDER_ENABLED=true
ALIEXPRESS_RESALE_LICENSE_CONFIRMED=true
ALIEXPRESS_RAPIDAPI_KEY=<private-upstream-key>
```

Never place the upstream key in frontend code or commit it to GitHub. Do not enable either flag merely to test a commercial product without appropriate rights.

## Upstream integration

The current adapter uses AliExpress DataHub endpoints `item_search_2`, `item_detail_2`, and `item_detail`. Their live response shapes and your subscription's access have **not yet been verified**. The adapter normalizes known item shapes, but may require changes based on real provider payloads. Missing prices and stock are represented as unknown rather than fabricated.

This is an upstream-backed API, **not an independent scraper or first-party data feed**. A genuinely independent data source requires a separately authorized supplier feed, official API grant, or permitted data acquisition process.

## Launch checklist

1. Obtain explicit redistribution and resale permissions from AliExpress and the upstream API provider.
2. Confirm credentials and endpoint response structures in a controlled staging environment.
3. Add fixture-based tests for searches, item details, pagination, missing prices and upstream errors.
4. Verify API-key scopes, quotas, caching and usage records.
5. Enable only after a successful staging deployment and commercial/legal approval.
