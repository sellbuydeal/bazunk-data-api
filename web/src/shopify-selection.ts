export function shopifyBatchUrls(input: string): string[] {
  const urls = input.split(/[\r\n,]+/).map(x => x.trim()).filter(Boolean);
  if (urls.length > 20) throw new Error("Use up to 20 Shopify URLs per batch.");
  return [...new Set(urls)];
}

export function shopifySelectionKey(product: {sourceUrl: string}): string {
  return product.sourceUrl;
}
