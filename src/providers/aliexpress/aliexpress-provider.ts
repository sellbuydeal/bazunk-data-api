import type { ProductProvider, SearchOptions } from "../provider.js";
import type { NormalizedProduct, ProductSearchResult } from "../../types/product.js";
import { officialConfigured, officialSearch, officialProduct } from "./official-api.js";

/**
 * Official API only. Public resale is deliberately disabled unless separately licensed.
 * Bazunk's own marketplace uses the separately authenticated /internal/aliexpress routes.
 */
export class AliExpressProvider implements ProductProvider {
  readonly name = "aliexpress" as const;
  isConfigured(): boolean {
    return officialConfigured() &&
      process.env.ALIEXPRESS_RESALE_LICENSE_CONFIRMED === "true" &&
      process.env.ALIEXPRESS_PROVIDER_ENABLED === "true";
  }
  async search(options: SearchOptions): Promise<ProductSearchResult> {
    if (!this.isConfigured()) throw new Error("Public AliExpress data API access is not licensed or configured");
    return officialSearch(options);
  }
  async getProduct(externalId: string): Promise<NormalizedProduct | null> {
    if (!this.isConfigured()) throw new Error("Public AliExpress data API access is not licensed or configured");
    return officialProduct(externalId);
  }
  async getProductByUrl(url: string): Promise<NormalizedProduct | null> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "aliexpress.com" || parsed.hostname.endsWith(".aliexpress.com"))) throw new Error("Invalid AliExpress URL");
    const id = parsed.pathname.match(/\/item\/(\d{10,20})/)?.[1];
    if (!id) throw new Error("AliExpress product ID missing");
    return this.getProduct(id);
  }
}
