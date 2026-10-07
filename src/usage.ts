import { db } from "./db.js";

export interface UsageEvent { clientId:string; route:string; provider?:string; timestamp:string; cacheHit?:boolean; statusCode?:number; }
type ProviderUsageRow={provider:string;requests:number};
const events:UsageEvent[]=[]; const MAX_MEMORY_EVENTS=10_000;

export function recordUsage(event:UsageEvent){
 events.push(event); if(events.length>MAX_MEMORY_EVENTS)events.splice(0,events.length-MAX_MEMORY_EVENTS);
 if(db&&/^[0-9a-f-]{36}$/i.test(event.clientId)) void db.query(
  "INSERT INTO usage_events(client_id,route,provider,cache_hit,status_code) VALUES($1,$2,$3,$4,$5)",
  [event.clientId,event.route,event.provider??null,event.cacheHit??null,event.statusCode??null]).catch(()=>{});
}
export async function currentMonthRequests(clientId:string){
 if(db&&/^[0-9a-f-]{36}$/i.test(clientId)){
  const r=await db.query<{requests:number}>("SELECT count(*)::int requests FROM usage_events WHERE client_id=$1 AND created_at>=date_trunc('month',now())",[clientId]);
  return r.rows[0]?.requests??0;
 }
 const start=new Date(); start.setUTCDate(1); start.setUTCHours(0,0,0,0);
 return events.filter(e=>e.clientId===clientId&&new Date(e.timestamp)>=start).length;
}
export async function usageSummary(clientId:string){
 if(db&&/^[0-9a-f-]{36}$/i.test(clientId)){
  const r=await db.query("SELECT count(*)::int requests,count(*) FILTER (WHERE created_at>=date_trunc('month',now()))::int month_requests FROM usage_events WHERE client_id=$1",[clientId]);
  const p=await db.query<ProviderUsageRow>("SELECT provider,count(*)::int requests FROM usage_events WHERE client_id=$1 AND provider IS NOT NULL GROUP BY provider",[clientId]);
  return {clientId,...r.rows[0],byProvider:Object.fromEntries(p.rows.map(x=>[x.provider,x.requests]))};
 }
 const mine=events.filter(e=>e.clientId===clientId);
 return {clientId,requests:mine.length,month_requests:await currentMonthRequests(clientId),byProvider:mine.reduce<Record<string,number>>((a,e)=>{if(e.provider)a[e.provider]=(a[e.provider]??0)+1;return a;},{})};
}
