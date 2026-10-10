/** Published importer packages; billing stays disabled until quota and payment checks are live. */
export const IMPORTER_PACKAGES = [
 {code:"mini",usdCents:399,requests:1000},
 {code:"starter",usdCents:799,requests:2000},
 {code:"plus",usdCents:1499,requests:4000},
 {code:"pro",usdCents:2499,requests:7000},
 {code:"business",usdCents:3499,requests:10000}
] as const;
export const EXTRA_REQUEST_USD_CENTS = 15;
export const IMPORTER_CHECKOUT_ENABLED = false;
