import { describe, expect, test } from "bun:test";
import { simulateCache } from "./cache-model";

const baseConfig = {
  requestCount: 32,
  cacheCapacity: 3,
  ttlOperations: 12,
  writeEvery: 8,
  cacheLatencyMs: 1,
  originLatencyMs: 20,
} as const;

describe("cache model", () => {
  test("is deterministic", () => {
    const config = { ...baseConfig, invalidationMode: "ttl-only" as const };
    expect(simulateCache(config)).toEqual(simulateCache(config));
  });

  test("write invalidation prevents stale cache reads", () => {
    const result = simulateCache({
      ...baseConfig,
      invalidationMode: "invalidate-on-write",
    });

    expect(result.writes).toBeGreaterThan(0);
    expect(result.invalidations).toBeGreaterThan(0);
    expect(result.staleReads).toBe(0);
  });

  test("ttl-only caching can expose stale reads after writes", () => {
    const result = simulateCache({
      ...baseConfig,
      ttlOperations: 64,
      invalidationMode: "ttl-only",
    });

    expect(result.staleReads).toBeGreaterThan(0);
  });

  test("a tiny cache creates deterministic LRU evictions", () => {
    const result = simulateCache({
      ...baseConfig,
      requestCount: 24,
      cacheCapacity: 1,
      writeEvery: 0,
      invalidationMode: "invalidate-on-write",
    });

    expect(result.evictions).toBeGreaterThan(0);
    expect(result.operations.some((operation) => operation.evictedKey !== null)).toBe(true);
  });

  test("cache hits reduce mean read latency", () => {
    const cached = simulateCache({
      ...baseConfig,
      writeEvery: 0,
      invalidationMode: "invalidate-on-write",
    });
    const uncached = simulateCache({
      ...baseConfig,
      cacheCapacity: 0,
      writeEvery: 0,
      invalidationMode: "invalidate-on-write",
    });

    expect(cached.hitRate).toBeGreaterThan(0);
    expect(cached.meanReadLatencyMs ?? Infinity).toBeLessThan(uncached.meanReadLatencyMs ?? 0);
  });
});
