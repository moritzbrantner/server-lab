import { describe, expect, test } from "bun:test";
import {
  buildServerTopology,
  compareHostFailure,
  distributeRooms,
  markHostDraining,
  type RegionOwnedRoom,
} from "./server-distribution";

const rooms: RegionOwnedRoom[] = Array.from({ length: 24 }, (_, index) => ({
  roomId: `room-${index + 1}`,
  regionId: index % 2 === 0 ? "eu-central" : "us-east",
  demandUnits: 1 + (index % 4),
}));

describe("hierarchical server distribution", () => {
  test("never schedules a room outside its region authority", () => {
    const result = distributeRooms("least-loaded", rooms, buildServerTopology());

    for (const assignment of result.assignments) {
      if (!assignment.processId) {
        continue;
      }
      const process = result.processes.find(
        (candidate) => candidate.processId === assignment.processId,
      );
      expect(process?.regionId).toBe(assignment.regionId);
    }
  });

  test("all algorithms respect hard process capacity", () => {
    const topology = buildServerTopology(12);
    for (const policy of [
      "round-robin",
      "least-loaded",
      "rendezvous",
      "power-of-two",
    ] as const) {
      const result = distributeRooms(policy, rooms, topology);
      expect(
        result.processes.every(
          (process) => process.usedUnits <= process.capacityUnits,
        ),
      ).toBe(true);
    }
  });

  test("draining processes receive no new placements", () => {
    const topology = buildServerTopology(100);
    const drainingHost = "eu-central-host-a";
    const result = distributeRooms(
      "least-loaded",
      rooms,
      markHostDraining(topology, drainingHost),
    );

    expect(
      result.assignments.some(
        (assignment) => assignment.hostId === drainingHost,
      ),
    ).toBe(false);
  });

  test("rendezvous hashing keeps healthy-process ownership stable after a host failure when capacity is ample", () => {
    const topology = buildServerTopology(200);
    const comparison = compareHostFailure(
      "rendezvous",
      rooms,
      topology,
      "eu-central-host-a",
    );

    expect(comparison.forcedMoves).toBeGreaterThan(0);
    expect(comparison.extraMoves).toBe(0);
    expect(comparison.rejectedAfterFailure).toBe(0);
  });

  test("a failed host excludes every process in its failure domain", () => {
    const topology = buildServerTopology(200);
    const failedHostId = "us-east-host-b";
    const comparison = compareHostFailure(
      "least-loaded",
      rooms,
      topology,
      failedHostId,
    );

    expect(
      comparison.failure.assignments.some(
        (assignment) => assignment.hostId === failedHostId,
      ),
    ).toBe(false);
  });
});
