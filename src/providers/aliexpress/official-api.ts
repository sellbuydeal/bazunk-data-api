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
/** Read-only API compatibility probe. Never replaces production search or exposes credentials. */
export async function officialSearchParameterProbe(query: string) {
 const q=query.trim().slice(0,120);if(!q)throw new Error("Keyword required");
 const base={keyword:q,local:"en_US",countryCode:"GB",currency:"GBP",page_index:"1",page_size:"20"};
 const variants:{name:string;method:string;params:Record<string,string>}[]=[
  {name:"DS baseline",method:"aliexpress.ds.text.search",params:base},
  {name:"DS explicit sorting",method:"aliexpress.ds.text.search",params:{...base,sort:"salesDesc"}},
  {name:"DS US locale",method:"aliexpress.ds.text.search",params:{...base,countryCode:"US",currency:"USD"}},
  {name:"DS nonsense control",method:"aliexpress.ds.text.search",params:{...base,keyword:"zzzxqvnotarealproduct999"}},
  {name:"Affiliate keyword search",method:"aliexpress.affiliate.product.query",params:{keywords:q,target_currency:"GBP",target_language:"EN",ship_to_country:"GB",page_no:"1",page_size:"20"}}
 ];
 const output=[] as {name:string;status:string;count:number;matches:number;totalCount:number|null;recommendations:number;types:Record<string,number>;sampleTitles:string[];sampleIds:string[];error?:string}[];
 for(const variant of variants){
  try{
   const body=await officialCall(variant.method,variant.params);
   const response=resultNode(body,variant.method),data=obj(response.data),result=obj(response.result??obj(response.resp_result).result);
   const products=data.products??result.products??response.products;
   const candidates=[products,obj(products).selection_search_product,obj(products).product,obj(products).products,obj(products).item,obj(result).products,obj(obj(result).products).product];
   const entries:unknown[]=candidates.find(Array.isArray)??[];
   const titles=entries.map(e=>str(obj(e).title??obj(e).product_title??obj(e).subject)).filter(Boolean);
   const tokens=q.toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>=2)??[];
   const types:Record<string,number>={};for(const e of entries){const type=str(obj(e).type||"unspecified").slice(0,40);types[type]=(types[type]??0)+1;}
   const rawTotal=data.totalCount??result.total_count??result.total_record_count;
   const total=rawTotal==null?null:Number(rawTotal);
   output.push({name:variant.name,status:"ok",count:entries.length,matches:titles.filter(t=>tokens.every(token=>t.toLowerCase().includes(token))).length,totalCount:total!==null&&Number.isFinite(total)?total:null,recommendations:types.recommend??0,types,sampleTitles:titles.slice(0,3).map(t=>t.slice(0,110)),sampleIds:entries.slice(0,5).map(e=>str(obj(e).itemId??obj(e).product_id??obj(e).productId)).filter(Boolean)});
  }catch(e:any){output.push({name:variant.name,status:"error",count:0,matches:0,totalCount:null,recommendations:0,types:{},sampleTitles:[],sampleIds:[],error:String(e?.message??e).slice(0,160)});}
 }
 return {query:q,variants:output,productionSearchUnchanged:true,interpretation:"Check product types and nonsense control. A returned list with totalCount=0 or type=recommend is not proof of keyword matches. Affiliate search requires separate permission."};
}
export async function officialRepeatSearchDiagnostic(query: string) {
  const term=query.trim().slice(0,120);
  if(!term)throw new Error("Search keyword required");
  const runs=[] as {attempt:number;count:number;matches:number;sampleIds:string[];responseKeys:string[];dataKeys:string[];metadata:Record<string,string|number|boolean>}[];
  const allIds:string[][]=[];
  for(let attempt=1;attempt<=3;attempt++){
    const body=await officialCall("aliexpress.ds.text.search",{keyword:term,local:"en_US",countryCode:"GB",currency:"GBP",page_index:"1",page_size:"20"});
    const response=resultNode(body,"aliexpress.ds.text.search"),data=obj(response.data),products=data.products;
    const entries:unknown[]=Array.isArray(products)?products:Array.isArray(obj(products).selection_search_product)?obj(products).selection_search_product:[];
    const parsed=entries.map(e=>searchProduct(e,"GBP")).filter((p):p is NormalizedProduct=>p!==null);
    const tokens=term.toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>=2)??[];
    const ids=parsed.map(p=>p.externalId);allIds.push(ids);
    const metadata:Record<string,string|number|boolean>={};
    for(const [prefix,node] of [["response",response],["data",data]] as const){
      for(const [key,v] of Object.entries(node)){
        if(/token|secret|session|sign|auth|key|url|image|product|item/i.test(key))continue;
        if(typeof v==="string"||typeof v==="number"||typeof v==="boolean")metadata[prefix+"."+key]=typeof v==="string"?v.slice(0,100):v;
      }
    }
    runs.push({attempt,count:parsed.length,matches:parsed.filter(p=>tokens.every(t=>p.title.toLowerCase().includes(t))).length,sampleIds:ids.slice(0,5),responseKeys:Object.keys(response).slice(0,15),dataKeys:Object.keys(data).slice(0,15),metadata});
  }
  const overlaps=[] as {first:number;second:number;shared:number;percentage:number}[];
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){
    const shared=allIds[i].filter(id=>allIds[j].includes(id)).length;
    overlaps.push({first:i+1,second:j+1,shared,percentage:Math.round(shared*100/Math.max(1,Math.min(allIds[i].length,allIds[j].length)))});
  }
  return {query:term,runs,overlaps};
}
export async function officialCompareSearches(queries: string[]) {
  const terms=queries.map(q=>q.trim().slice(0,120)).filter(Boolean).slice(0,3);
  if(terms.length<2)throw new Error("At least two search queries are required");
  const results=[] as {query:string;count:number;ids:string[];matches:number;currencies:string[]}[];
  for(const query of terms){
    const body=await officialCall("aliexpress.ds.text.search",{
      keyword:query,local:"en_US",countryCode:"GB",currency:"GBP",page_index:"1",page_size:"20"
    });
    const response=resultNode(body,"aliexpress.ds.text.search");
    const data=obj(response.data),products=data.products;
    const entries:unknown[]=Array.isArray(products)?products:Array.isArray(obj(products).selection_search_product)?obj(products).selection_search_product:[];
    const parsed=entries.map(e=>searchProduct(e,"GBP")).filter((p):p is NormalizedProduct=>p!==null);
    const tokens=query.toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>=2)??[];
    results.push({query,count:parsed.length,ids:parsed.map(p=>p.externalId),matches:parsed.filter(p=>tokens.every(t=>p.title.toLowerCase().includes(t))).length,currencies:[...new Set(parsed.map(p=>p.price?.currency??"unknown"))]});
  }
  const comparisons=[] as {first:string;second:string;sharedIds:number;sharedPercent:number}[];
  for(let i=0;i<results.length;i++)for(let j=i+1;j<results.length;j++){
    const a=results[i],b=results[j],shared=a.ids.filter(id=>b.ids.includes(id)).length;
    comparisons.push({first:a.query,second:b.query,sharedIds:shared,sharedPercent:Math.round(100*shared/Math.max(1,Math.min(a.ids.length,b.ids.length)))});
  }
  return {results:results.map(({ids,...rest})=>({...rest,sampleIds:ids.slice(0,5)})),comparisons,note:"Shared IDs and keyword match rates help diagnose whether AliExpress is honouring search terms."};
}
export async function officialSearchDiagnostics(options: SearchOptions) {
  const query=options.query.trim().slice(0,120);
  if(!query)throw new Error("Search keywords are required");
  const currency=isoCurrency(options.currency,"GBP");
  const body=await officialCall("aliexpress.ds.text.search",{
    keyword:query,local:"en_US",countryCode:(options.country??"GB").toUpperCase().slice(0,2),
    currency,page_index:"1",page_size:"20"
  });
  const response=resultNode(body,"aliexpress.ds.text.search");
  const data=obj(response.data),products=data.products;
  const entries:unknown[]=Array.isArray(products)?products:Array.isArray(obj(products).selection_search_product)?obj(products).selection_search_product:[];
  const tokens=query.toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>=2)??[];
  const normalized=entries.map(e=>searchProduct(e,currency)).filter((p):p is NormalizedProduct=>p!==null);
  const matching=normalized.filter(p=>tokens.every(t=>p.title.toLowerCase().includes(t)));
  const accepted=matching.filter(p=>!p.price||p.price.currency===currency);
  return {
    query,requestedCurrency:currency,returned:entries.length,parsed:normalized.length,
    keywordMatches:matching.length,currencyMatches:accepted.length,
    currencies:[...new Set(normalized.map(p=>p.price?.currency??"unknown"))],
    // Titles and currency only; never expose raw API payload, session tokens or credentials.
    samples:normalized.slice(0,5).map(p=>({title:p.title.slice(0,160),currency:p.price?.currency??"unknown",keywordMatch:tokens.every(t=>p.title.toLowerCase().includes(t))})),
    responseKeys:Object.keys(response).slice(0,12),dataKeys:Object.keys(data).slice(0,12)
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
    .filter((p: NormalizedProduct)=>tokens.length>0 && tokens.every(t=>p.title.toLowerCase().includes(t)))
    .filter((p: NormalizedProduct)=>!p.price || p.price.currency===currency);
  const reportedTotal=Number(data.totalCount);
  // A full page of recommendation fallback is not evidence that another search page exists.
  const nextPage=Number.isFinite(reportedTotal)&&reportedTotal>page*20&&entries.length===20?page+1:undefined;
  return {provider:"aliexpress",query,page,items,nextPage};
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
