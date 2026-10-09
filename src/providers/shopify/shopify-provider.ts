import type { ProductProvider, SearchOptions } from "../provider.js";
import { browseShopify } from "./public-storefront.js";
export class ShopifyProvider implements ProductProvider {
 readonly name = "shopify" as const;
 isConfigured() { return true; }
 browseUrl(input: string) { return browseShopify(input); }
 async search(o: SearchOptions) {
  if (!o.store) throw new Error("Shopify searches require store");
  const result = await browseShopify(o.store, o.query);
  return { provider: this.name, query: o.query, page: 1, items: result.items };
 }
 async getProduct(_externalId: string): Promise<null> { throw new Error("Shopify product lookup requires a source URL"); }
 async getProductByUrl(url: string) {
  const result = await browseShopify(url);
  if (result.kind !== "product") throw new Error("Enter a Shopify product URL");
  return result.items[0] ?? null;
 }
}
