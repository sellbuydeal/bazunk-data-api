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
  const p=await db.query<ProviderUsageRow>("SELECT provider,count(*)::int requests FROM usage_events WHERE client_id=$1 AND provider IS NOT NULL AND created_at>=date_trunc('month',now()) GROUP BY provider ORDER BY requests DESC",[clientId]);
  const d=await db.query<{day:string;requests:number}>("SELECT to_char(d.day,'YYYY-MM-DD') AS day,coalesce(count(e.id),0)::int AS requests FROM generate_series(date_trunc('month',now()),date_trunc('day',now()),interval '1 day') AS d(day) LEFT JOIN usage_events e ON e.client_id=$1 AND e.created_at>=d.day AND e.created_at<d.day+interval '1 day' GROUP BY d.day ORDER BY d.day",[clientId]);
  return {clientId,...r.rows[0],byProvider:Object.fromEntries(p.rows.map(x=>[x.provider,x.requests])),daily:d.rows};
 }
 const mine=events.filter(e=>e.clientId===clientId);
 const monthStart=new Date();monthStart.setUTCDate(1);monthStart.setUTCHours(0,0,0,0);const monthly=mine.filter(e=>new Date(e.timestamp)>=monthStart);const daily:Record<string,number>={};for(const e of monthly){const day=new Date(e.timestamp).toISOString().slice(0,10);daily[day]=(daily[day]??0)+1;}return {clientId,requests:mine.length,month_requests:monthly.length,byProvider:monthly.reduce<Record<string,number>>((a,e)=>{if(e.provider)a[e.provider]=(a[e.provider]??0)+1;return a;},{}),daily:Object.entries(daily).map(([day,requests])=>({day,requests}))};
}

export async function adminUsageSummary(){
 if(!db)return{monthRequests:0,totalRequests:0,activeClients:0,byProvider:{},daily:[],topClients:[]};
 const [totals,providers,daily,clients]=await Promise.all([
  db.query("SELECT count(*)::int total_requests,count(*) FILTER (WHERE created_at>=date_trunc('month',now()))::int month_requests,count(DISTINCT client_id) FILTER (WHERE created_at>=date_trunc('month',now()))::int active_clients FROM usage_events"),
  db.query("SELECT coalesce(provider,'other') provider,count(*)::int requests FROM usage_events WHERE created_at>=date_trunc('month',now()) GROUP BY provider ORDER BY requests DESC"),
  db.query("SELECT to_char(d.day,'YYYY-MM-DD') day,coalesce(count(e.id),0)::int requests FROM generate_series(date_trunc('month',now()),date_trunc('day',now()),interval '1 day') d(day) LEFT JOIN usage_events e ON e.created_at>=d.day AND e.created_at<d.day+interval '1 day' GROUP BY d.day ORDER BY d.day"),
  db.query("SELECT c.id,c.name,c.plan,count(e.id)::int requests FROM api_clients c LEFT JOIN usage_events e ON e.client_id=c.id AND e.created_at>=date_trunc('month',now()) WHERE c.plan<>'internal' GROUP BY c.id,c.name,c.plan ORDER BY requests DESC LIMIT 20")
 ]);
 return{monthRequests:totals.rows[0]?.month_requests??0,totalRequests:totals.rows[0]?.total_requests??0,activeClients:totals.rows[0]?.active_clients??0,byProvider:Object.fromEntries(providers.rows.map((x:any)=>[x.provider,x.requests])),daily:daily.rows,topClients:clients.rows};
}
