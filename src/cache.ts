interface CacheEntry<T> { value: T; expiresAt: number; }

export class MemoryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  constructor(private readonly defaultTtlMs = 5 * 60_000) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs) {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}

export const productCache = new MemoryCache();
