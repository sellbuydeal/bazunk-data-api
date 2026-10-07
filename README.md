# Bazunk Data API

Standalone product-data API for Bazunk and future third-party clients.

## Goals

- One stable API contract for multiple commerce data providers.
- Keep provider acquisition logic isolated from Bazunk Marketplace.
- Support API keys, rate limits, caching/usage metering and commercial plans.
- Never expose upstream provider credentials to marketplace clients.
- Add only data sources whose access and redistribution terms have been approved.

## Providers

The registry currently reserves adapters for:

- Amazon
- eBay
- Walmart
- AliExpress

They intentionally start disabled. A provider becomes live only when a concrete, permitted upstream implementation and its credentials/configuration are installed.

## API

Public:

- `GET /`
- `GET /health`

Authenticated with `X-API-Key`:

- `GET /v1/providers`
- `GET /v1/products/search?provider=amazon&q=...`
- `GET /v1/products/:provider/:externalId`

Every provider returns the same normalized product shape, including source URL, external ID, title, description, price/currency, images, brand/category, features, variants, availability and retrieval timestamp.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Use a strong random development key in `BAZUNK_API_KEYS`. Multiple keys can be comma-separated during this bootstrap phase.

## Deployment

A Render blueprint is included in `render.yaml`. Set `BAZUNK_API_KEYS` and allowed `CORS_ORIGINS` in Render; never commit production secrets.

## Planned phases

1. Core service and normalized provider interface.
2. Amazon provider using an approved/permitted data source.
3. eBay provider using official API credentials once available.
4. Persistent API clients, hashed keys, quotas and usage metering.
5. Redis-compatible cache and provider request deduplication.
6. Walmart and AliExpress adapters.
7. Developer dashboard, plans/billing and public API documentation.

## Relationship to Bazunk Marketplace

Bazunk Marketplace should eventually call this service rather than individual upstream APIs. Existing imported listings remain Bazunk records and are not changed by deploying this service.
