import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  type ClientSiteId,
  type GlobalRegionId,
  type TrafficProfile,
} from "./global-ingress";

export type FleetPlacementPolicy =
  | "min-average-rtt"
  | "min-worst-rtt"
  | "load-aware"
  | "rendezvous"
  | "power-of-two";

export interface RoomWorkload {
  roomId: string;
  participantSites: readonly ClientSiteId[];
  demandUnits: number;
}

export interface RegionCapacity {
  regionId: GlobalRegionId;
  capacityUnits: number;
  healthy: boolean;
}

export interface RoomFleetPlacement {
  roomId: string;
  regionId: GlobalRegionId | null;
  demandUnits: number;
  averageRttMs: number | null;
  worstRttMs: number | null;
  reason: string;
}

export interface RegionFleetSummary {
  regionId: GlobalRegionId;
  healthy: boolean;
  capacityUnits: number;
  usedUnits: number;
  roomCount: number;
  utilization: number;
}

export interface FleetPlacementResult {
  policy: FleetPlacementPolicy;
  rooms: RoomFleetPlacement[];
  regions: RegionFleetSummary[];
  assignedRooms: number;
  rejectedRooms: number;
  meanPlayerRttMs: number | null;
  worstPlayerRttMs: number | null;
}

export interface FleetFailureComparison {
  baseline: FleetPlacementResult;
  failure: FleetPlacementResult;
  failedRegionId: GlobalRegionId;
  forcedMoves: number;
  extraMoves: number;
  unchangedRooms: number;
  rejectedAfterFailure: number;
}

const LOAD_PENALTY_MS = 160;

