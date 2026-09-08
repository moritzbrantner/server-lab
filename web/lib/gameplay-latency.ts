import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  type ClientSiteId,
  type GlobalRegionId,
} from "./global-ingress";

export type GameplayTopology = "full-mesh" | "host-spoke";
export type ConnectivityMode = "direct" | "turn-fallback";

export interface GameplayLatencyInput {
  playerSiteIds: readonly ClientSiteId[];
  signalingRegionId: GlobalRegionId;
  topology: GameplayTopology;
  hostSiteId: ClientSiteId;
  connectivityMode: ConnectivityMode;
  turnRegionId: GlobalRegionId;
}

export interface SetupPhase {
  id: "room" | "websocket" | "ice";
  label: string;
  latencyMs: number;
  explanation: string;
}

export interface GameplayEdge {
  leftSiteId: ClientSiteId;
  rightSiteId: ClientSiteId;
  path: "direct" | "turn";
  rttMs: number;
  viaRegionId: GlobalRegionId | null;
}

export interface GameplayLatencyResult {
  input: GameplayLatencyInput;
  phases: SetupPhase[];
  totalSetupLatencyMs: number;
  gameplayEdges: GameplayEdge[];
  meanGameplayRttMs: number;
  worstGameplayRttMs: number;
}

export interface SignalingRegionComparison {
  signalingRegionId: GlobalRegionId;
  setupLatencyMs: number;
  meanGameplayRttMs: number;
  worstGameplayRttMs: number;
}

const ROOM_SERVICE_MS = 12;
const WEBSOCKET_SERVICE_MS = 8;
const DIRECT_ICE_BASE_MS = 35;
const DIRECT_ATTEMPT_TIMEOUT_MS = 120;
const TURN_ALLOCATION_MS = 18;

const DIRECT_PEER_RTT_MS: Record<ClientSiteId, Record<ClientSiteId, number>> = {
  frankfurt: { frankfurt: 0, virginia: 86, singapore: 158 },
  virginia: { frankfurt: 86, virginia: 0, singapore: 196 },
  singapore: { frankfurt: 158, virginia: 196, singapore: 0 },
};

function site(siteId: ClientSiteId) {
  const found = CLIENT_SITES.find((candidate) => candidate.id === siteId);
  if (!found) throw new Error(`unknown client site: ${siteId}`);
  return found;
}

function uniquePlayers(playerSiteIds: readonly ClientSiteId[]): ClientSiteId[] {
  const players = [...new Set(playerSiteIds)];
  if (players.length < 2) throw new Error("gameplay latency requires at least two distinct players");
  return players;
}

function signalingRtts(players: readonly ClientSiteId[], regionId: GlobalRegionId): number[] {
  return players.map((siteId) => site(siteId).baseRttMs[regionId]);
}

function directEdgeRtt(left: ClientSiteId, right: ClientSiteId): number {
  return DIRECT_PEER_RTT_MS[left][right];
}

function turnEdgeRtt(left: ClientSiteId, right: ClientSiteId, regionId: GlobalRegionId): number {
  return site(left).baseRttMs[regionId] + site(right).baseRttMs[regionId];
}

function topologyPairs(
  players: readonly ClientSiteId[],
  topology: GameplayTopology,
  hostSiteId: ClientSiteId,
): Array<[ClientSiteId, ClientSiteId]> {
  if (topology === "host-spoke") {
    if (!players.includes(hostSiteId)) throw new Error("host must be one of the participating players");
    return players.filter((player) => player !== hostSiteId).map((player) => [hostSiteId, player]);
  }

  const pairs: Array<[ClientSiteId, ClientSiteId]> = [];
  for (let left = 0; left < players.length; left += 1) {
    for (let right = left + 1; right < players.length; right += 1) {
      pairs.push([players[left], players[right]]);
    }
  }
  return pairs;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function simulateGameplayLatency(input: GameplayLatencyInput): GameplayLatencyResult {
  const players = uniquePlayers(input.playerSiteIds);
  const signaling = signalingRtts(players, input.signalingRegionId);
  const worstSignalingRtt = Math.max(...signaling);
  const pairs = topologyPairs(players, input.topology, input.hostSiteId);

  const gameplayEdges = pairs.map(([leftSiteId, rightSiteId]): GameplayEdge => {
    if (input.connectivityMode === "turn-fallback") {
      return {
        leftSiteId,
        rightSiteId,
        path: "turn",
        rttMs: turnEdgeRtt(leftSiteId, rightSiteId, input.turnRegionId),
        viaRegionId: input.turnRegionId,
      };
    }
    return {
      leftSiteId,
      rightSiteId,
      path: "direct",
      rttMs: directEdgeRtt(leftSiteId, rightSiteId),
      viaRegionId: null,
    };
  });

  const edgeRtts = gameplayEdges.map((edge) => edge.rttMs);
  const worstDirectPeerRtt = Math.max(...pairs.map(([left, right]) => directEdgeRtt(left, right)));
  const worstTurnAccessRtt = Math.max(...players.map((siteId) => site(siteId).baseRttMs[input.turnRegionId]));

  const phases: SetupPhase[] = [
    {
      id: "room",
      label: "Room create / join",
      latencyMs: worstSignalingRtt + ROOM_SERVICE_MS,
      explanation: "The slowest participant reaches the selected signaling region and the room service performs a bounded modeled operation.",
    },
    {
      id: "websocket",
      label: "WebSocket signaling",
      latencyMs: worstSignalingRtt * 2 + WEBSOCKET_SERVICE_MS,
      explanation: "Two modeled control-plane exchanges traverse the signaling region before peers have enough offer/answer and candidate state.",
    },
    input.connectivityMode === "direct"
      ? {
          id: "ice",
          label: "ICE negotiation",
          latencyMs: DIRECT_ICE_BASE_MS + worstDirectPeerRtt,
          explanation: "Direct ICE pays a fixed modeled negotiation cost plus the slowest required peer path; the signaling region is no longer on that peer path.",
        }
      : {
          id: "ice",
          label: "Direct ICE attempt + TURN fallback",
          latencyMs: DIRECT_ATTEMPT_TIMEOUT_MS + TURN_ALLOCATION_MS + worstTurnAccessRtt,
          explanation: "Direct-first ICE exhausts a bounded modeled attempt before allocating the selected regional TURN relay.",
        },
  ];

  return {
    input: { ...input, playerSiteIds: players },
    phases,
    totalSetupLatencyMs: phases.reduce((sum, phase) => sum + phase.latencyMs, 0),
    gameplayEdges,
    meanGameplayRttMs: mean(edgeRtts),
    worstGameplayRttMs: Math.max(...edgeRtts),
  };
}

export function compareSignalingRegions(
  input: Omit<GameplayLatencyInput, "signalingRegionId">,
): SignalingRegionComparison[] {
  return GLOBAL_REGIONS.map((region) => {
    const result = simulateGameplayLatency({ ...input, signalingRegionId: region.id });
    return {
      signalingRegionId: region.id,
      setupLatencyMs: result.totalSetupLatencyMs,
      meanGameplayRttMs: result.meanGameplayRttMs,
      worstGameplayRttMs: result.worstGameplayRttMs,
    };
  });
}
