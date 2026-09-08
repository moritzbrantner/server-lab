import { describe, expect, test } from "bun:test";
import {
  compareJoinPaths,
  placeRoom,
  resolveRoomDirectory,
  simulateRoomAuthority,
} from "./room-authority";

describe("regional room authority", () => {
  test("assigns exactly one deterministic owner and converges clients from different ingress regions", () => {
    const result = simulateRoomAuthority({
      roomId: "room-alpha",
      creatorSiteId: "frankfurt",
      playerSiteIds: ["singapore"],
      clientIngresses: [
        { siteId: "frankfurt", ingressRegionId: "eu-central" },
        { siteId: "singapore", ingressRegionId: "ap-southeast" },
      ],
      placementPolicy: "creator-nearest",
      fixedRegionId: "us-east",
      directoryState: "fresh",
    });

    expect(result.placement.regionId).toBe("eu-central");
    expect(result.directoryEntry).toEqual({
      roomId: "room-alpha",
      regionId: "eu-central",
      generation: 1,
    });
    expect(result.clients.map((client) => client.ingressRegionId)).toEqual([
      "eu-central",
      "ap-southeast",
    ]);
    expect(result.clients.map((client) => client.resolvedOwnerRegionId)).toEqual([
      "eu-central",
      "eu-central",
    ]);
    expect(result.converged).toBe(true);
  });

  test("supports fixed, average-latency, and worst-player placement policies", () => {
    expect(
      placeRoom("fixed-region", "virginia", ["singapore"], "ap-southeast")
        .regionId,
    ).toBe("ap-southeast");

    expect(
      placeRoom("min-average-rtt", "frankfurt", ["virginia", "singapore"], "us-east")
        .regionId,
    ).toBe("eu-central");

    expect(
      placeRoom("min-worst-rtt", "virginia", ["singapore"], "us-east")
        .regionId,
    ).toBe("eu-central");
  });

  test("uses stable region ordering to break equal placement scores", () => {
    const placement = placeRoom(
      "min-average-rtt",
      "frankfurt",
      ["frankfurt"],
      "us-east",
    );

    expect(placement.regionId).toBe("eu-central");
    expect(placement.participantSites).toEqual(["frankfurt"]);
  });

  test("fails closed for stale or unavailable directory state", () => {
    const entry = {
      roomId: "room-alpha",
      regionId: "eu-central" as const,
      generation: 1,
    };

    expect(resolveRoomDirectory(entry, "stale", 1).resolvedRegionId).toBeNull();
    expect(resolveRoomDirectory(entry, "unavailable", 1).resolvedRegionId).toBeNull();
    expect(resolveRoomDirectory(entry, "fresh", 2).resolvedRegionId).toBeNull();
    expect(resolveRoomDirectory(entry, "fresh", 1).resolvedRegionId).toBe("eu-central");
  });

  test("keeps redirect, proxy, and directory hops explicit", () => {
    const paths = compareJoinPaths("singapore", "ap-southeast", "eu-central");
    const redirect = paths.find((path) => path.path === "redirect");
    const proxy = paths.find((path) => path.path === "proxy");
    const directory = paths.find((path) => path.path === "directory");

    expect(redirect?.steps.map((step) => step.label)).toEqual([
      "client ↔ first ingress",
      "client ↔ redirected room owner",
    ]);
    expect(proxy?.interRegionHops).toBe(1);
    expect(proxy?.steps.map((step) => step.label)).toEqual([
      "client ↔ ingress",
      "ingress ↔ room owner region",
    ]);
    expect(directory?.steps.map((step) => step.label)).toEqual([
      "global directory lookup",
      "client ↔ room owner",
    ]);
    expect(paths.every((path) => path.totalLatencyMs > 0)).toBe(true);
  });
});
