# Shopify importer integration audit — 9 October 2026

## Trace
Marketplace: /importers/shopify → ShopifyPublicImporter → authenticated POST /api/user/shopify-public/preview → product selection → authenticated POST /api/user/import-shopify-public → listings and supplier_imports.
Data Platform: ShopifyImporter → X-API-Key GET /v1/shopify/import-preview (products:read scope) → ShopifyProvider.browseUrl → selected-product handoff to https://bazunk.com/importers/shopify → marketplace seller authentication and import.
Scheduled and admin “sync all” both call the marketplace syncAllImports worker. No Data Platform API key is a marketplace seller credential.

## Concrete gaps fixed
- Marketplace preview used product .js prices (minor currency units) without conversion and assumed GBP. Both repositories now use the same tokenless Storefront GraphQL reader with Shopify money/currency values.
- Data Platform batch delimiter matched literal n instead of newline.
- Selection and duplicate handling used handles across stores. Selection and deduplication now use canonical source URLs.
- Collection/product URLs previously resolved as collection previews. Product URLs within collections now resolve to the product.
- Shopify source metadata was saved but the scheduled worker supported no Shopify source. Shopify now refreshes price/currency and availability, reapplies saved percentage or fixed markup, updates GBP value, and persists sync status/errors. Disabled imports are excluded from scheduled sync.
- Listing and supplier metadata inserts were separate. They now share a transaction and seller advisory lock; retries cannot create orphan listings.
- Client-provided handoff data was trusted for source prices. The authenticated marketplace re-reads each selected product before opening the transaction.
- Marketplace sign-in could interrupt handoff. The selection is retained for the browser tab; API secrets are excluded.

## Validation performed
- Marketplace fixture integration: unsigned requests rejected, product preview, server source revalidation, seller ownership, category/subcategory, percentage and fixed markup, different stores sharing a handle, duplicate retry, transaction rollback, enabled and disabled source sync.
- Data Platform provider fixture: supported URL shapes, rejected local/invalid URLs, store/collection pagination, real source currency, available variant pricing, missing products, upstream GraphQL and HTTP errors; batch delimiter and store-specific selection identity.
- Strict TypeScript check of the Shopify provider and storefront helper passed.
- Syntax compilation of changed marketplace/Data Platform frontend components passed.
- Additional Fastify authentication/private-URL regression cases are included but the full Data Platform app suite was not executed in this environment (complete dependencies unavailable).

## Production status and limits
Production has NOT been certified. Render monitoring returned “no workspace selected” and explicitly requires the user to confirm Chad's workspace before any workspace-specific read. The fixes are proposed on review branches, not deployed.
After merging/deploying both repositories, use a real authenticated seller and a supported public Shopify catalogue: preview a product and collection; deselect a product; import with 0/20 percent and fixed markup; confirm category, currency, GBP conversion and seller; inspect both persisted rows; change source price/availability; run tracked importer sync; confirm updates and disabled-sync exclusion.
The public Storefront interface supplies availability rather than exact private inventory counts. Listing quantity remains a 0/1 availability indicator. Catalogue previews are capped at 100 per URL. Browser handoff is capped at 100 selected products and 14,000 encoded characters, with an explicit smaller-batch message.

