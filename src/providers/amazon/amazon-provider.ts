import type { ProductProvider, SearchOptions } from "../provider.js";
import type { NormalizedProduct, ProductSearchResult } from "../../types/product.js";

export interface AmazonDataSource {
  isConfigured(): boolean;
  search(options: SearchOptions): Promise<unknown>;
  getProduct(externalId: string, country?: string): Promise<unknown | null>;
}

export interface AmazonNormalizer {
  search(payload: unknown, options: SearchOptions): ProductSearchResult;
  product(payload: unknown): NormalizedProduct;
}

/**
 * Provider boundary for Amazon.
 * The acquisition source is injected so Bazunk Data API is not coupled to
 * RapidAPI, scraping, Creators API, feeds, or any other single upstream.
 */
export class AmazonProvider implements ProductProvider {
  readonly name = "amazon" as const;

  constructor(
    private readonly source: AmazonDataSource,
    private readonly normalizer: AmazonNormalizer
  ) {}

  isConfigured() { return this.source.isConfigured(); }

  async search(options: SearchOptions) {
    const payload = await this.source.search(options);
    return this.normalizer.search(payload, options);
  }

  async getProduct(externalId: string, options?: { country?: string }) {
    const payload = await this.source.getProduct(externalId, options?.country);
    return payload == null ? null : this.normalizer.product(payload);
  }
}
