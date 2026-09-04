import { describe, expect, test } from "bun:test";
import { simulateCap } from "./cap-model";

const base = {
  operationCount: 60,
  operationsPerSecond: 10,
  localLatencyMs: 12,
  quorumLatencyMs: 80,
  asyncReplicationLagOperations: 3,
  partitionStartOperation: 20,
  partitionEndOperation: 40,
} as const;

describe("CAP and PACELC model", () => {
  test("is deterministic", () => {
    const config = { ...base, strategy: "local-availability" as const };
    expect(simulateCap(config)).toEqual(simulateCap(config));
  });

  test("quorum consistency sacrifices isolated-side availability during a partition", () => {
    const result = simulateCap({ ...base, strategy: "quorum-consistency" });

    expect(result.failedOperations).toBeGreaterThan(0);
    expect(result.availability).toBeLessThan(1);
    expect(result.divergentWrites).toBe(0);
  });

  test("local availability keeps serving but creates reconciliation work", () => {
    const result = simulateCap({ ...base, strategy: "local-availability" });

    expect(result.availability).toBe(1);
    expect(result.divergentWrites).toBeGreaterThan(0);
    expect(result.reconciliationWrites).toBe(result.divergentWrites);
  });

  test("local asynchronous operation is faster outside partitions but can be stale", () => {
    const local = simulateCap({
      ...base,
      partitionStartOperation: 60,
      partitionEndOperation: 60,
      strategy: "local-availability",
    });
    const quorum = simulateCap({
      ...base,
      partitionStartOperation: 60,
      partitionEndOperation: 60,
      strategy: "quorum-consistency",
    });

    expect(local.meanLatencyMs ?? Infinity).toBeLessThan(quorum.meanLatencyMs ?? 0);
    expect(local.staleReads).toBeGreaterThan(0);
    expect(quorum.staleReads).toBe(0);
  });
});
