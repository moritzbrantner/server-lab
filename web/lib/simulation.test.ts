import { describe, expect, test } from "bun:test";
import { simulate, type ServerNodeConfig, type SimulationConfig } from "./simulation";

function node(overrides: Partial<ServerNodeConfig> = {}): ServerNodeConfig {
  return {
    id: "server-1",
    serviceTimeMs: 40,
    networkLatencyMs: 20,
    maxConcurrentRequests: 1,
    queueCapacity: 8,
    ...overrides,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    requestCount: 12,
    requestsPerSecond: 10,
    policy: "round-robin",
    overloadPolicy: "queue",
    maxQueueWaitMs: 200,
    backpressureLimit: 0,
    seed: 7,
    latencyJitterMs: 5,
    nodes: [
      node({ id: "server-1" }),
      node({ id: "server-2" }),
      node({ id: "server-3" }),
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

    expect(result.nodeMetrics.map((metric) => metric.routedRequests)).toEqual([4, 4, 4]);
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
          node({ id: "server-1" }),
          node({
            id: "server-2",
            failures: [{ startMs: 0, endMs: 1000 }],
          }),
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
          node({
            failures: [{ startMs: 0, endMs: 1000 }],
          }),
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
          node({ id: "slow", serviceTimeMs: 1000, networkLatencyMs: 0 }),
          node({ id: "fast", serviceTimeMs: 1, networkLatencyMs: 0 }),
        ],
      }),
    );

    expect(result.nodeMetrics.find((metric) => metric.nodeId === "fast")?.routedRequests).toBe(4);
    expect(result.nodeMetrics.find((metric) => metric.nodeId === "slow")?.routedRequests).toBe(1);
  });

  test("bounded queues add explicit queueing delay", () => {
    const result = simulate(
      config({
        requestCount: 3,
        requestsPerSecond: 20,
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 100, networkLatencyMs: 0, queueCapacity: 4 })],
      }),
    );

    expect(result.requests.map((request) => request.queueDelayMs)).toEqual([0, 50, 100]);
    expect(result.requests.map((request) => request.latencyMs)).toEqual([100, 150, 200]);
    expect(result.queuedRequests).toBe(2);
    expect(result.p95QueueDelayMs).toBe(100);
    expect(result.nodeMetrics[0].peakQueueDepth).toBe(1);
  });

  test("reject policy refuses work when every worker is busy", () => {
    const result = simulate(
      config({
        requestCount: 3,
        requestsPerSecond: 20,
        overloadPolicy: "reject",
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 100, networkLatencyMs: 0 })],
      }),
    );

    expect(result.successfulRequests).toBe(2);
    expect(result.failedRequests).toBe(1);
    expect(result.requests[1].failureReason).toBe("over-capacity");
  });

  test("queue policy rejects new work once the bounded queue is full", () => {
    const result = simulate(
      config({
        requestCount: 4,
        requestsPerSecond: 40,
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 100, networkLatencyMs: 0, queueCapacity: 1 })],
      }),
    );

    expect(result.successfulRequests).toBe(2);
    expect(result.requests[2].failureReason).toBe("queue-full");
    expect(result.requests[3].failureReason).toBe("queue-full");
  });

  test("load shedding protects a queue-wait budget", () => {
    const result = simulate(
      config({
        requestCount: 3,
        requestsPerSecond: 20,
        overloadPolicy: "shed-load",
        maxQueueWaitMs: 40,
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 100, networkLatencyMs: 0, queueCapacity: 8 })],
      }),
    );

    expect(result.successfulRequests).toBe(2);
    expect(result.shedRequests).toBe(1);
    expect(result.requests[1].failureReason).toBe("shed-load");
  });

  test("burst traffic temporarily compresses arrival intervals", () => {
    const result = simulate(
      config({
        requestCount: 4,
        requestsPerSecond: 10,
        burst: { startRequest: 1, requestCount: 2, multiplier: 2 },
        latencyJitterMs: 0,
        nodes: [node({ networkLatencyMs: 0 })],
      }),
    );

    expect(result.requests.map((request) => request.scheduledArrivalMs)).toEqual([0, 50, 100, 200]);
  });

  test("client backpressure delays offered requests instead of growing the queue", () => {
    const result = simulate(
      config({
        requestCount: 3,
        requestsPerSecond: 100,
        backpressureLimit: 1,
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 100, networkLatencyMs: 0 })],
      }),
    );

    expect(result.requests.map((request) => request.scheduledArrivalMs)).toEqual([0, 10, 20]);
    expect(result.requests.map((request) => request.arrivalMs)).toEqual([0, 100, 200]);
    expect(result.requests.map((request) => request.queueDelayMs)).toEqual([0, 0, 0]);
    expect(result.meanBackpressureDelayMs).toBe(90);
  });

  test("reports measured Little's Law terms from successful requests", () => {
    const result = simulate(
      config({
        requestCount: 20,
        requestsPerSecond: 8,
        latencyJitterMs: 0,
        nodes: [node({ serviceTimeMs: 50, networkLatencyMs: 25, maxConcurrentRequests: 2 })],
      }),
    );

    expect(result.meanLatencyMs).toBe(100);
    expect(result.averageInSystem).toBeCloseTo(result.littleLawEstimate, 10);
    expect(result.nominalServiceCapacityPerSecond).toBe(40);
  });
});
