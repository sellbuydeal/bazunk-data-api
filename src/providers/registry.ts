import { DisabledProvider } from "./disabled-provider.js";
import type { ProductProvider } from "./provider.js";
import type { ProviderName } from "../types/product.js";

const providers = new Map<ProviderName, ProductProvider>();

for (const name of ["amazon", "ebay", "walmart", "aliexpress"] as const) {
  providers.set(name, new DisabledProvider(name));
}

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
