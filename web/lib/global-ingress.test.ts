import { describe, expect, test } from "bun:test";
import { simulateGlobalIngress, type GlobalIngressConfig } from "./global-ingress";

const base: GlobalIngressConfig = {
  requestCount: 12,
  routingPolicy: "geography",
  trafficProfile: "balanced",
  healthyRegions: {
    "eu-central": true,
    "us-east": true,
    "ap-southeast": true,
  },
  addedLatencyMs: {
    "eu-central": 0,
    "us-east": 0,
    "ap-southeast": 0,
  },
};

describe("global ingress model", () => {
  test("is deterministic", () => {
    expect(simulateGlobalIngress(base)).toEqual(simulateGlobalIngress(base));
  });

  test("geographic routing keeps healthy clients in their home region", () => {
    const result = simulateGlobalIngress(base);
    expect(result.failedRequests).toBe(0);
    expect(result.requests.every((request) => request.selectedRegion === request.homeRegion)).toBe(true);
  });

  test("an unhealthy home region fails over to the nearest healthy region", () => {
    const result = simulateGlobalIngress({
      ...base,
      trafficProfile: "europe-heavy",
      healthyRegions: { ...base.healthyRegions, "eu-central": false },
    });
    const frankfurt = result.requests.filter((request) => request.clientSite === "frankfurt");

    expect(frankfurt.length).toBeGreaterThan(0);
    expect(frankfurt.every((request) => request.selectedRegion === "us-east")).toBe(true);
    expect(frankfurt.every((request) => request.healthFailover)).toBe(true);
  });

  test("latency steering can move traffic away from a healthy home region", () => {
    const geography = simulateGlobalIngress({
      ...base,
      requestCount: 1,
      trafficProfile: "europe-heavy",
      routingPolicy: "geography",
      addedLatencyMs: { ...base.addedLatencyMs, "eu-central": 100 },
    });
    const latency = simulateGlobalIngress({
      ...base,
      requestCount: 1,
      trafficProfile: "europe-heavy",
      routingPolicy: "latency",
      addedLatencyMs: { ...base.addedLatencyMs, "eu-central": 100 },
    });

    expect(geography.requests[0]?.selectedRegion).toBe("eu-central");
    expect(latency.requests[0]?.selectedRegion).toBe("us-east");
  });

  test("round robin never sends traffic to an unhealthy region", () => {
    const result = simulateGlobalIngress({
      ...base,
      requestCount: 30,
      routingPolicy: "round-robin",
      healthyRegions: { ...base.healthyRegions, "us-east": false },
    });

    expect(result.requests.some((request) => request.selectedRegion === "us-east")).toBe(false);
    expect(result.failedRequests).toBe(0);
  });

  test("losing every region makes the logical hostname unavailable", () => {
    const result = simulateGlobalIngress({
      ...base,
      healthyRegions: {
        "eu-central": false,
        "us-east": false,
        "ap-southeast": false,
      },
    });

    expect(result.successfulRequests).toBe(0);
    expect(result.failedRequests).toBe(base.requestCount);
    expect(result.meanRttMs).toBeNull();
    expect(result.p95RttMs).toBeNull();
  });
});
