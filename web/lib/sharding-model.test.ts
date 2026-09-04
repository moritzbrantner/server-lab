import { describe, expect, test } from "bun:test";
import { simulateSharding } from "./sharding-model";

const base = {
  keyCount: 1000,
  nodeCount: 3,
  virtualNodesPerNode: 64,
  hotKeyWeight: 1,
} as const;

describe("sharding model", () => {
  test("is deterministic", () => {
    const config = { ...base, strategy: "consistent-hash" as const };
    expect(simulateSharding(config)).toEqual(simulateSharding(config));
  });

  test("consistent hashing moves fewer keys when adding a node", () => {
    const modulo = simulateSharding({ ...base, strategy: "modulo" });
    const ring = simulateSharding({ ...base, strategy: "consistent-hash" });

    expect(ring.movedFraction).toBeLessThan(modulo.movedFraction);
  });

  test("virtual nodes keep every node represented", () => {
    const result = simulateSharding({ ...base, strategy: "consistent-hash" });
    expect(result.after.every((node) => node.keys > 0)).toBe(true);
  });

  test("a hot key creates load skew even when key counts look balanced", () => {
    const result = simulateSharding({
      ...base,
      strategy: "consistent-hash",
      hotKeyWeight: 500,
    });

    expect(result.imbalanceRatio).toBeGreaterThan(1.5);
    const hotNode = result.after.find((node) => node.nodeId === result.hotKeyNode);
    expect(hotNode?.weightedRequests ?? 0).toBe(result.maxWeightedLoad);
  });
});
