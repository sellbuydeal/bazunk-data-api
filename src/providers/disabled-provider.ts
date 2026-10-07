import type { ProductProvider, SearchOptions } from "./provider.js";
import type { NormalizedProduct, ProductSearchResult, ProviderName } from "../types/product.js";

export class DisabledProvider implements ProductProvider {
  constructor(public readonly name: ProviderName) {}
  isConfigured() { return false; }
  async search(_options: SearchOptions): Promise<ProductSearchResult> {
    throw new Error(`${this.name} provider is not configured`);
  }
  async getProduct(_externalId: string): Promise<NormalizedProduct | null> {
    throw new Error(`${this.name} provider is not configured`);
  }
}
