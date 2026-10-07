import { config } from "../../config.js";
import type { AmazonDataSource } from "./amazon-provider.js";
import type { SearchOptions } from "../provider.js";

export class AmazonHttpSource implements AmazonDataSource {
 isConfigured(){return config.AMAZON_PROVIDER==="http"&&Boolean(config.AMAZON_SOURCE_URL);}
 private async call(path:string,params:Record<string,string>){
  if(!this.isConfigured())throw new Error("Amazon source is not configured");
  const url=new URL(path,config.AMAZON_SOURCE_URL);for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);
  const headers:Record<string,string>={accept:"application/json"};if(config.AMAZON_SOURCE_TOKEN)headers.authorization=`Bearer ${config.AMAZON_SOURCE_TOKEN}`;
  const r=await fetch(url,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`Amazon source HTTP ${r.status}`);return r.json();
 }
 search(o:SearchOptions){return this.call("search",{q:o.query,page:String(o.page??1),country:o.country??"GB",currency:o.currency??"GBP"});}
 getProduct(id:string,country="GB"){return this.call("products/"+encodeURIComponent(id),{country});}
}
