import { describe, expect, test } from "bun:test";
import {
  compareRegionFailure,
  generateRoomWorkload,
  placeFleet,
  type RegionCapacity,
  type RoomWorkload,
} from "./fleet-placement";

const capacities: RegionCapacity[] = [
  { regionId: "eu-central", capacityUnits: 100, healthy: true },
  { regionId: "us-east", capacityUnits: 100, healthy: true },
  { regionId: "ap-southeast", capacityUnits: 100, healthy: true },
];

describe("fleet-level multi-region placement", () => {
  test("generates deterministic bounded room workloads", () => {
    expect(generateRoomWorkload(3, "balanced")).toEqual([
      {
        roomId: "room-001",
        participantSites: ["frankfurt", "virginia"],
        demandUnits: 1,
      },
      {
        roomId: "room-002",
        participantSites: ["frankfurt", "singapore"],
        demandUnits: 2,
      },
      {
        roomId: "room-003",
        participantSites: ["virginia", "singapore"],
        demandUnits: 3,
      },
    ]);
  });

  test("latency placement chooses the best deterministic region for a room", () => {
    const rooms: RoomWorkload[] = [
      {
        roomId: "europe-room",
        participantSites: ["frankfurt", "frankfurt", "virginia"],
        demandUnits: 3,
      },
    ];

    expect(placeFleet("min-average-rtt", rooms, capacities).rooms[0]?.regionId).toBe(
      "eu-central",
    );
    expect(placeFleet("min-worst-rtt", rooms, capacities).rooms[0]?.regionId).toBe(
      "eu-central",
    );
  });

  test("all policies respect health and hard regional capacity", () => {
    const rooms = generateRoomWorkload(80, "balanced");
    const constrained: RegionCapacity[] = [
      { regionId: "eu-central", capacityUnits: 35, healthy: true },
      { regionId: "us-east", capacityUnits: 35, healthy: false },
      { regionId: "ap-southeast", capacityUnits: 35, healthy: true },
    ];

    for (const policy of [
      "min-average-rtt",
      "min-worst-rtt",
      "load-aware",
      "rendezvous",
      "power-of-two",
    ] as const) {
      const result = placeFleet(policy, rooms, constrained);
      expect(result.rooms.some((room) => room.regionId === "us-east")).toBe(false);
      expect(result.regions.every((region) => region.usedUnits <= region.capacityUnits)).toBe(
        true,
      );
      expect(result.rejectedRooms).toBeGreaterThan(0);
    }
  });

  test("rendezvous hashing avoids avoidable churn when a region fails and spare capacity exists", () => {
    const rooms = generateRoomWorkload(24, "balanced");
    const roomy = capacities.map((capacity) => ({ ...capacity, capacityUnits: 200 }));
    const comparison = compareRegionFailure(
      "rendezvous",
      rooms,
      roomy,
      "us-east",
    );

    expect(comparison.forcedMoves).toBeGreaterThan(0);
    expect(comparison.extraMoves).toBe(0);
    expect(comparison.rejectedAfterFailure).toBe(0);
  });

  test("load-aware placement spreads work without exceeding capacity", () => {
    const result = placeFleet(
      "load-aware",
      generateRoomWorkload(60, "balanced"),
      capacities,
    );

    expect(result.rejectedRooms).toBe(0);
    expect(result.regions.filter((region) => region.roomCount > 0)).toHaveLength(3);
    expect(result.regions.every((region) => region.utilization <= 1)).toBe(true);
  });

  test("failure comparison distinguishes forced moves from cascade churn", () => {
    const rooms = generateRoomWorkload(36, "balanced");
    const comparison = compareRegionFailure(
      "load-aware",
      rooms,
      capacities.map((capacity) => ({ ...capacity, capacityUnits: 180 })),
      "eu-central",
    );

    expect(comparison.forcedMoves).toBeGreaterThan(0);
    expect(
      comparison.forcedMoves + comparison.extraMoves + comparison.unchangedRooms,
    ).toBe(comparison.baseline.assignedRooms);
  });
});
