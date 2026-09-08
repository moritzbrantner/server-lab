import { describe, expect, test } from "bun:test";
import { simulateMultiplayerFailure } from "./multiplayer-recovery";

describe("regional multiplayer failure semantics", () => {
  test("an establishing session fails closed when its selected signaling region fails", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "establishing",
      signalingRegionId: "eu-central",
      signalingStateByRegion: { "eu-central": "failed" },
      directoryState: "available",
    });

    expect(result.setupAvailable).toBe(false);
    expect(result.gameplayAvailable).toBe(false);
    expect(result.requiresControlPlane).toBe(true);
    expect(result.blockers).toEqual([
      { service: "signaling", state: "failed", regionId: "eu-central" },
    ]);
  });

  test("signaling failure is scoped to the selected region", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "establishing",
      signalingRegionId: "eu-central",
      signalingStateByRegion: { "us-east": "failed" },
      directoryState: "available",
    });

    expect(result.signalingAvailable).toBe(true);
    expect(result.setupAvailable).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("a partitioned global directory blocks new establishment independently of signaling", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "establishing",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "partitioned",
    });

    expect(result.directoryAvailable).toBe(false);
    expect(result.signalingAvailable).toBe(true);
    expect(result.setupAvailable).toBe(false);
    expect(result.blockers).toEqual([
      { service: "directory", state: "partitioned", regionId: null },
    ]);
  });

  test("an established direct DataChannel keeps gameplay alive through control-plane failure", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "established",
      signalingRegionId: "eu-central",
      signalingStateByRegion: { "eu-central": "partitioned" },
      directoryState: "failed",
    });

    expect(result.controlPlaneAvailable).toBe(false);
    expect(result.setupAvailable).toBe(false);
    expect(result.gameplayAvailable).toBe(true);
    expect(result.requiresControlPlane).toBe(false);
    expect(result.blockers.map((blocker) => blocker.service)).toEqual([
      "directory",
      "signaling",
    ]);
  });
});
