import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  type ClientSiteId,
  type GlobalRegionId,
} from "./global-ingress";

export type RoomPlacementPolicy =
  | "creator-nearest"
  | "fixed-region"
  | "min-average-rtt"
  | "min-worst-rtt";

export type DirectoryState = "fresh" | "stale" | "unavailable";
export type JoinPath = "redirect" | "proxy" | "directory";

export interface RoomDirectoryEntry {
  roomId: string;
  regionId: GlobalRegionId;
  generation: number;
}

export interface PlacementScore {
  regionId: GlobalRegionId;
  scoreMs: number;
}

export interface RoomPlacementResult {
  regionId: GlobalRegionId;
  policy: RoomPlacementPolicy;
  participantSites: ClientSiteId[];
  scores: PlacementScore[];
}

export interface DirectoryResolution {
  state: DirectoryState;
  resolvedRegionId: GlobalRegionId | null;
  reason: string;
}

export interface JoinPathStep {
  label: string;
  latencyMs: number;
}

export interface JoinPathCost {
  path: JoinPath;
  totalLatencyMs: number;
  clientFacingRoundTrips: number;
  interRegionHops: number;
  steps: JoinPathStep[];
}

export interface RoomClientRoute {
  siteId: ClientSiteId;
  ingressRegionId: GlobalRegionId;
  directory: DirectoryResolution;
  resolvedOwnerRegionId: GlobalRegionId | null;
  convergedOnOwner: boolean;
  pathCosts: JoinPathCost[];
}

export interface RoomAuthoritySimulation {
  roomId: string;
  placement: RoomPlacementResult;
  directoryEntry: RoomDirectoryEntry;
  clients: RoomClientRoute[];
  converged: boolean;
}

export interface RoomAuthoritySimulationInput {
  roomId: string;
  creatorSiteId: ClientSiteId;
  playerSiteIds: readonly ClientSiteId[];
  clientIngresses: readonly {
    siteId: ClientSiteId;
    ingressRegionId: GlobalRegionId;
  }[];
  placementPolicy: RoomPlacementPolicy;
  fixedRegionId: GlobalRegionId;
  directoryState: DirectoryState;
  expectedDirectoryGeneration?: number;
}

const DIRECTORY_LOOKUP_MS = 8;
const SAME_REGION_HOP_MS = 2;

const INTER_REGION_RTT_MS: Record<
  GlobalRegionId,
  Record<GlobalRegionId, number>
> = {
  "eu-central": {
    "eu-central": SAME_REGION_HOP_MS,
    "us-east": 74,
    "ap-southeast": 150,
  },
  "us-east": {
    "eu-central": 74,
    "us-east": SAME_REGION_HOP_MS,
    "ap-southeast": 183,
  },
  "ap-southeast": {
    "eu-central": 150,
    "us-east": 183,
    "ap-southeast": SAME_REGION_HOP_MS,
  },
};

function clientSite(siteId: ClientSiteId) {
  const site = CLIENT_SITES.find((candidate) => candidate.id === siteId);
  if (!site) {
    throw new Error(`unknown client site: ${siteId}`);
  }
  return site;
}

function uniqueSites(
  creatorSiteId: ClientSiteId,
  playerSiteIds: readonly ClientSiteId[],
): ClientSiteId[] {
  return [...new Set([creatorSiteId, ...playerSiteIds])];
}

function scoreRegion(
  regionId: GlobalRegionId,
  participantSites: readonly ClientSiteId[],
  policy: RoomPlacementPolicy,
): number {
  const rtts = participantSites.map(
    (siteId) => clientSite(siteId).baseRttMs[regionId],
  );

  switch (policy) {
    case "min-average-rtt":
      return rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length;
    case "min-worst-rtt":
      return Math.max(...rtts);
    default:
      return 0;
  }
}

export function placeRoom(
  policy: RoomPlacementPolicy,
  creatorSiteId: ClientSiteId,
  playerSiteIds: readonly ClientSiteId[],
  fixedRegionId: GlobalRegionId,
): RoomPlacementResult {
  const participantSites = uniqueSites(creatorSiteId, playerSiteIds);

  if (policy === "fixed-region") {
    return {
      regionId: fixedRegionId,
      policy,
      participantSites,
      scores: GLOBAL_REGIONS.map((region) => ({
        regionId: region.id,
        scoreMs: region.id === fixedRegionId ? 0 : Number.POSITIVE_INFINITY,
      })),
    };
  }

  if (policy === "creator-nearest") {
    const creator = clientSite(creatorSiteId);
    const scores = GLOBAL_REGIONS.map((region) => ({
      regionId: region.id,
      scoreMs: creator.baseRttMs[region.id],
    }));
    const winner = scores.reduce((best, candidate) =>
      candidate.scoreMs < best.scoreMs ? candidate : best,
    );
    return {
      regionId: winner.regionId,
      policy,
      participantSites,
      scores,
    };
  }

  const scores = GLOBAL_REGIONS.map((region) => ({
    regionId: region.id,
    scoreMs: scoreRegion(region.id, participantSites, policy),
  }));
  const winner = scores.reduce((best, candidate) =>
    candidate.scoreMs < best.scoreMs ? candidate : best,
  );

  return {
    regionId: winner.regionId,
    policy,
    participantSites,
    scores,
  };
}

