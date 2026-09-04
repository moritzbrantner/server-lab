import { describe, expect, test } from "bun:test";
import { simulate, type SimulationConfig } from "./simulation";

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    requestCount: 12,
    requestsPerSecond: 10,
    policy: "round-robin",
    seed: 7,
    latencyJitterMs: 5,
    nodes: [
      { id: "server-1", serviceTimeMs: 40, networkLatencyMs: 20 },
      { id: "server-2", serviceTimeMs: 40, networkLatencyMs: 20 },
      { id: "server-3", serviceTimeMs: 40, networkLatencyMs: 20 },
    ],
    ...overrides,
  };
}

describe("simulate", () => {
  test("is deterministic for a fixed seed and configuration", () => {
    const first = simulate(config({ policy: "random" }));
    const second = simulate(config({ policy: "random" }));

    expect(second).toEqual(first);
  });

  test("round robin distributes requests evenly", () => {
    const result = simulate(config({ latencyJitterMs: 0 }));

    expect(result.nodeMetrics.map((node) => node.routedRequests)).toEqual([4, 4, 4]);
    expect(result.availability).toBe(1);
    expect(result.p50LatencyMs).toBe(80);
    expect(result.p95LatencyMs).toBe(80);
  });

  test("round robin skips a node while it is failed", () => {
    const result = simulate(
      config({
        requestCount: 6,
        requestsPerSecond: 10,
        latencyJitterMs: 0,
        nodes: [
          { id: "server-1", serviceTimeMs: 40, networkLatencyMs: 20 },
          {
            id: "server-2",
            serviceTimeMs: 40,
            networkLatencyMs: 20,
            failures: [{ startMs: 0, endMs: 1000 }],
          },
        ],
      }),
    );

    expect(result.requests.every((request) => request.nodeId === "server-1")).toBe(true);
    expect(result.availability).toBe(1);
  });

  test("fails requests when every replica is unavailable", () => {
    const result = simulate(
      config({
        requestCount: 4,
        nodes: [
          {
            id: "server-1",
            serviceTimeMs: 40,
            networkLatencyMs: 20,
            failures: [{ startMs: 0, endMs: 1000 }],
          },
        ],
      }),
    );

    expect(result.successfulRequests).toBe(0);
    expect(result.failedRequests).toBe(4);
    expect(result.availability).toBe(0);
    expect(result.p50LatencyMs).toBeNull();
  });

  test("least connections routes around a long-running request", () => {
    const result = simulate(
      config({
        requestCount: 5,
        requestsPerSecond: 10,
        policy: "least-connections",
        latencyJitterMs: 0,
        nodes: [
          { id: "slow", serviceTimeMs: 1000, networkLatencyMs: 0 },
          { id: "fast", serviceTimeMs: 1, networkLatencyMs: 0 },
        ],
      }),
    );

    expect(result.nodeMetrics.find((node) => node.nodeId === "fast")?.routedRequests).toBe(4);
    expect(result.nodeMetrics.find((node) => node.nodeId === "slow")?.routedRequests).toBe(1);
  });
});
