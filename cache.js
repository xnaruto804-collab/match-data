const cache = new Map();
let hits = 0;
let misses = 0;
let staleServed = 0;

export async function cachedUpstream(key, ttlSeconds, loader) {
  const now = Date.now();
  const current = cache.get(key);

  if (current && current.expiresAt > now) {
    hits++;
    return current.value;
  }

  if (current?.inFlight) {
    hits++;
    return current.inFlight;
  }

  misses++;
  const inFlight = (async () => {
    try {
      const value = await loader();
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
        staleUntil: Date.now() + Math.max(ttlSeconds * 10, 3600 * 1000)
      });
      return value;
    } catch (error) {
      // If upstream is down, serve previously cached data for a limited stale window.
      const stale = cache.get(key);
      if (stale?.value && stale.staleUntil > Date.now()) {
        staleServed++;
        return {
          ...stale.value,
          _criczone: {
            stale: true,
            warning: "Showing cached data because the upstream provider failed.",
            cachedAt: new Date(stale.expiresAt - ttlSeconds * 1000).toISOString()
          }
        };
      }
      throw error;
    } finally {
      const latest = cache.get(key);
      if (latest?.inFlight) delete latest.inFlight;
    }
  })();

  cache.set(key, { ...(current || {}), inFlight });
  return inFlight;
}

export function getCacheStats() {
  const now = Date.now();
  let entries = 0;
  for (const [key, value] of cache) {
    if (value.expiresAt <= now && !value.inFlight) cache.delete(key);
    else entries++;
  }
  return { entries, hits, misses, staleServed };
}

export function clearCacheStats() {
  cache.clear();
  hits = 0;
  misses = 0;
  staleServed = 0;
}
