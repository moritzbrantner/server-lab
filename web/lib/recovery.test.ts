import { describe, expect, test } from "bun:test";
import {
  failureDomainAvailability,
  parallelAvailability,
  simulateElection,
  simulateRecovery,
  type RecoverySimulationConfig,
} from "./recovery";

function recoveryConfig(overrides: Partial<RecoverySimulationConfig> = {}): RecoverySimulationConfig {
  return {
    requestCount: 30,
    requestsPerSecond: 10,
    seed: 11,
    healthCheckMode: "active",
    healthCheckIntervalMs: 100,
    healthFailureThreshold: 2,
    failoverDelayMs: 200,
    attemptTimeoutMs: 50,
    retry: {
      maxRetries: 2,
      baseBackoffMs: 50,
      jitterMs: 0,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      openMs: 300,
    },
    nodes: [
      {
        id: "server-1",
        failureDomain: "zone-a",
        serviceTimeMs: 20,
        networkLatencyMs: 10,
        failures: [{ startMs: 500, endMs: 2000 }],
      },
      {
        id: "server-2",
        failureDomain: "zone-a",
        serviceTimeMs: 20,
        networkLatencyMs: 10,
      },
      {
        id: "server-3",
        failureDomain: "zone-b",
        serviceTimeMs: 20,
        networkLatencyMs: 10,
      },
    ],
    ...overrides,
  };
}

describe("simulateRecovery", () => {
  test("is deterministic for a fixed seed", () => {
    const first = simulateRecovery(
      recoveryConfig({
        retry: { maxRetries: 3, baseBackoffMs: 40, jitterMs: 25 },
      }),
    );
    const second = simulateRecovery(
      recoveryConfig({
        retry: { maxRetries: 3, baseBackoffMs: 40, jitterMs: 25 },
      }),
    );

    expect(second).toEqual(first);
  });

  test("separates active failure detection from failover delay", () => {
    const result = simulateRecovery(recoveryConfig());

    expect(result.firstFailureDetectionMs).toBe(600);
    expect(result.firstFailoverCompleteMs).toBe(800);
    expect(result.recoveryWindowMs).toBe(300);
    expect(result.failoverCount).toBeGreaterThanOrEqual(1);
    expect(result.events.some((event) => event.type === "failover-started")).toBe(true);
    expect(result.events.some((event) => event.type === "failover-completed" && event.nodeId === "server-2")).toBe(true);
  });

  test("passive health detection depends on observed failed requests", () => {
    const result = simulateRecovery(
      recoveryConfig({
        requestCount: 5,
        healthCheckMode: "passive",
        healthFailureThreshold: 2,
        failoverDelayMs: 0,
        retry: { maxRetries: 0, baseBackoffMs: 0, jitterMs: 0 },
        circuitBreaker: { enabled: false, failureThreshold: 2, openMs: 100 },
        attemptTimeoutMs: 20,
        nodes: [
          {
            id: "server-1",
            failureDomain: "zone-a",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
            failures: [{ startMs: 0, endMs: 2000 }],
          },
          {
            id: "server-2",
            failureDomain: "zone-b",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
          },
        ],
      }),
    );

    expect(result.firstFailureDetectionMs).toBe(120);
    expect(result.firstFailoverCompleteMs).toBe(120);
  });

  test("uses bounded exponential retry backoff", () => {
    const result = simulateRecovery(
      recoveryConfig({
        requestCount: 1,
        healthCheckMode: "passive",
        healthFailureThreshold: 99,
        attemptTimeoutMs: 100,
        retry: { maxRetries: 2, baseBackoffMs: 50, jitterMs: 0 },
        circuitBreaker: { enabled: false, failureThreshold: 2, openMs: 100 },
        nodes: [
          {
            id: "server-1",
            failureDomain: "zone-a",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
            failures: [{ startMs: 0, endMs: 5000 }],
          },
          {
            id: "server-2",
            failureDomain: "zone-b",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
          },
        ],
      }),
    );

    expect(result.requests[0].attempts.map((attempt) => attempt.startMs)).toEqual([0, 150, 350]);
    expect(result.requests[0].attempts.map((attempt) => attempt.retryDelayMs)).toEqual([50, 100, null]);
    expect(result.retryAmplification).toBe(3);
  });

  test("opens a circuit and short-circuits backend load", () => {
    const result = simulateRecovery(
      recoveryConfig({
        requestCount: 10,
        requestsPerSecond: 20,
        healthCheckMode: "passive",
        healthFailureThreshold: 99,
        attemptTimeoutMs: 10,
        retry: { maxRetries: 0, baseBackoffMs: 0, jitterMs: 0 },
        circuitBreaker: { enabled: true, failureThreshold: 2, openMs: 200 },
        nodes: [
          {
            id: "server-1",
            failureDomain: "zone-a",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
            failures: [{ startMs: 0, endMs: 5000 }],
          },
          {
            id: "server-2",
            failureDomain: "zone-b",
            serviceTimeMs: 10,
            networkLatencyMs: 0,
          },
        ],
      }),
    );

    expect(result.circuitTrips).toBeGreaterThanOrEqual(1);
    expect(result.shortCircuitedAttempts).toBeGreaterThan(0);
    expect(result.backendAttempts).toBeLessThan(result.totalAttempts);
    expect(result.events.some((event) => event.type === "circuit-half-open")).toBe(true);
  });
});

