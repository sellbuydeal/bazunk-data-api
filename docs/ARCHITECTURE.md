# Architecture

```text
Bazunk Marketplace / External Developer
                 |
             HTTPS + API key
                 |
          Bazunk Data API v1
                 |
       auth / quota / cache / logs
                 |
         Provider Registry
        /       |       \
    Amazon     eBay    Walmart   ...
      |          |        |
  adapter     adapter   adapter
      |          |        |
 approved/official/permitted upstream source
```

## Provider contract

Each provider implements:

- `isConfigured()`
- `search()`
- `getProduct()`
- optionally `getProductByUrl()`

Provider-specific payloads are normalized before leaving the service. Consumers therefore do not depend on Amazon/eBay/etc response formats.

## Commercial API direction

The bootstrap uses environment API keys. Before external sales, keys should move to persistent hashed client records with scopes, plan quotas, usage events, key rotation/revocation and billing integration.

## Security principles

- Upstream credentials stay server-side.
- Production API keys are never committed.
- Health endpoints disclose configuration state, not secrets.
- External URLs/identifiers must be validated by provider adapters.
- Acquisition adapters should not be implemented until their data access method has been approved for the intended use.
