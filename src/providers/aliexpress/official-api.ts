import { aliexpressAccessToken } from "../../aliexpress-oauth.js";
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
  return Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET);
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
  if (method.startsWith("aliexpress.ds.")) {
    const token = await aliexpressAccessToken();
    if (!token) throw new Error("AliExpress Dropshipping requests require ALIEXPRESS_ACCESS_TOKEN");
    params.session = token;
  }
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


function resultNode(body: Obj, method: string): Obj {
  const root = method.replace(/\./g, "_") + "_response";
  const response = obj(body[root] ?? body);
  const code = str(response.code ?? body.code);
  if (code && code !== "0" && code !== "00" && code !== "200") throw new Error("AliExpress: " + str(response.msg ?? body.msg ?? code));
  const rsp = str(response.rsp_code ?? body.rsp_code);
  if (rsp && rsp !== "200" && rsp !== "0") throw new Error("AliExpress: " + str(response.rsp_msg ?? rsp));
  return response;
}
function images(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(";") : [];
  return entries.map(str).map(x => x.trim()).map(x=>x.startsWith("//")?"https:"+x:x).filter(x => /^https?:\/\//.test(x)).slice(0,12);
}
function searchProduct(raw: unknown, currency: string): NormalizedProduct | null {
  const p = obj(raw), id = str(p.itemId), title = str(p.title).trim();
  if (!/^\d{10,20}$/.test(id) || !title) return null;
  const hasTargetPrice = amount(p.targetSalePrice) !== undefined;
  const price = amount(hasTargetPrice ? p.targetSalePrice : p.salePrice);
  const priceCurrency = hasTargetPrice ? (p.targetSalePriceCurrency ?? p.targetOriginalPriceCurrency ?? currency) : (p.salePriceCurrency ?? p.currency ?? "CNY");
  return {
    provider:"aliexpress", externalId:id, sourceUrl:"https://www.aliexpress.com/item/"+id+".html",
    title, category:str(p.cateId), images:images([p.itemMainPic]).map(url => ({url})), features:[], variants:[],
    price:price === undefined ? undefined : {amount:price,currency:isoCurrency(priceCurrency,hasTargetPrice?currency:"CNY")},
    availability:"unknown", retrievedAt:new Date().toISOString()
  };
}
function detailProduct(raw: unknown, requestedId: string, currency: string): NormalizedProduct | null {
  const p=obj(raw), base=obj(p.ae_item_base_info_dto), id=str(base.product_id || requestedId);
  if (!/^\d{10,20}$/.test(id) || !str(base.subject).trim()) return null;
  const skus=Array.isArray(p.ae_item_sku_info_dtos) ? p.ae_item_sku_info_dtos.map(obj) : [];
  const variants=skus.flatMap(s => {
    const props=Array.isArray(s.ae_sku_property_dtos) ? s.ae_sku_property_dtos.map(obj) : [];
    return props.map(prop => ({
      id:str(s.sku_id), name:str(prop.sku_property_name), value:str(prop.property_value_definition_name ?? prop.sku_property_value),
      available:Number(s.sku_available_stock)>0,
      ...(amount(s.offer_sale_price ?? s.sku_price) === undefined ? {} : {price:{amount:amount(s.offer_sale_price ?? s.sku_price)!,currency:isoCurrency(s.currency_code,currency)}})
    }));
  });
  const prices=skus.map(s=>amount(s.offer_sale_price ?? s.sku_price)).filter((x):x is number=>x!==undefined);
  const stock=skus.map(s=>Number(s.sku_available_stock)).filter(Number.isFinite);
  const img=images(obj(p.ae_multimedia_info_dto).image_urls);
  for(const sku of skus) for(const prop of Array.isArray(sku.ae_sku_property_dtos)?sku.ae_sku_property_dtos:[]) {
    const url=str(obj(prop).sku_image);if(/^https?:\/\//.test(url)&&!img.includes(url)&&img.length<12)img.push(url);
  }
  return {
    provider:"aliexpress",externalId:id,sourceUrl:"https://www.aliexpress.com/item/"+id+".html",
    title:str(base.subject),description:str(base.detail ?? base.mobile_detail).slice(0,10000),
    category:str(base.category_id),brand:str((Array.isArray(p.ae_item_properties)?p.ae_item_properties:[]).find((x:unknown)=>str(obj(x).attr_name)==="Brand Name")?.attr_value),
    images:img.map(url=>({url})),features:[],variants,
    price:prices.length?{amount:Math.min(...prices),currency:isoCurrency(skus[0]?.currency_code,currency)}:undefined,
    availability:stock.length?(stock.some(x=>x>0)?"in_stock":"out_of_stock"):"unknown",
    rating:amount(base.avg_evaluation_rating),reviewCount:Number(base.evaluation_count)||undefined,
    retrievedAt:new Date().toISOString()
  };
}
export async function officialSearch(options: SearchOptions): Promise<ProductSearchResult> {
  const query=options.query.trim().slice(0,120),page=Math.min(100,Math.max(1,options.page??1));
  if(!query)throw new Error("Search keywords are required");
  const currency=isoCurrency(options.currency,"USD");
  const body=await officialCall("aliexpress.ds.text.search",{
    keyword:query,local:"en_US",countryCode:(options.country??"GB").toUpperCase().slice(0,2),
    currency,page_index:String(page),page_size:"20"
  });
  const response=resultNode(body,"aliexpress.ds.text.search");
  const data=obj(response.data), products=data.products, entries=Array.isArray(products)?products:Array.isArray(obj(products).selection_search_product)?obj(products).selection_search_product:[];
  // AliExpress sometimes returns broad recommendations unrelated to the requested keywords.
  // Do not advertise these as valid keyword matches or silently mix currencies.
  const tokens=query.toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>=2)??[];
  const items=entries.map((x: unknown)=>searchProduct(x,currency))
    .filter((x: NormalizedProduct | null):x is NormalizedProduct=>x!==null)
    .filter(p=>tokens.length>0 && tokens.every(t=>p.title.toLowerCase().includes(t)))
    .filter(p=>!p.price || p.price.currency===currency);
  return {provider:"aliexpress",query,page,items,nextPage:entries.length===20?page+1:undefined};
}
export async function officialProduct(id:string):Promise<NormalizedProduct|null>{
  if(!/^\d{10,20}$/.test(id))throw new Error("Invalid AliExpress product ID");
  const body=await officialCall("aliexpress.ds.product.get",{
    product_id:id,ship_to_country:"GB",target_currency:"USD",target_language:"en",
    remove_personal_benefit:"true"
  });
  const response=resultNode(body,"aliexpress.ds.product.get");
  return detailProduct(response.result??body.result,id,"USD");
}
