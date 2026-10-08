export const providerNames = ["amazon", "ebay", "walmart", "aliexpress", "shopify"] as const;
export type ProviderName = (typeof providerNames)[number];

export interface Money {
  amount: number;
  currency: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
}

export interface ProductVariant {
  id?: string;
  name: string;
  value: string;
  available?: boolean;
  price?: Money;
}

export interface NormalizedProduct {
  provider: ProviderName;
  externalId: string;
  sourceUrl: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  price?: Money;
  images: ProductImage[];
  features: string[];
  variants: ProductVariant[];
  availability?: "in_stock" | "out_of_stock" | "unknown";
  rating?: number;
  reviewCount?: number;
  retrievedAt: string;
  raw?: unknown;
}

export interface ProductSearchResult {
  provider: ProviderName;
  query: string;
  page: number;
  items: NormalizedProduct[];
  nextPage?: number;
}
