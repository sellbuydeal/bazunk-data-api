import { db } from "../../db.js";
import type { ProductProvider, SearchOptions } from "../provider.js";
import type { NormalizedProduct, ProductSearchResult } from "../../types/product.js";

type Obj = Record<string, any>;
const object = (value: unknown): Obj => value && typeof value === "object" ? value as Obj : {};
const text = (value: unknown): string => typeof value === "string" ? value : value == null ? "" : String(value);
const number = (value: unknown): number | undefined => {
  const parsed = Number.parseFloat(text(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};
const images = (item: Obj): string[] => {
  const candidates = item.images ?? item.imageModule?.imagePathList ?? item.multi_image?.image_list ?? [item.imageUrl ?? item.image ?? item.imagePath];
  return (Array.isArray(candidates) ? candidates : [candidates]).filter((x): x is string => typeof x === "string" && x.length > 0).map(x => x.startsWith("//") ? "https:" + x : x);
};
const idFrom = (item: Obj): string => {
  const direct = text(item.itemId ?? item.productId ?? item.product_id ?? item.id);
  if (/^\d{10,}$/.test(direct)) return direct;
  return text(item.itemUrl ?? item.productUrl ?? item.url).match(/\/item\/(\d{10,})/)?.[1] ?? "";
};
function normalize(entry: unknown): NormalizedProduct | null {
  const item = object(object(entry).item ?? entry);
  const id = idFrom(item);
  if (!id) return null;
  const priceRaw = item.promotionPrice ?? item.salePrice ?? item.price ?? item.sku_info?.price ?? item.prices?.salePrice;
  const price = number(typeof priceRaw === "object" ? priceRaw?.formattedPrice ?? priceRaw?.value ?? priceRaw?.minAmount : priceRaw);
  return {
    provider: "aliexpress", externalId: id, sourceUrl: "https://www.aliexpress.com/item/" + id + ".html",
    title: text(item.title ?? item.subject ?? "AliExpress product").slice(0, 500),
    description: text(item.descriptionModule?.description ?? item.description).slice(0, 10000),
    category: text(item.category ?? item.categoryName),
    price: price === undefined ? undefined : { amount: price, currency: "USD" },
    images: images(item).slice(0, 12).map(url => ({ url })),
    features: [], variants: [], availability: "unknown",
    rating: number(item.averageStarRate ?? item.rating ?? item.feedbackModule?.averageStar),
    reviewCount: number(item.reviewCount ?? item.feedbackModule?.evaCount),
    retrievedAt: new Date().toISOString(),
  };
}

/** Disabled for third-party resale until upstream redistribution rights are confirmed. */
export class AliExpressProvider implements ProductProvider {
  readonly name = "aliexpress" as const;
  isConfigured(): boolean {
    return process.env.ALIEXPRESS_PROVIDER_ENABLED === "true" &&
      process.env.ALIEXPRESS_RESALE_LICENSE_CONFIRMED === "true" &&
      Boolean(process.env.ALIEXPRESS_SCRAPER_URL && process.env.ALIEXPRESS_SCRAPER_TOKEN);
  }
  private async scrape(path: string): Promise<Obj> {
    const base = process.env.ALIEXPRESS_SCRAPER_URL;
    const token = process.env.ALIEXPRESS_SCRAPER_TOKEN;
    if (!base || !token) throw new Error("Scraper source is not configured");
    const target = new URL(path, base.endsWith("/") ? base : base + "/");
    if (target.origin !== new URL(base).origin) throw new Error("Invalid scraper endpoint");
    const response = await fetch(target, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("AliExpress scraper HTTP " + response.status);
    return object(await response.json());
  }
  async search(options: SearchOptions): Promise<ProductSearchResult> {
    const query = options.query.trim().slice(0, 120);
    if (!query) throw new Error("Search query is required");
    const page = Math.min(100, Math.max(1, options.page ?? 1));
    if (process.env.ALIEXPRESS_SCRAPER_URL && process.env.ALIEXPRESS_SCRAPER_TOKEN) {
      const result = await this.scrape("v1/aliexpress/search?q=" + encodeURIComponent(query) + "&page=" + page);
      return { provider: this.name, query, page, items: Array.isArray(result.items) ? result.items as NormalizedProduct[] : [], nextPage: result.nextPage };
    }
    throw new Error("Bazunk AliExpress Scraper Engine is not configured.");
  }
  async getProduct(externalId: string): Promise<NormalizedProduct | null> {
    if (!/^\d{10,}$/.test(externalId)) throw new Error("Invalid AliExpress product ID");
    if (process.env.ALIEXPRESS_SCRAPER_URL && process.env.ALIEXPRESS_SCRAPER_TOKEN) {
      const item = await this.scrape("v1/aliexpress/products/" + externalId);
      return item.externalId ? item as NormalizedProduct : null;
    }
    throw new Error("Bazunk AliExpress Scraper Engine is not configured.");
  }
  async getProductByUrl(url: string): Promise<NormalizedProduct | null> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "aliexpress.com" || parsed.hostname.endsWith(".aliexpress.com"))) throw new Error("Invalid AliExpress URL");
    const id = parsed.pathname.match(/\/item\/(\d{10,})/)?.[1];
    if (!id) throw new Error("AliExpress product ID missing");
    return this.getProduct(id);
  }
}
