import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const ts=createRequire(import.meta.url)('typescript');

test('Shopify URL forms, currency, availability, pagination and source errors',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'shopify-provider-'));
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/providers/shopify');
 const savedFetch=globalThis.fetch;
 try{
  for(const file of ['public-storefront','shopify-provider']){
   let source=await readFile(path.join(root,file+'.ts'),'utf8');
   if(file==='public-storefront')source=source.replace('import { lookup } from "node:dns/promises";', 'const lookup=async()=>[{address:"93.184.216.34",family:4}];');
   await writeFile(path.join(dir,file+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  }
  const selectionSource=await readFile(path.join(root,'../../../web/src/shopify-selection.ts'),'utf8');
  await writeFile(path.join(dir,'selection.js'),ts.transpileModule(selectionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  const {shopifyBatchUrls,shopifySelectionKey}=await import(pathToFileURL(path.join(dir,'selection.js')));
  assert.deepEqual(shopifyBatchUrls('https://another-store.com\nhttps://second-store.com/collections/new'),['https://another-store.com','https://second-store.com/collections/new']);
  assert.notEqual(shopifySelectionKey({sourceUrl:'https://one.example.com/products/shirt'}),shopifySelectionKey({sourceUrl:'https://two.example.com/products/shirt'}));
  assert.throws(()=>shopifyBatchUrls(Array(21).fill('https://shop.example.com').join('\n')),/20/);
  const {parseShopifyUrl,normalizeShopify,browseShopify}=await import(pathToFileURL(path.join(dir,'public-storefront.js')));
  const {ShopifyProvider}=await import(pathToFileURL(path.join(dir,'shopify-provider.js')));
  assert.equal(parseShopifyUrl('SHOP.EXAMPLE.COM/').kind,'store');
  assert.equal(parseShopifyUrl('https://shop.example.com/collections/sale').kind,'collection');
  assert.equal(parseShopifyUrl('https://shop.example.com/collections/sale/products/red-shirt?variant=123').kind,'product');
  for(const input of ['http://shop.example.com','https://127.0.0.1','https://10.0.0.1','https://private.local','https://user:pass@shop.example.com','https://shop.example.com:4430','https://shop.example.com/pages/about'])assert.throws(()=>parseShopifyUrl(input));
  const product={handle:'red-shirt',title:'Red shirt',availableForSale:true,images:{nodes:[]},variants:{nodes:[
   {id:'1',title:'Sold out',availableForSale:false,price:{amount:'5',currencyCode:'EUR'}},
   {id:'2',title:'Available',availableForSale:true,price:{amount:'12.50',currencyCode:'EUR'}}]}};
  const normalized=normalizeShopify(product,'shop.example.com');
  assert.equal(normalized.price.amount,12.5);assert.equal(normalized.price.currency,'EUR');assert.equal(normalized.availability,'in_stock');
  assert.throws(()=>normalizeShopify({...product,variants:{nodes:[]}},'shop.example.com'));
  let calls=0;
  globalThis.fetch=async(url,options)=>{
   calls++;const {query,variables}=JSON.parse(options.body);
   assert.equal(options.redirect,'error');assert.ok(options.signal);assert.ok(query.includes('first:10')||query.includes('product(handle:'));
   if(query.includes('product(handle:')){assert.equal(variables.handle,'red-shirt');return {ok:true,json:async()=>({data:{product}})};}
   const c={nodes:[{...product,handle:calls===1?'red-shirt':'blue-shirt'}],pageInfo:{hasNextPage:calls===1,endCursor:'next'}};
   if(calls===2)assert.equal(variables.after,'next');
   return {ok:true,json:async()=>({data:query.includes('collection(handle:')?{collection:{products:c}}:{products:c}})};
  };
  const preview=await new ShopifyProvider().browseUrl('shop.example.com/collections/sale');
  assert.equal(preview.kind,'collection');assert.equal(preview.items.length,2);assert.equal(calls,2);
  assert.equal((await new ShopifyProvider().getProductByUrl('https://shop.example.com/collections/sale/products/red-shirt')).price.amount,12.5);
  globalThis.fetch=async()=>({ok:true,json:async()=>({data:{product:null}})});
  await assert.rejects(()=>browseShopify('shop.example.com/products/missing'),/not found/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({errors:[{message:'Query rejected'}]})});
  await assert.rejects(()=>browseShopify('shop.example.com'),/Query rejected/);
  globalThis.fetch=async()=>({ok:false,status:429});
  await assert.rejects(()=>browseShopify('shop.example.com'),/429/);
 }finally{globalThis.fetch=savedFetch;await rm(dir,{recursive:true,force:true});}
});
