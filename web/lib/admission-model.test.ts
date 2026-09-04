import { describe, expect, test } from "bun:test";
import { simulateAdmission } from "./admission-model";

const base = {
  requestCount: 120,
  baseRequestsPerSecond: 20,
  burstMultiplier: 6,
  serviceTimeMs: 80,
  backendConcurrency: 2,
  tokenCapacity: 8,
  tokenRefillPerSecond: 20,
} as const;

describe("admission model", () => {
  test("is deterministic", () => {
    const config = { ...base, policy: "token-bucket" as const };
    expect(simulateAdmission(config)).toEqual(simulateAdmission(config));
  });

  test("unbounded admission can exceed backend concurrency", () => {
    const result = simulateAdmission({ ...base, policy: "none" });
    expect(result.overCapacityAdmissions).toBeGreaterThan(0);
    expect(result.peakInFlight).toBeGreaterThan(base.backendConcurrency);
  });

  test("concurrency admission never exceeds the configured backend envelope", () => {
    const result = simulateAdmission({ ...base, policy: "concurrency-limit" });
    expect(result.rejected).toBeGreaterThan(0);
    expect(result.overCapacityAdmissions).toBe(0);
    expect(result.peakInFlight).toBeLessThanOrEqual(base.backendConcurrency);
  });

  test("token bucket absorbs some burst then rate limits", () => {
    const result = simulateAdmission({ ...base, policy: "token-bucket" });
    expect(result.admitted).toBeGreaterThan(0);
    expect(result.rejected).toBeGreaterThan(0);
    expect(result.requests.some((request) => request.reason === "rate-limited")).toBe(true);
  });

  test("a generous token bucket does not reject steady traffic", () => {
    const result = simulateAdmission({
      ...base,
      burstMultiplier: 1,
      tokenCapacity: 50,
      tokenRefillPerSecond: 50,
      policy: "token-bucket",
    });
    expect(result.rejected).toBe(0);
  });
});
