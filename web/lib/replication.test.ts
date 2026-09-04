import { describe, expect, test } from "bun:test";
import {
  simulateReplication,
  type ReplicationConfig,
  type ReplicationOperationInput,
} from "./replication";

function config(overrides: Partial<ReplicationConfig> = {}): ReplicationConfig {
  return {
    replicaCount: 3,
    replicationMode: "asynchronous",
    readConsistency: "eventual",
    replicationDelayMs: 200,
    replicationJitterMs: 0,
    writeTimeoutMs: 400,
    readTimeoutMs: 400,
    operationCount: 8,
    operationIntervalMs: 100,
    writeEvery: 4,
    seed: 7,
    ...overrides,
  };
}

function operations(...items: Array<["write" | "read", number]>): ReplicationOperationInput[] {
  return items.map(([kind, scheduledAtMs]) => ({ kind, scheduledAtMs }));
}

describe("simulateReplication", () => {
  test("is deterministic for the same seed and configuration", () => {
    const first = simulateReplication(config({ replicationJitterMs: 80, seed: 42 }));
    const second = simulateReplication(config({ replicationJitterMs: 80, seed: 42 }));

    expect(second).toEqual(first);
  });

  test("asynchronous follower reads can be stale before replication catches up", () => {
    const result = simulateReplication(
      config({
        operations: operations(["write", 0], ["read", 50]),
      }),
    );

    expect(result.successfulWrites).toBe(1);
    expect(result.staleReads).toBe(1);
    expect(result.operations[1].version).toBe(0);
    expect(result.operations[1].stale).toBe(true);
  });

  test("read-your-writes waits for the selected follower when it can catch up in time", () => {
    const result = simulateReplication(
      config({
        readConsistency: "read-your-writes",
        readTimeoutMs: 500,
        operations: operations(["write", 0], ["read", 50]),
      }),
    );

    expect(result.operations[1].version).toBe(1);
    expect(result.operations[1].waitMs).toBe(150);
    expect(result.operations[1].fallbackToLeader).toBe(false);
    expect(result.readYourWritesViolations).toBe(0);
    expect(result.staleReads).toBe(0);
  });

  test("read-your-writes falls back to the leader when the follower cannot catch up before the read timeout", () => {
    const result = simulateReplication(
      config({
        readConsistency: "read-your-writes",
        readTimeoutMs: 50,
        operations: operations(["write", 0], ["read", 50]),
      }),
    );

    expect(result.operations[1].version).toBe(1);
    expect(result.operations[1].fallbackToLeader).toBe(true);
    expect(result.leaderFallbackReads).toBe(1);
    expect(result.readYourWritesViolations).toBe(0);
  });

  test("synchronous replication waits for every follower before acknowledging", () => {
    const result = simulateReplication(
      config({
        replicationMode: "synchronous",
        readConsistency: "eventual",
        replicationDelayMs: 120,
        operations: operations(["write", 0], ["read", 10]),
      }),
    );

    expect(result.operations[0].completedAtMs).toBe(120);
    expect(result.operations[1].startedAtMs).toBe(120);
    expect(result.operations[1].version).toBe(1);
    expect(result.staleReads).toBe(0);
  });

  test("a majority write survives one follower replication partition", () => {
    const result = simulateReplication(
      config({
        replicationMode: "quorum",
        replicationDelayMs: 100,
        writeTimeoutMs: 300,
        partition: { replicaId: "replica-2", startMs: 0, endMs: 1000 },
        operations: operations(["write", 0]),
      }),
    );

    expect(result.successfulWrites).toBe(1);
    expect(result.failedWrites).toBe(0);
    expect(result.operations[0].completedAtMs).toBe(100);
    expect(result.replicaMetrics.find((replica) => replica.nodeId === "replica-2")?.lagVersions).toBe(1);
  });

  test("sync-all write times out when one follower cannot acknowledge in time", () => {
    const result = simulateReplication(
      config({
        replicationMode: "synchronous",
        replicationDelayMs: 100,
        writeTimeoutMs: 300,
        partition: { replicaId: "replica-2", startMs: 0, endMs: 1000 },
        operations: operations(["write", 0]),
      }),
    );

    expect(result.successfulWrites).toBe(0);
    expect(result.failedWrites).toBe(1);
    expect(result.finalCommittedVersion).toBe(0);
    expect(result.operations[0].failureReason).toBe("write-timeout");
  });

  test("a quorum read recovers the newest acknowledged version despite one stale follower", () => {
    const result = simulateReplication(
      config({
        replicationMode: "quorum",
        readConsistency: "quorum",
        replicationDelayMs: 100,
        writeTimeoutMs: 300,
        partition: { replicaId: "replica-2", startMs: 0, endMs: 1000 },
        operations: operations(["write", 0], ["read", 120]),
      }),
    );

    expect(result.operations[1].targetNodeIds).toEqual(["replica-1", "replica-2"]);
    expect(result.operations[1].observedVersions).toEqual([
      { nodeId: "replica-1", version: 1 },
      { nodeId: "replica-2", version: 0 },
    ]);
    expect(result.operations[1].version).toBe(1);
    expect(result.operations[1].stale).toBe(false);
  });

  test("partitioned asynchronous followers accumulate visible replica lag", () => {
    const result = simulateReplication(
      config({
        partition: { replicaId: "replica-1", startMs: 0, endMs: 1000 },
        operations: operations(["write", 0], ["write", 100], ["read", 200]),
      }),
    );

    const replica = result.replicaMetrics.find((metric) => metric.nodeId === "replica-1");
    expect(result.finalCommittedVersion).toBe(2);
    expect(replica?.lagVersions).toBe(2);
    expect(replica?.pendingUpdates).toBe(2);
    expect(result.maxReplicaLagVersions).toBeGreaterThanOrEqual(2);
  });
});
