import { describe, expect, test } from "bun:test";
import { simulateDirectoryAuthorityRecovery } from "./multiplayer-directory-recovery";

describe("multiplayer directory authority recovery", () => {
  test("reuses election detection, promotion term, and stale-writer fencing", () => {
    const result = simulateDirectoryAuthorityRecovery({
      initialLeaderRegionId: "eu-central",
      failure: { startMs: 100, endMs: 900 },
      initialTerm: 7,
      heartbeatIntervalMs: 50,
      electionTimeoutMs: 150,
      electionDurationMs: 40,
    });

    expect(result.quorumSize).toBe(2);
    expect(result.electionSucceeded).toBe(true);
    expect(result.detectionAtMs).toBe(200);
    expect(result.failoverCompleteMs).toBe(240);
    expect(result.recoveryWindowMs).toBe(140);
    expect(result.finalLeaderRegionId).not.toBe("eu-central");
    expect(result.finalTerm).toBe(8);
    expect(result.staleWritesFenced).toBe(1);
    expect(result.events.some((event) => event.type === "term-started")).toBe(true);
    expect(result.events.some((event) => event.type === "leader-elected")).toBe(true);
    expect(result.events.some((event) => event.type === "stale-leader-fenced")).toBe(true);
  });

  test("a leader that recovers before detection is not needlessly replaced", () => {
    const result = simulateDirectoryAuthorityRecovery({
      initialLeaderRegionId: "eu-central",
      failure: { startMs: 100, endMs: 180 },
      initialTerm: 7,
      heartbeatIntervalMs: 50,
      electionTimeoutMs: 150,
      electionDurationMs: 40,
    });

    expect(result.electionSucceeded).toBe(false);
    expect(result.detectionAtMs).toBe(200);
    expect(result.failoverCompleteMs).toBeNull();
    expect(result.finalLeaderRegionId).toBe("eu-central");
    expect(result.finalTerm).toBe(7);
    expect(result.staleWritesFenced).toBe(0);
    expect(result.events.some((event) => event.type === "leader-recovered")).toBe(true);
  });
});
