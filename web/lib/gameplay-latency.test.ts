import { describe, expect, test } from "bun:test";
import { compareSignalingRegions, simulateGameplayLatency } from "./gameplay-latency";

const players = ["frankfurt", "virginia", "singapore"] as const;

describe("control-plane versus gameplay latency", () => {
  test("changing only the signaling region changes setup but not direct gameplay", () => {
    const comparison = compareSignalingRegions({
      playerSiteIds: players,
      topology: "full-mesh",
      hostSiteId: "frankfurt",
      connectivityMode: "direct",
      turnRegionId: "eu-central",
    });

    expect(new Set(comparison.map((entry) => entry.setupLatencyMs)).size).toBeGreaterThan(1);
    expect(new Set(comparison.map((entry) => entry.meanGameplayRttMs)).size).toBe(1);
    expect(new Set(comparison.map((entry) => entry.worstGameplayRttMs)).size).toBe(1);
  });

  test("full mesh and host spoke expose different path geometry", () => {
    const fullMesh = simulateGameplayLatency({
      playerSiteIds: players,
      signalingRegionId: "eu-central",
      topology: "full-mesh",
      hostSiteId: "frankfurt",
      connectivityMode: "direct",
      turnRegionId: "eu-central",
    });
    const frankfurtHost = simulateGameplayLatency({
      playerSiteIds: players,
      signalingRegionId: "eu-central",
      topology: "host-spoke",
      hostSiteId: "frankfurt",
      connectivityMode: "direct",
      turnRegionId: "eu-central",
    });
    const virginiaHost = simulateGameplayLatency({
      playerSiteIds: players,
      signalingRegionId: "eu-central",
      topology: "host-spoke",
      hostSiteId: "virginia",
      connectivityMode: "direct",
      turnRegionId: "eu-central",
    });

    expect(fullMesh.gameplayEdges).toHaveLength(3);
    expect(frankfurtHost.gameplayEdges).toHaveLength(2);
    expect(frankfurtHost.worstGameplayRttMs).toBe(158);
    expect(virginiaHost.worstGameplayRttMs).toBe(196);
  });

  test("TURN geography becomes part of the established gameplay path", () => {
    const europeRelay = simulateGameplayLatency({
      playerSiteIds: ["frankfurt", "singapore"],
      signalingRegionId: "eu-central",
      topology: "full-mesh",
      hostSiteId: "frankfurt",
      connectivityMode: "turn-fallback",
      turnRegionId: "eu-central",
    });
    const singaporeRelay = simulateGameplayLatency({
      playerSiteIds: ["frankfurt", "singapore"],
      signalingRegionId: "eu-central",
      topology: "full-mesh",
      hostSiteId: "frankfurt",
      connectivityMode: "turn-fallback",
      turnRegionId: "ap-southeast",
    });

    expect(europeRelay.gameplayEdges[0].path).toBe("turn");
    expect(europeRelay.gameplayEdges[0].viaRegionId).toBe("eu-central");
    expect(europeRelay.gameplayEdges[0].rttMs).toBe(183);
    expect(singaporeRelay.gameplayEdges[0].rttMs).toBe(194);
  });

  test("direct-first fallback keeps the failed direct attempt visible in ICE setup", () => {
    const result = simulateGameplayLatency({
      playerSiteIds: ["frankfurt", "virginia"],
      signalingRegionId: "us-east",
      topology: "full-mesh",
      hostSiteId: "virginia",
      connectivityMode: "turn-fallback",
      turnRegionId: "us-east",
    });

    const ice = result.phases.find((phase) => phase.id === "ice");
    expect(ice?.label).toContain("Direct ICE attempt");
    expect(ice?.latencyMs).toBeGreaterThan(120);
    expect(result.gameplayEdges.every((edge) => edge.path === "turn")).toBe(true);
  });
});
