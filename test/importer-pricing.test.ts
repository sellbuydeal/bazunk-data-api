import test from "node:test";
import assert from "node:assert/strict";
import {quoteImporterCall, PACKAGES_USD_CENTS} from "../src/importer-pricing.js";
test("75 percent default markup for ten cent supplier call",()=>{
 assert.equal(quoteImporterCall(10000000n),17500000n);
});
test("five cent minimum spread for cheap supplier calls",()=>{
 assert.equal(quoteImporterCall(1000000n),6000000n);
});
test("50 percent minimum markup accepted",()=>{
 assert.equal(quoteImporterCall(10000000n,15000n),15000000n);
});
test("unsafe prices rejected",()=>{
 assert.throws(()=>quoteImporterCall(0n));
 assert.throws(()=>quoteImporterCall(10000000n,14999n));
});
test("top-up denominations",()=>{
 assert.deepEqual(PACKAGES_USD_CENTS,[500,1000,2500,5000]);
});
