import { config } from "../config.js";
import { AmazonProvider } from "./amazon/amazon-provider.js";
import { AmazonHttpSource } from "./amazon/http-source.js";
import { amazonNormalizer } from "./amazon/amazon-normalizer.js";
import { DisabledProvider } from "./disabled-provider.js";
import type { ProductProvider } from "./provider.js";
import type { ProviderName } from "../types/product.js";

const providers = new Map<ProviderName, ProductProvider>();

for (const name of ["amazon", "ebay", "walmart", "aliexpress"] as const) providers.set(name, new DisabledProvider(name));
if(config.AMAZON_PROVIDER==="http") providers.set("amazon",new AmazonProvider(new AmazonHttpSource(),amazonNormalizer));

export function registerProvider(provider: ProductProvider) {
  providers.set(provider.name, provider);
}

export function getProvider(name: ProviderName): ProductProvider {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

export function providerStatus() {
  return [...providers.values()].map((provider) => ({
    provider: provider.name,
    configured: provider.isConfigured()
  }));
}