export function resolveRoomDirectory(
  entry: RoomDirectoryEntry,
  state: DirectoryState,
  expectedGeneration: number,
): DirectoryResolution {
  if (state === "unavailable") {
    return {
      state,
      resolvedRegionId: null,
      reason: "The global room directory is unavailable; joining fails closed.",
    };
  }

  if (state === "stale" || entry.generation !== expectedGeneration) {
    return {
      state: "stale",
      resolvedRegionId: null,
      reason:
        "The directory entry is stale or has an unexpected generation; joining fails closed instead of guessing room authority.",
    };
  }

  return {
    state: "fresh",
    resolvedRegionId: entry.regionId,
    reason: `Directory generation ${entry.generation} resolves the room to ${entry.regionId}.`,
  };
}

function sumSteps(steps: readonly JoinPathStep[]): number {
  return steps.reduce((sum, step) => sum + step.latencyMs, 0);
}

export function compareJoinPaths(
  siteId: ClientSiteId,
  ingressRegionId: GlobalRegionId,
  ownerRegionId: GlobalRegionId,
): JoinPathCost[] {
  const site = clientSite(siteId);
  const toIngressMs = site.baseRttMs[ingressRegionId];
  const toOwnerMs = site.baseRttMs[ownerRegionId];
  const interRegionMs = INTER_REGION_RTT_MS[ingressRegionId][ownerRegionId];

  const redirectSteps: JoinPathStep[] =
    ingressRegionId === ownerRegionId
      ? [{ label: "client ↔ owner ingress", latencyMs: toOwnerMs }]
      : [
          { label: "client ↔ first ingress", latencyMs: toIngressMs },
          { label: "client ↔ redirected room owner", latencyMs: toOwnerMs },
        ];

  const proxySteps: JoinPathStep[] = [
    { label: "client ↔ ingress", latencyMs: toIngressMs },
    ...(ingressRegionId === ownerRegionId
      ? []
      : [
          {
            label: "ingress ↔ room owner region",
            latencyMs: interRegionMs,
          },
        ]),
  ];

  const directorySteps: JoinPathStep[] = [
    { label: "global directory lookup", latencyMs: DIRECTORY_LOOKUP_MS },
    { label: "client ↔ room owner", latencyMs: toOwnerMs },
  ];

  return [
    {
      path: "redirect",
      totalLatencyMs: sumSteps(redirectSteps),
      clientFacingRoundTrips: redirectSteps.length,
      interRegionHops: 0,
      steps: redirectSteps,
    },
    {
      path: "proxy",
      totalLatencyMs: sumSteps(proxySteps),
      clientFacingRoundTrips: 1,
      interRegionHops: ingressRegionId === ownerRegionId ? 0 : 1,
      steps: proxySteps,
    },
    {
      path: "directory",
      totalLatencyMs: sumSteps(directorySteps),
      clientFacingRoundTrips: 1,
      interRegionHops: 0,
      steps: directorySteps,
    },
  ];
}

export function simulateRoomAuthority(
  input: RoomAuthoritySimulationInput,
): RoomAuthoritySimulation {
  const placement = placeRoom(
    input.placementPolicy,
    input.creatorSiteId,
    input.playerSiteIds,
    input.fixedRegionId,
  );
  const directoryEntry: RoomDirectoryEntry = {
    roomId: input.roomId,
    regionId: placement.regionId,
    generation: 1,
  };
  const expectedGeneration = input.expectedDirectoryGeneration ?? 1;

  const clients = input.clientIngresses.map((client) => {
    const directory = resolveRoomDirectory(
      directoryEntry,
      input.directoryState,
      expectedGeneration,
    );
    const resolvedOwnerRegionId = directory.resolvedRegionId;
    return {
      siteId: client.siteId,
      ingressRegionId: client.ingressRegionId,
      directory,
      resolvedOwnerRegionId,
      convergedOnOwner: resolvedOwnerRegionId === placement.regionId,
      pathCosts: compareJoinPaths(
        client.siteId,
        client.ingressRegionId,
        placement.regionId,
      ),
    };
  });

  return {
    roomId: input.roomId,
    placement,
    directoryEntry,
    clients,
    converged:
      clients.length > 0 && clients.every((client) => client.convergedOnOwner),
  };
}