describe("availability composition", () => {
  test("parallel independent replicas multiply away independent failure", () => {
    expect(parallelAvailability([0.9, 0.9])).toBeCloseTo(0.99, 10);
  });

  test("shared failure domains cap the benefit of replicas inside one domain", () => {
    const sameDomain = failureDomainAvailability([
      { domainAvailability: 0.99, nodeAvailability: 0.999, replicas: 3 },
    ]);
    const separateDomains = failureDomainAvailability([
      { domainAvailability: 0.99, nodeAvailability: 0.999, replicas: 1 },
      { domainAvailability: 0.99, nodeAvailability: 0.999, replicas: 1 },
      { domainAvailability: 0.99, nodeAvailability: 0.999, replicas: 1 },
    ]);

    expect(sameDomain).toBeLessThan(0.991);
    expect(separateDomains).toBeGreaterThan(0.999);
    expect(separateDomains).toBeGreaterThan(sameDomain);
  });
});

describe("simulateElection", () => {
  test("elects a new leader after timeout and fences the recovered stale leader", () => {
    const result = simulateElection({
      initialLeaderId: "node-1",
      initialTerm: 1,
      heartbeatIntervalMs: 100,
      electionTimeoutMs: 300,
      electionDurationMs: 200,
      nodes: [
        { id: "node-1", failures: [{ startMs: 1000, endMs: 3000 }] },
        { id: "node-2" },
        { id: "node-3" },
      ],
    });

    expect(result.detectionAtMs).toBe(1200);
    expect(result.leaderElectedAtMs).toBe(1400);
    expect(result.finalLeaderId).toBe("node-2");
    expect(result.finalTerm).toBe(2);
    expect(result.fencedStaleWrites).toBe(1);
    expect(result.events.some((event) => event.type === "stale-leader-fenced")).toBe(true);
  });

  test("cannot elect a leader without a majority", () => {
    const result = simulateElection({
      initialLeaderId: "node-1",
      initialTerm: 4,
      heartbeatIntervalMs: 100,
      electionTimeoutMs: 300,
      electionDurationMs: 200,
      nodes: [
        { id: "node-1", failures: [{ startMs: 1000, endMs: 4000 }] },
        { id: "node-2", failures: [{ startMs: 0, endMs: 4000 }] },
        { id: "node-3", failures: [{ startMs: 0, endMs: 4000 }] },
        { id: "node-4" },
        { id: "node-5" },
      ],
    });

    expect(result.quorumSize).toBe(3);
    expect(result.electionSucceeded).toBe(false);
    expect(result.finalLeaderId).toBeNull();
    expect(result.fencedStaleWrites).toBe(0);
  });

  test("does not start an election for a short leader interruption", () => {
    const result = simulateElection({
      initialLeaderId: "node-1",
      initialTerm: 2,
      heartbeatIntervalMs: 100,
      electionTimeoutMs: 400,
      electionDurationMs: 200,
      nodes: [
        { id: "node-1", failures: [{ startMs: 1000, endMs: 1150 }] },
        { id: "node-2" },
        { id: "node-3" },
      ],
    });

    expect(result.electionSucceeded).toBe(false);
    expect(result.finalLeaderId).toBe("node-1");
    expect(result.finalTerm).toBe(2);
    expect(result.events.some((event) => event.type === "term-started")).toBe(false);
  });
});
