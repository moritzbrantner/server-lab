import {
  GLOBAL_REGIONS,
  type GlobalRegionId,
} from "./global-ingress";

export type ServerDistributionPolicy =
  | "round-robin"
  | "least-loaded"
  | "rendezvous"
  | "power-of-two";

export interface RegionOwnedRoom {
  roomId: string;
  regionId: GlobalRegionId;
  demandUnits: number;
}

export interface ServerProcessDefinition {
  processId: string;
  hostId: string;
  failureDomain: string;
  regionId: GlobalRegionId;
  capacityUnits: number;
  healthy: boolean;
  draining: boolean;
}

export interface ProcessAssignment {
  roomId: string;
  regionId: GlobalRegionId;
  processId: string | null;
  hostId: string | null;
  demandUnits: number;
  reason: string;
}

export interface ProcessSummary extends ServerProcessDefinition {
  usedUnits: number;
  roomCount: number;
  utilization: number;
}

export interface ServerDistributionResult {
  policy: ServerDistributionPolicy;
  assignments: ProcessAssignment[];
  processes: ProcessSummary[];
  assignedRooms: number;
  rejectedRooms: number;
}

export interface HostFailureComparison {
  baseline: ServerDistributionResult;
  failure: ServerDistributionResult;
  failedHostId: string;
  forcedMoves: number;
  extraMoves: number;
  unchangedRooms: number;
  rejectedAfterFailure: number;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function byProcessId(
  left: ServerProcessDefinition,
  right: ServerProcessDefinition,
): number {
  return left.processId.localeCompare(right.processId);
}

export function buildServerTopology(
  capacityUnitsPerProcess = 60,
): ServerProcessDefinition[] {
  return GLOBAL_REGIONS.flatMap((region) =>
    ["a", "b"].flatMap((hostSuffix) => {
      const hostId = `${region.id}-host-${hostSuffix}`;
      return [1, 2].map((processNumber) => ({
        processId: `${hostId}-p${processNumber}`,
        hostId,
        failureDomain: hostId,
        regionId: region.id,
        capacityUnits: capacityUnitsPerProcess,
        healthy: true,
        draining: false,
      }));
    }),
  );
}

function eligibleProcesses(
  room: RegionOwnedRoom,
  processes: readonly ServerProcessDefinition[],
  usedByProcess: ReadonlyMap<string, number>,
): ServerProcessDefinition[] {
  return processes.filter((process) => {
    const used = usedByProcess.get(process.processId) ?? 0;
    return (
      process.regionId === room.regionId &&
      process.healthy &&
      !process.draining &&
      used + room.demandUnits <= process.capacityUnits
    );
  });
}

function utilization(
  process: ServerProcessDefinition,
  usedByProcess: ReadonlyMap<string, number>,
): number {
  if (process.capacityUnits <= 0) {
    return 1;
  }
  return (usedByProcess.get(process.processId) ?? 0) / process.capacityUnits;
}

function chooseLeastLoaded(
  candidates: readonly ServerProcessDefinition[],
  usedByProcess: ReadonlyMap<string, number>,
): ServerProcessDefinition {
  return [...candidates].sort(
    (left, right) =>
      utilization(left, usedByProcess) - utilization(right, usedByProcess) ||
      byProcessId(left, right),
  )[0]!;
}

function chooseRendezvous(
  room: RegionOwnedRoom,
  candidates: readonly ServerProcessDefinition[],
): ServerProcessDefinition {
  return [...candidates].sort((left, right) => {
    const leftHash = stableHash(`${room.roomId}|${left.processId}`);
    const rightHash = stableHash(`${room.roomId}|${right.processId}`);
    return rightHash - leftHash || byProcessId(left, right);
  })[0]!;
}

function choosePowerOfTwo(
  room: RegionOwnedRoom,
  candidates: readonly ServerProcessDefinition[],
  usedByProcess: ReadonlyMap<string, number>,
): ServerProcessDefinition {
  const choices = [...candidates]
    .sort((left, right) => {
      const leftHash = stableHash(`${room.roomId}|candidate|${left.processId}`);
      const rightHash = stableHash(`${room.roomId}|candidate|${right.processId}`);
      return rightHash - leftHash || byProcessId(left, right);
    })
    .slice(0, Math.min(2, candidates.length));
  return chooseLeastLoaded(choices, usedByProcess);
}

export function distributeRooms(
  policy: ServerDistributionPolicy,
  rooms: readonly RegionOwnedRoom[],
  processes: readonly ServerProcessDefinition[],
): ServerDistributionResult {
  const usedByProcess = new Map<string, number>();
  const countByProcess = new Map<string, number>();
  const roundRobinIndex = new Map<GlobalRegionId, number>();
  const assignments: ProcessAssignment[] = [];

  for (const room of rooms) {
    const candidates = eligibleProcesses(room, processes, usedByProcess).sort(byProcessId);
    if (candidates.length === 0) {
      assignments.push({
        roomId: room.roomId,
        regionId: room.regionId,
        processId: null,
        hostId: null,
        demandUnits: room.demandUnits,
        reason: "No healthy non-draining process in the owning region has sufficient capacity.",
      });
      continue;
    }

    let selected: ServerProcessDefinition;
    switch (policy) {
      case "round-robin": {
        const index = roundRobinIndex.get(room.regionId) ?? 0;
        selected = candidates[index % candidates.length]!;
        roundRobinIndex.set(room.regionId, index + 1);
        break;
      }
      case "least-loaded":
        selected = chooseLeastLoaded(candidates, usedByProcess);
        break;
      case "rendezvous":
        selected = chooseRendezvous(room, candidates);
        break;
      case "power-of-two":
        selected = choosePowerOfTwo(room, candidates, usedByProcess);
        break;
    }

    usedByProcess.set(
      selected.processId,
      (usedByProcess.get(selected.processId) ?? 0) + room.demandUnits,
    );
    countByProcess.set(
      selected.processId,
      (countByProcess.get(selected.processId) ?? 0) + 1,
    );
    assignments.push({
      roomId: room.roomId,
      regionId: room.regionId,
      processId: selected.processId,
      hostId: selected.hostId,
      demandUnits: room.demandUnits,
      reason: `Assigned within ${room.regionId} by ${policy}.`,
    });
  }

  const summaries = processes.map((process): ProcessSummary => {
    const usedUnits = usedByProcess.get(process.processId) ?? 0;
    return {
      ...process,
      usedUnits,
      roomCount: countByProcess.get(process.processId) ?? 0,
      utilization:
        process.capacityUnits === 0 ? 0 : usedUnits / process.capacityUnits,
    };
  });

  const assignedRooms = assignments.filter(
    (assignment) => assignment.processId !== null,
  ).length;
  return {
    policy,
    assignments,
    processes: summaries,
    assignedRooms,
    rejectedRooms: assignments.length - assignedRooms,
  };
}

export function compareHostFailure(
  policy: ServerDistributionPolicy,
  rooms: readonly RegionOwnedRoom[],
  processes: readonly ServerProcessDefinition[],
  failedHostId: string,
): HostFailureComparison {
  const baseline = distributeRooms(policy, rooms, processes);
  const failure = distributeRooms(
    policy,
    rooms,
    processes.map((process) => ({
      ...process,
      healthy: process.hostId === failedHostId ? false : process.healthy,
    })),
  );
  const failureByRoom = new Map(
    failure.assignments.map((assignment) => [assignment.roomId, assignment]),
  );
  let forcedMoves = 0;
  let extraMoves = 0;
  let unchangedRooms = 0;

  for (const original of baseline.assignments) {
    if (original.processId === null) {
      continue;
    }
    const next = failureByRoom.get(original.roomId);
    if (next?.processId === original.processId) {
      unchangedRooms += 1;
    } else if (original.hostId === failedHostId) {
      forcedMoves += 1;
    } else {
      extraMoves += 1;
    }
  }

  return {
    baseline,
    failure,
    failedHostId,
    forcedMoves,
    extraMoves,
    unchangedRooms,
    rejectedAfterFailure: failure.rejectedRooms,
  };
}

export function markHostDraining(
  processes: readonly ServerProcessDefinition[],
  hostId: string,
): ServerProcessDefinition[] {
  return processes.map((process) => ({
    ...process,
    draining: process.hostId === hostId ? true : process.draining,
  }));
}
