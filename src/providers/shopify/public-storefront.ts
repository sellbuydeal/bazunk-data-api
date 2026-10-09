import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function parseShopifyUrl(input: string) {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const store = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port || isIP(store) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(store) || /\.(local|internal|localhost)$/.test(store)) {
    throw new Error("Enter a public HTTPS Shopify store URL.");
  }
  const path = u.pathname.replace(/\/$/, "");
  const product = path.match(/^(?:\/collections\/[^/]+)?\/products\/([^/]+)$/);
  const collection = path.match(/^\/collections\/([^/]+)$/);
  if (path && !product && !collection) throw new Error("Use a store homepage, collection or product URL.");
  return { store, kind: product ? "product" : collection ? "collection" : "store", handle: decodeURIComponent(product?.[1] ?? collection?.[1] ?? "") };
}

function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return /^2[0-9a-f]{3}:/i.test(address);
}

const fields = `id handle title description vendor productType availableForSale images(first:10){nodes{url altText}} variants(first:20){nodes{id title availableForSale price{amount currencyCode}}}`;
export async function storefrontQuery(store: string, query: string, variables: any) {
  parseShopifyUrl(store);
  const addresses = await lookup(store, { all: true });
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error("Private/local Shopify hosts are not allowed.");
  const r = await fetch(`https://${store}/api/2026-10/graphql.json`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }), redirect: "error", signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Shopify Storefront API HTTP ${r.status}`);
  const j: any = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0]?.message || "Shopify query failed");
  if (!j.data) throw new Error("Shopify returned no catalogue data.");
  return j.data;
}

export function normalizeShopify(n: any, store: string) {
  const variants = n.variants?.nodes ?? [];
  const first = variants.find((v: any) => v.availableForSale) ?? variants[0];
  const amount = Number(first?.price?.amount), currency = String(first?.price?.currencyCode ?? "");
  if (!n.handle || !n.title || !first || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Shopify product has no reliable price or currency.");
  }
  return { provider: "shopify" as const, externalId: String(n.handle), sourceUrl: `https://${store}/products/${encodeURIComponent(n.handle)}`,
    title: String(n.title), description: n.description, brand: n.vendor, category: n.productType,
    price: { amount, currency }, images: (n.images?.nodes ?? []).map((x: any) => ({ url: String(x.url), alt: x.altText || undefined })),
    features: [], variants: variants.map((v: any) => ({ id: String(v.id), name: "Variant", value: String(v.title), available: Boolean(v.availableForSale), price: { amount: Number(v.price.amount), currency: String(v.price.currencyCode) } })),
    availability: (n.availableForSale ? "in_stock" : "out_of_stock") as "in_stock" | "out_of_stock", retrievedAt: new Date().toISOString() };
}

export async function browseShopify(input: string, search?: string) {
  const {store, kind, handle} = parseShopifyUrl(input);
  if (kind === "product") {
    const d = await storefrontQuery(store, `query($handle:String!){product(handle:$handle){${fields}}}`, {handle});
    if (!d.product) throw new Error("Shopify product was not found.");
    return {store, kind, items: [normalizeShopify(d.product, store)]};
  }
  const items: ReturnType<typeof normalizeShopify>[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const connection = `products(first:10,after:$after${search ? ",query:$q" : ""}){nodes{${fields}} pageInfo{hasNextPage endCursor}}`;
    const query = kind === "collection"
      ? `query($handle:String!,$after:String){collection(handle:$handle){${connection}}}`
      : `query($after:String${search ? ",$q:String" : ""}){${connection}}`;
    const d = await storefrontQuery(store, query, {handle, after, q: search});
    if (kind === "collection" && !d.collection) throw new Error("Shopify collection was not found.");
    const c = kind === "collection" ? d.collection.products : d.products;
    if (!Array.isArray(c?.nodes)) throw new Error("Shopify returned an invalid catalogue.");
    items.push(...c.nodes.map((n: any) => normalizeShopify(n, store)));
    if (!c.pageInfo?.hasNextPage) break;
    if (!c.pageInfo.endCursor || c.pageInfo.endCursor === after) throw new Error("Shopify pagination did not advance.");
    after = c.pageInfo.endCursor;
  }
  return {store, kind, items};
}
