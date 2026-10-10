export const PACKAGES_USD_CENTS = [500, 1000, 2500, 5000] as const;
export const DEFAULT_MARKUP_BPS = 17500n;
export const MIN_MARKUP_BPS = 15000n;
export const MINIMUM_SPREAD_MICRO_USD = 5000000n;
export function quoteImporterCall(supplierMicroUsd: bigint, markupBps: bigint = DEFAULT_MARKUP_BPS): bigint {
 if (supplierMicroUsd <= 0n || markupBps < MIN_MARKUP_BPS || markupBps > 100000n) throw new Error("Invalid importer pricing");
 const price = (supplierMicroUsd * markupBps + 9999n) / 10000n;
 const minimum = supplierMicroUsd + MINIMUM_SPREAD_MICRO_USD;
 return price > minimum ? price : minimum;
}
