import { createHmac } from "node:crypto";
import type { NormalizedProduct, ProductSearchResult } from "../../types/product.js";
import type { SearchOptions } from "../provider.js";

type Obj = Record<string, any>;
const obj = (v: unknown): Obj => v !== null && typeof v === "object" ? v as Obj : {};
const str = (v: unknown): string => v == null ? "" : String(v);
const amount = (v: unknown): number | undefined => {
  const n = Number(str(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const value = (v: unknown): unknown => obj(v).value ?? v;
const productId = (p: Obj) => str(p.product_id ?? p.productId ?? p.item_id ?? p.id);
const isoCurrency = (v: unknown, fallback: string) => /^[A-Z]{3}$/.test(str(v).toUpperCase()) ? str(v).toUpperCase() : fallback;

export function officialConfigured(): boolean {
  return Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET && process.env.ALIEXPRESS_TRACKING_ID);
}

/** AliExpress TOP-style gateway signature. Credentials never enter the browser. */
export async function officialCall(method: string, input: Record<string, string>): Promise<Obj> {
  const key = process.env.ALIEXPRESS_APP_KEY, secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!key || !secret) throw new Error("AliExpress official API credentials are not configured");
  const params: Record<string,string> = {
    app_key: key, method, format: "json", v: "2.0", sign_method: "sha256",
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    ...input
  };
  const signingText = Object.keys(params).sort().map(k => k + params[k]).join("");
  params.sign = createHmac("sha256", secret).update(signingText).digest("hex").toUpperCase();
  const gateway = process.env.ALIEXPRESS_API_GATEWAY || "https://api-sg.aliexpress.com/sync";
  const url = new URL(gateway);
  if (url.protocol !== "https:" || !["api-sg.aliexpress.com","api.aliexpress.com"].includes(url.hostname)) throw new Error("Unapproved AliExpress gateway");
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("AliExpress API HTTP " + response.status);
  const body = obj(await response.json());
  if (body.error_response || body.code && str(body.code) !== "0") {
    const err = obj(body.error_response ?? body);
    throw new Error("AliExpress API rejected request: " + str(err.code ?? "unknown") + " " + str(err.msg ?? err.message ?? "").slice(0, 150));
  }
  return body;
}

function normalise(raw: unknown, currency: string): NormalizedProduct | null {
  const p = obj(raw), id = productId(p);
  const title = str(p.product_title ?? p.title ?? p.subject).trim();
  if (!/^\d{10,20}$/.test(id) || !title) return null;
  const rawImages = p.product_small_image_urls?.string ?? p.product_image_urls?.string ?? p.images ?? [p.product_main_image_url ?? p.product_image_url];
  const img = (Array.isArray(rawImages) ? rawImages : [rawImages]).map(str).filter(x => /^https?:\/\//.test(x) || x.startsWith("//")).map(x => x.startsWith("//") ? "https:" + x : x);
  const rawPrice = value(p.target_sale_price ?? p.target_app_sale_price ?? p.sale_price ?? p.app_sale_price);
  const price = amount(rawPrice);
  const reportedCurrency = isoCurrency(p.target_sale_price_currency ?? p.target_app_sale_price_currency ?? p.sale_price_currency, currency);
  return {
    provider: "aliexpress", externalId: id, sourceUrl: "https://www.aliexpress.com/item/" + id + ".html",
    title: title.slice(0,500), description: str(p.product_description ?? p.description).slice(0,10000),
    category: str(p.first_level_category_name ?? p.second_level_category_name ?? p.category_name),
    price: price === undefined ? undefined : { amount: price, currency: reportedCurrency },
    images: img.slice(0,12).map(url => ({url})), features: [], variants: [], availability: "unknown",
    retrievedAt: new Date().toISOString()
  };
}
function resultNode(body: Obj, method: string): Obj {
  const root = method.replace(/\./g, "_") + "_response";
  const response = obj(body[root] ?? body);
  const resp = obj(response.resp_result ?? response);
  if (resp.resp_code && str(resp.resp_code) !== "200" && str(resp.resp_code) !== "0") throw new Error("AliExpress: " + str(resp.resp_msg ?? resp.resp_code));
  return obj(resp.result ?? response.result ?? resp);
}
export async function officialSearch(options: SearchOptions): Promise<ProductSearchResult> {
  const query = options.query.trim().slice(0,120), page = Math.min(100,Math.max(1,options.page ?? 1));
  if (!query) throw new Error("Search keywords are required");
  const currency = isoCurrency(options.currency, "USD");
  const body = await officialCall("aliexpress.affiliate.product.query", {
    keywords: query, page_no: String(page), page_size: "20", target_currency: currency,
    target_language: "EN", ship_to_country: (options.country ?? "GB").toUpperCase().slice(0,2),
    tracking_id: process.env.ALIEXPRESS_TRACKING_ID ?? ""
  });
  const result = resultNode(body,"aliexpress.affiliate.product.query");
  const list = result.products?.product ?? result.products ?? result.items ?? [];
  const entries = Array.isArray(list) ? list : [];
  const items = entries.map(x => normalise(x,currency)).filter((x): x is NormalizedProduct => x !== null);
  return {provider:"aliexpress",query,page,items,nextPage:entries.length===20?page+1:undefined};
}
export async function officialProduct(id: string): Promise<NormalizedProduct | null> {
  if (!/^\d{10,20}$/.test(id)) throw new Error("Invalid AliExpress product ID");
  const body = await officialCall("aliexpress.affiliate.productdetail.get", {
    product_ids:id, target_currency:"USD", target_language:"EN", ship_to_country:"GB",
    tracking_id: process.env.ALIEXPRESS_TRACKING_ID ?? ""
  });
  const result = resultNode(body,"aliexpress.affiliate.productdetail.get");
  const list = result.products?.product ?? result.products ?? result.product ?? result;
  const entry = Array.isArray(list) ? list.find(x => productId(obj(x)) === id) : list;
  return normalise(entry,"USD");
}
