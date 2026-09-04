import { describe, expect, test } from "bun:test";
import { simulateFlow } from "./flow-model";

const base = {
  parentRequests: 20,
  fanout: 3,
  poolSize: 1,
  normalServiceMs: 10,
  slowServiceMs: 120,
  slowEvery: 5,
  handshakeMs: 15,
  reuseConnections: true,
  parentArrivalIntervalMs: 20,
} as const;

describe("flow model", () => {
  test("is deterministic", () => {
    expect(simulateFlow(base)).toEqual(simulateFlow(base));
  });

  test("a larger pool reduces head-of-line queueing", () => {
    const one = simulateFlow(base);
    const four = simulateFlow({ ...base, poolSize: 4 });

    expect(four.meanQueueDelayMs ?? Infinity).toBeLessThan(one.meanQueueDelayMs ?? 0);
    expect(four.p95ParentLatencyMs ?? Infinity).toBeLessThan(one.p95ParentLatencyMs ?? 0);
  });

  test("connection reuse avoids repeated handshakes", () => {
    const reused = simulateFlow(base);
    const fresh = simulateFlow({ ...base, reuseConnections: false });

    expect(reused.handshakes).toBe(base.poolSize);
    expect(fresh.handshakes).toBe(fresh.totalChildren);
    expect(reused.meanParentLatencyMs ?? Infinity).toBeLessThan(fresh.meanParentLatencyMs ?? 0);
  });

  test("fan-out parent latency waits for its slowest child", () => {
    const result = simulateFlow({ ...base, parentRequests: 4, slowEvery: 3, poolSize: 3 });
    const firstParent = result.parents[0];
    const firstChildren = result.children.filter((child) => child.parentId === 0);
    const expected = Math.max(...firstChildren.map((child) => child.completionMs)) - firstParent.arrivalMs;

    expect(firstParent.latencyMs).toBe(expected);
    expect(result.slowChildren).toBeGreaterThan(0);
  });
});
