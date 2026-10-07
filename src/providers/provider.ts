import type { NormalizedProduct, ProductSearchResult, ProviderName } from "../types/product.js";

export interface SearchOptions {
  query: string;
  page?: number;
  country?: string;
  currency?: string;
}

export interface ProductProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  search(options: SearchOptions): Promise<ProductSearchResult>;
  getProduct(externalId: string, options?: { country?: string }): Promise<NormalizedProduct | null>;
  getProductByUrl?(url: string): Promise<NormalizedProduct | null>;
}
