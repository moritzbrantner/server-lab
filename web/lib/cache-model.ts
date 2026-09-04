export type CacheInvalidationMode = "invalidate-on-write" | "ttl-only";

export type CacheSimulationConfig = {
  requestCount: number;
  cacheCapacity: number;
  ttlOperations: number;
  invalidationMode: CacheInvalidationMode;
  writeEvery: number;
  cacheLatencyMs: number;
  originLatencyMs: number;
};

export type CacheOperation = {
  index: number;
  type: "read" | "write";
  key: string;
  originVersion: number;
  cacheVersion: number | null;
  hit: boolean;
  stale: boolean;
  latencyMs: number;
  evictedKey: string | null;
};

export type CacheSimulationResult = {
  operations: CacheOperation[];
  reads: number;
  writes: number;
  hits: number;
  misses: number;
  hitRate: number;
  staleReads: number;
  originFetches: number;
  invalidations: number;
  evictions: number;
  meanReadLatencyMs: number | null;
};

type CacheEntry = {
  version: number;
  insertedAt: number;
  lastUsedAt: number;
};

const keyPattern = ["hot", "hot", "warm", "hot", "cold-a", "hot", "warm", "cold-b"];

export function simulateCache(config: CacheSimulationConfig): CacheSimulationResult {
  validateConfig(config);

  const cache = new Map<string, CacheEntry>();
  const originVersions = new Map<string, number>();
  const operations: CacheOperation[] = [];
  let hits = 0;
  let misses = 0;
  let staleReads = 0;
  let originFetches = 0;
  let invalidations = 0;
  let evictions = 0;
  let readLatencyTotal = 0;
  let reads = 0;
  let writes = 0;

  for (let index = 0; index < config.requestCount; index += 1) {
    const key = keyPattern[index % keyPattern.length];
    const isWrite = config.writeEvery > 0 && (index + 1) % config.writeEvery === 0;
    const currentOriginVersion = originVersions.get(key) ?? 0;

    if (isWrite) {
      const nextVersion = currentOriginVersion + 1;
      originVersions.set(key, nextVersion);
      writes += 1;

      let cacheVersion: number | null = null;
      if (config.invalidationMode === "invalidate-on-write" && cache.delete(key)) {
        invalidations += 1;
      } else {
        cacheVersion = cache.get(key)?.version ?? null;
      }

      operations.push({
        index,
        type: "write",
        key,
        originVersion: nextVersion,
        cacheVersion,
        hit: false,
        stale: false,
        latencyMs: config.originLatencyMs,
        evictedKey: null,
      });
      continue;
    }

    reads += 1;
    const originVersion = originVersions.get(key) ?? 0;
    const entry = cache.get(key);
    const expired =
      entry !== undefined && index - entry.insertedAt >= config.ttlOperations;

    if (entry !== undefined && !expired) {
      entry.lastUsedAt = index;
      hits += 1;
      const stale = entry.version < originVersion;
      staleReads += stale ? 1 : 0;
      readLatencyTotal += config.cacheLatencyMs;
      operations.push({
        index,
        type: "read",
        key,
        originVersion,
        cacheVersion: entry.version,
        hit: true,
        stale,
        latencyMs: config.cacheLatencyMs,
        evictedKey: null,
      });
      continue;
    }

    if (entry !== undefined && expired) {
      cache.delete(key);
    }

    misses += 1;
    originFetches += 1;
    readLatencyTotal += config.originLatencyMs;

    let evictedKey: string | null = null;
    if (config.cacheCapacity > 0) {
      if (!cache.has(key) && cache.size >= config.cacheCapacity) {
        evictedKey = leastRecentlyUsedKey(cache);
        if (evictedKey !== null) {
          cache.delete(evictedKey);
          evictions += 1;
        }
      }
      cache.set(key, {
        version: originVersion,
        insertedAt: index,
        lastUsedAt: index,
      });
    }

    operations.push({
      index,
      type: "read",
      key,
      originVersion,
      cacheVersion: originVersion,
      hit: false,
      stale: false,
      latencyMs: config.originLatencyMs,
      evictedKey,
    });
  }

  return {
    operations,
    reads,
    writes,
    hits,
    misses,
    hitRate: reads === 0 ? 0 : hits / reads,
    staleReads,
    originFetches,
    invalidations,
    evictions,
    meanReadLatencyMs: reads === 0 ? null : readLatencyTotal / reads,
  };
}

function leastRecentlyUsedKey(cache: Map<string, CacheEntry>): string | null {
  let candidate: string | null = null;
  let candidateLastUsed = Number.POSITIVE_INFINITY;

  for (const [key, entry] of cache) {
    if (entry.lastUsedAt < candidateLastUsed) {
      candidate = key;
      candidateLastUsed = entry.lastUsedAt;
    }
  }

  return candidate;
}

function validateConfig(config: CacheSimulationConfig): void {
  if (!Number.isInteger(config.requestCount) || config.requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isInteger(config.cacheCapacity) || config.cacheCapacity < 0) {
    throw new Error("cacheCapacity must be a non-negative integer");
  }
  if (!Number.isInteger(config.ttlOperations) || config.ttlOperations <= 0) {
    throw new Error("ttlOperations must be a positive integer");
  }
  if (!Number.isInteger(config.writeEvery) || config.writeEvery < 0) {
    throw new Error("writeEvery must be a non-negative integer");
  }
  if (config.cacheLatencyMs < 0 || config.originLatencyMs < 0) {
    throw new Error("latencies must be non-negative");
  }
}
