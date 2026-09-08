import { GLOBAL_REGIONS, type GlobalRegionId } from "./global-ingress";
import {
  simulateElection,
  type ElectionEvent,
  type FailureWindow,
} from "./recovery";

export type DirectoryAuthorityRecoveryInput = {
  initialLeaderRegionId: GlobalRegionId;
  failure: FailureWindow;
  initialTerm: number;
  heartbeatIntervalMs: number;
  electionTimeoutMs: number;
  electionDurationMs: number;
};

export type DirectoryAuthorityRecoveryResult = {
  events: ElectionEvent[];
  quorumSize: number;
  electionSucceeded: boolean;
  detectionAtMs: number | null;
  failoverCompleteMs: number | null;
  recoveryWindowMs: number | null;
  finalLeaderRegionId: GlobalRegionId | null;
  finalTerm: number;
  staleWritesFenced: number;
};

function asGlobalRegionId(regionId: string | null): GlobalRegionId | null {
  if (regionId === null) {
    return null;
  }
  const known = GLOBAL_REGIONS.some((region) => region.id === regionId);
  if (!known) {
    throw new Error(`directory election returned unknown region: ${regionId}`);
  }
  return regionId as GlobalRegionId;
}

export function simulateDirectoryAuthorityRecovery(
  input: DirectoryAuthorityRecoveryInput,
): DirectoryAuthorityRecoveryResult {
  const election = simulateElection({
    nodes: GLOBAL_REGIONS.map((region) => ({
      id: region.id,
      failures:
        region.id === input.initialLeaderRegionId ? [input.failure] : undefined,
    })),
    initialLeaderId: input.initialLeaderRegionId,
    initialTerm: input.initialTerm,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    electionTimeoutMs: input.electionTimeoutMs,
    electionDurationMs: input.electionDurationMs,
  });

  return {
    events: election.events,
    quorumSize: election.quorumSize,
    electionSucceeded: election.electionSucceeded,
    detectionAtMs: election.detectionAtMs,
    failoverCompleteMs: election.leaderElectedAtMs,
    recoveryWindowMs: election.leaderUnavailableMs,
    finalLeaderRegionId: asGlobalRegionId(election.finalLeaderId),
    finalTerm: election.finalTerm,
    staleWritesFenced: election.fencedStaleWrites,
  };
}
