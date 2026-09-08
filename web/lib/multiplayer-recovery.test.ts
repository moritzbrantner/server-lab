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
    expect(result.requiredControlPlane).toEqual(["directory", "signaling"]);
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
    expect(result.operationAvailable).toBe(true);
    expect(result.gameplayAvailable).toBe(true);
    expect(result.requiresControlPlane).toBe(false);
    expect(result.requiredControlPlane).toEqual([]);
    expect(result.blockers.map((blocker) => blocker.service)).toEqual([
      "directory",
      "signaling",
    ]);
  });

  test("ICE restart makes signaling necessary again without requiring directory lookup", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "recovering",
      recoveryKind: "ice-restart",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "failed",
    });

    expect(result.gameplayAvailable).toBe(false);
    expect(result.requiredControlPlane).toEqual(["signaling"]);
    expect(result.recoveryAvailable).toBe(true);
    expect(result.explanation).toContain("ICE restart");
  });

  test("ICE restart is blocked when the selected signaling region is unavailable", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "recovering",
      recoveryKind: "ice-restart",
      signalingRegionId: "ap-southeast",
      signalingStateByRegion: { "ap-southeast": "partitioned" },
      directoryState: "available",
    });

    expect(result.requiredControlPlane).toEqual(["signaling"]);
    expect(result.recoveryAvailable).toBe(false);
    expect(result.blockers).toEqual([
      { service: "signaling", state: "partitioned", regionId: "ap-southeast" },
    ]);
  });

  test("a full rejoin needs both room lookup and signaling again", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "recovering",
      recoveryKind: "rejoin",
      signalingRegionId: "us-east",
      signalingStateByRegion: {},
      directoryState: "partitioned",
    });

    expect(result.requiredControlPlane).toEqual(["directory", "signaling"]);
    expect(result.recoveryAvailable).toBe(false);
    expect(result.explanation).toContain("Rejoin is blocked");
  });

  test("TURN outages do not affect an established direct gameplay path", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "established",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "available",
      gameplayPath: "direct",
      turnStateByRegion: { "eu-central": "failed" },
    });

    expect(result.gameplayAvailable).toBe(true);
    expect(result.recoveryRequired).toBe(false);
    expect(result.turnAvailable).toBeNull();
    expect(result.blockers.some((blocker) => blocker.service === "turn")).toBe(false);
  });

  test("failure of the active TURN region breaks an established relayed gameplay path", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "established",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "available",
      gameplayPath: "turn",
      turnRegionId: "eu-central",
      turnStateByRegion: { "eu-central": "failed" },
    });

    expect(result.signalingAvailable).toBe(true);
    expect(result.turnAvailable).toBe(false);
    expect(result.gameplayAvailable).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.blockers).toContainEqual({
      service: "turn",
      state: "failed",
      regionId: "eu-central",
    });
  });

  test("TURN failure is scoped to the relay region actually on the data path", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "established",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "available",
      gameplayPath: "turn",
      turnRegionId: "ap-southeast",
      turnStateByRegion: { "eu-central": "failed" },
    });

    expect(result.turnAvailable).toBe(true);
    expect(result.gameplayAvailable).toBe(true);
    expect(result.recoveryRequired).toBe(false);
  });

  test("a failed relay is replaced only through an explicit ICE recovery operation", () => {
    const failedPath = simulateMultiplayerFailure({
      lifecycle: "established",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "failed",
      gameplayPath: "turn",
      turnRegionId: "eu-central",
      turnStateByRegion: { "eu-central": "failed" },
    });
    expect(failedPath.gameplayAvailable).toBe(false);

    const recovery = simulateMultiplayerFailure({
      lifecycle: "recovering",
      recoveryKind: "turn-reallocate",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "failed",
      gameplayPath: "turn",
      turnRegionId: "eu-central",
      replacementTurnRegionId: "us-east",
      turnStateByRegion: { "eu-central": "failed", "us-east": "available" },
    });

    expect(recovery.requiredControlPlane).toEqual(["signaling"]);
    expect(recovery.replacementTurnAvailable).toBe(true);
    expect(recovery.recoveryAvailable).toBe(true);
    expect(recovery.explanation).toContain("explicit ICE recovery operation");
  });

  test("TURN reallocation fails closed when the replacement relay is unavailable", () => {
    const result = simulateMultiplayerFailure({
      lifecycle: "recovering",
      recoveryKind: "turn-reallocate",
      signalingRegionId: "eu-central",
      signalingStateByRegion: {},
      directoryState: "available",
      gameplayPath: "turn",
      turnRegionId: "eu-central",
      replacementTurnRegionId: "us-east",
      turnStateByRegion: { "eu-central": "failed", "us-east": "partitioned" },
    });

    expect(result.recoveryAvailable).toBe(false);
    expect(result.blockers).toContainEqual({
      service: "turn",
      state: "partitioned",
      regionId: "us-east",
    });
  });

  test("recovery mode and TURN path ownership must be explicit", () => {
    expect(() =>
      simulateMultiplayerFailure({
        lifecycle: "recovering",
        signalingRegionId: "eu-central",
        signalingStateByRegion: {},
        directoryState: "available",
      }),
    ).toThrow("explicit recovery kind");

    expect(() =>
      simulateMultiplayerFailure({
        lifecycle: "established",
        recoveryKind: "ice-restart",
        signalingRegionId: "eu-central",
        signalingStateByRegion: {},
        directoryState: "available",
      }),
    ).toThrow("valid only while recovering");

    expect(() =>
      simulateMultiplayerFailure({
        lifecycle: "established",
        signalingRegionId: "eu-central",
        signalingStateByRegion: {},
        directoryState: "available",
        gameplayPath: "turn",
      }),
    ).toThrow("active relay region");

    expect(() =>
      simulateMultiplayerFailure({
        lifecycle: "recovering",
        recoveryKind: "turn-reallocate",
        signalingRegionId: "eu-central",
        signalingStateByRegion: {},
        directoryState: "available",
        gameplayPath: "turn",
        turnRegionId: "eu-central",
      }),
    ).toThrow("replacement relay region");
  });
});