const PROFILE_PATTERNS: Record<TrafficProfile, readonly ClientSiteId[][]> = {
  balanced: [
    ["frankfurt", "virginia"],
    ["frankfurt", "singapore"],
    ["virginia", "singapore"],
    ["frankfurt", "virginia", "singapore"],
  ],
  "europe-heavy": [
    ["frankfurt", "frankfurt"],
    ["frankfurt", "virginia"],
    ["frankfurt", "singapore"],
    ["frankfurt", "frankfurt", "virginia"],
  ],
  "asia-heavy": [
    ["singapore", "singapore"],
    ["singapore", "virginia"],
    ["singapore", "frankfurt"],
    ["singapore", "singapore", "virginia"],
  ],
};

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function site(siteId: ClientSiteId) {
  const match = CLIENT_SITES.find((candidate) => candidate.id === siteId);
  if (!match) {
    throw new Error(`unknown client site: ${siteId}`);
  }
  return match;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roomLatency(room: RoomWorkload, regionId: GlobalRegionId) {
  const rtts = room.participantSites.map(
    (siteId) => site(siteId).baseRttMs[regionId],
  );
  return {
    averageRttMs: mean(rtts) ?? 0,
    worstRttMs: Math.max(...rtts),
  };
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function regionOrder(regionId: GlobalRegionId): number {
  return GLOBAL_REGIONS.findIndex((region) => region.id === regionId);
}

function compareRegions(
  left: GlobalRegionId,
  right: GlobalRegionId,
): number {
  return regionOrder(left) - regionOrder(right);
}

export function generateRoomWorkload(
  roomCount: number,
  profile: TrafficProfile,
): RoomWorkload[] {
  const count = clampInteger(roomCount, 1, 240);
  const pattern = PROFILE_PATTERNS[profile];
  return Array.from({ length: count }, (_, index) => ({
    roomId: `room-${String(index + 1).padStart(3, "0")}`,
    participantSites: pattern[index % pattern.length] ?? pattern[0] ?? ["frankfurt"],
    demandUnits: 1 + (index % 5),
  }));
}

function eligibleRegions(
  room: RoomWorkload,
  capacities: readonly RegionCapacity[],
  usedByRegion: ReadonlyMap<GlobalRegionId, number>,
): RegionCapacity[] {
  return capacities.filter((capacity) => {
    const used = usedByRegion.get(capacity.regionId) ?? 0;
    return capacity.healthy && used + room.demandUnits <= capacity.capacityUnits;
  });
}

function chooseLatencyRegion(
  room: RoomWorkload,
  candidates: readonly RegionCapacity[],
  metric: "average" | "worst",
): GlobalRegionId {
  return [...candidates]
    .sort((left, right) => {
      const leftLatency = roomLatency(room, left.regionId);
      const rightLatency = roomLatency(room, right.regionId);
      const leftScore = metric === "average" ? leftLatency.averageRttMs : leftLatency.worstRttMs;
      const rightScore = metric === "average" ? rightLatency.averageRttMs : rightLatency.worstRttMs;
      return leftScore - rightScore || compareRegions(left.regionId, right.regionId);
    })[0]!.regionId;
}

function chooseLoadAwareRegion(
  room: RoomWorkload,
  candidates: readonly RegionCapacity[],
  usedByRegion: ReadonlyMap<GlobalRegionId, number>,
): GlobalRegionId {
  return [...candidates]
    .sort((left, right) => {
      const score = (candidate: RegionCapacity) => {
        const used = usedByRegion.get(candidate.regionId) ?? 0;
        const utilization = candidate.capacityUnits === 0 ? 1 : used / candidate.capacityUnits;
        return roomLatency(room, candidate.regionId).averageRttMs + utilization * LOAD_PENALTY_MS;
      };
      return score(left) - score(right) || compareRegions(left.regionId, right.regionId);
    })[0]!.regionId;
}

function chooseRendezvousRegion(
  room: RoomWorkload,
  candidates: readonly RegionCapacity[],
): GlobalRegionId {
  return [...candidates]
    .sort((left, right) => {
      const leftHash = stableHash(`${room.roomId}|${left.regionId}`);
      const rightHash = stableHash(`${room.roomId}|${right.regionId}`);
      return rightHash - leftHash || compareRegions(left.regionId, right.regionId);
    })[0]!.regionId;
}

function choosePowerOfTwoRegion(
  room: RoomWorkload,
  candidates: readonly RegionCapacity[],
  usedByRegion: ReadonlyMap<GlobalRegionId, number>,
): GlobalRegionId {
  const hashed = [...candidates].sort((left, right) => {
    const leftHash = stableHash(`${room.roomId}|candidate|${left.regionId}`);
    const rightHash = stableHash(`${room.roomId}|candidate|${right.regionId}`);
    return rightHash - leftHash || compareRegions(left.regionId, right.regionId);
  });
  const choices = hashed.slice(0, Math.min(2, hashed.length));
  return choices
    .sort((left, right) => {
      const utilization = (candidate: RegionCapacity) =>
        (usedByRegion.get(candidate.regionId) ?? 0) / candidate.capacityUnits;
      const loadDifference = utilization(left) - utilization(right);
      if (loadDifference !== 0) {
        return loadDifference;
      }
      const latencyDifference =
        roomLatency(room, left.regionId).averageRttMs -
        roomLatency(room, right.regionId).averageRttMs;
      return latencyDifference || compareRegions(left.regionId, right.regionId);
    })[0]!.regionId;
}

function chooseRegion(
  policy: FleetPlacementPolicy,
  room: RoomWorkload,
  candidates: readonly RegionCapacity[],
  usedByRegion: ReadonlyMap<GlobalRegionId, number>,
): GlobalRegionId {
  switch (policy) {
    case "min-average-rtt":
      return chooseLatencyRegion(room, candidates, "average");
    case "min-worst-rtt":
      return chooseLatencyRegion(room, candidates, "worst");
    case "load-aware":
      return chooseLoadAwareRegion(room, candidates, usedByRegion);
    case "rendezvous":
      return chooseRendezvousRegion(room, candidates);
    case "power-of-two":
      return choosePowerOfTwoRegion(room, candidates, usedByRegion);
  }
}

export function placeFleet(
  policy: FleetPlacementPolicy,
  rooms: readonly RoomWorkload[],
  capacities: readonly RegionCapacity[],
): FleetPlacementResult {
  const usedByRegion = new Map<GlobalRegionId, number>();
  const countByRegion = new Map<GlobalRegionId, number>();
  const placements: RoomFleetPlacement[] = [];
  const allPlayerRtts: number[] = [];

  for (const room of rooms) {
    const candidates = eligibleRegions(room, capacities, usedByRegion);
    if (candidates.length === 0) {
      placements.push({
        roomId: room.roomId,
        regionId: null,
        demandUnits: room.demandUnits,
        averageRttMs: null,
        worstRttMs: null,
        reason: "No healthy region has enough remaining capacity; placement fails closed.",
      });
      continue;
    }

    const regionId = chooseRegion(policy, room, candidates, usedByRegion);
    const latency = roomLatency(room, regionId);
    usedByRegion.set(regionId, (usedByRegion.get(regionId) ?? 0) + room.demandUnits);
    countByRegion.set(regionId, (countByRegion.get(regionId) ?? 0) + 1);
    for (const siteId of room.participantSites) {
      allPlayerRtts.push(site(siteId).baseRttMs[regionId]);
    }
    placements.push({
      roomId: room.roomId,
      regionId,
      demandUnits: room.demandUnits,
      averageRttMs: latency.averageRttMs,
      worstRttMs: latency.worstRttMs,
      reason: `Placed by ${policy} while respecting health and capacity.`,
    });
  }

  const regions = GLOBAL_REGIONS.map((region): RegionFleetSummary => {
    const capacity = capacities.find((candidate) => candidate.regionId === region.id);
    const capacityUnits = capacity?.capacityUnits ?? 0;
    const usedUnits = usedByRegion.get(region.id) ?? 0;
    return {
      regionId: region.id,
      healthy: capacity?.healthy ?? false,
      capacityUnits,
      usedUnits,
      roomCount: countByRegion.get(region.id) ?? 0,
      utilization: capacityUnits === 0 ? 0 : usedUnits / capacityUnits,
    };
  });

  const assigned = placements.filter((placement) => placement.regionId !== null);
  return {
    policy,
    rooms: placements,
    regions,
    assignedRooms: assigned.length,
    rejectedRooms: placements.length - assigned.length,
    meanPlayerRttMs: mean(allPlayerRtts),
    worstPlayerRttMs: allPlayerRtts.length === 0 ? null : Math.max(...allPlayerRtts),
  };
}

export function compareRegionFailure(
  policy: FleetPlacementPolicy,
  rooms: readonly RoomWorkload[],
  capacities: readonly RegionCapacity[],
  failedRegionId: GlobalRegionId,
): FleetFailureComparison {
  const baseline = placeFleet(policy, rooms, capacities);
  const failure = placeFleet(
    policy,
    rooms,
    capacities.map((capacity) => ({
      ...capacity,
      healthy: capacity.regionId === failedRegionId ? false : capacity.healthy,
    })),
  );

  const failureByRoom = new Map(
    failure.rooms.map((placement) => [placement.roomId, placement]),
  );
  let forcedMoves = 0;
  let extraMoves = 0;
  let unchangedRooms = 0;

  for (const original of baseline.rooms) {
    if (original.regionId === null) {
      continue;
    }
    const next = failureByRoom.get(original.roomId);
    if (!next || next.regionId === original.regionId) {
      unchangedRooms += 1;
      continue;
    }
    if (original.regionId === failedRegionId) {
      forcedMoves += 1;
    } else {
      extraMoves += 1;
    }
  }

  return {
    baseline,
    failure,
    failedRegionId,
    forcedMoves,
    extraMoves,
    unchangedRooms,
    rejectedAfterFailure: failure.rejectedRooms,
  };
}
