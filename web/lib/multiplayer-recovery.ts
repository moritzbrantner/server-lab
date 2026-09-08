import type { GlobalRegionId } from "./global-ingress";

export type MultiplayerSessionLifecycle = "establishing" | "established";
export type RegionalServiceState = "available" | "failed" | "partitioned";

export type MultiplayerFailureInput = {
  lifecycle: MultiplayerSessionLifecycle;
  signalingRegionId: GlobalRegionId;
  signalingStateByRegion: Partial<Record<GlobalRegionId, RegionalServiceState>>;
  directoryState: RegionalServiceState;
};

export type MultiplayerFailureBlocker = {
  service: "directory" | "signaling";
  state: Exclude<RegionalServiceState, "available">;
  regionId: GlobalRegionId | null;
};

export type MultiplayerFailureResult = {
  lifecycle: MultiplayerSessionLifecycle;
  directoryAvailable: boolean;
  signalingAvailable: boolean;
  controlPlaneAvailable: boolean;
  setupAvailable: boolean;
  gameplayAvailable: boolean;
  requiresControlPlane: boolean;
  blockers: MultiplayerFailureBlocker[];
  explanation: string;
};

function isAvailable(state: RegionalServiceState): boolean {
  return state === "available";
}

function signalingState(
  input: MultiplayerFailureInput,
): RegionalServiceState {
  return input.signalingStateByRegion[input.signalingRegionId] ?? "available";
}

export function simulateMultiplayerFailure(
  input: MultiplayerFailureInput,
): MultiplayerFailureResult {
  const selectedSignalingState = signalingState(input);
  const directoryAvailable = isAvailable(input.directoryState);
  const signalingAvailable = isAvailable(selectedSignalingState);
  const controlPlaneAvailable = directoryAvailable && signalingAvailable;
  const requiresControlPlane = input.lifecycle === "establishing";
  const blockers: MultiplayerFailureBlocker[] = [];

  if (!directoryAvailable) {
    blockers.push({
      service: "directory",
      state: input.directoryState as Exclude<RegionalServiceState, "available">,
      regionId: null,
    });
  }
  if (!signalingAvailable) {
    blockers.push({
      service: "signaling",
      state: selectedSignalingState as Exclude<RegionalServiceState, "available">,
      regionId: input.signalingRegionId,
    });
  }

  if (input.lifecycle === "established") {
    return {
      lifecycle: input.lifecycle,
      directoryAvailable,
      signalingAvailable,
      controlPlaneAvailable,
      setupAvailable: controlPlaneAvailable,
      gameplayAvailable: true,
      requiresControlPlane,
      blockers,
      explanation: controlPlaneAvailable
        ? "The direct peer DataChannel is established; healthy control-plane services remain available but are not on the gameplay path."
        : "The established direct peer DataChannel keeps carrying gameplay even though room lookup or signaling is unavailable.",
    };
  }

  return {
    lifecycle: input.lifecycle,
    directoryAvailable,
    signalingAvailable,
    controlPlaneAvailable,
    setupAvailable: controlPlaneAvailable,
    gameplayAvailable: false,
    requiresControlPlane,
    blockers,
    explanation: controlPlaneAvailable
      ? "Room lookup and signaling are available, so WebRTC establishment may proceed."
      : "WebRTC establishment is blocked because its required control-plane path is unavailable.",
  };
}
