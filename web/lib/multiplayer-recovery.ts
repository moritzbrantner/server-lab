import type { GlobalRegionId } from "./global-ingress";

export type MultiplayerSessionLifecycle = "establishing" | "established" | "recovering";
export type MultiplayerRecoveryKind = "ice-restart" | "rejoin";
export type RegionalServiceState = "available" | "failed" | "partitioned";
export type MultiplayerControlPlaneService = "directory" | "signaling";

export type MultiplayerFailureInput = {
  lifecycle: MultiplayerSessionLifecycle;
  signalingRegionId: GlobalRegionId;
  signalingStateByRegion: Partial<Record<GlobalRegionId, RegionalServiceState>>;
  directoryState: RegionalServiceState;
  recoveryKind?: MultiplayerRecoveryKind;
};

export type MultiplayerFailureBlocker = {
  service: MultiplayerControlPlaneService;
  state: Exclude<RegionalServiceState, "available">;
  regionId: GlobalRegionId | null;
};

export type MultiplayerFailureResult = {
  lifecycle: MultiplayerSessionLifecycle;
  recoveryKind: MultiplayerRecoveryKind | null;
  directoryAvailable: boolean;
  signalingAvailable: boolean;
  controlPlaneAvailable: boolean;
  setupAvailable: boolean;
  operationAvailable: boolean;
  recoveryAvailable: boolean | null;
  gameplayAvailable: boolean;
  requiresControlPlane: boolean;
  requiredControlPlane: MultiplayerControlPlaneService[];
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

function requiredControlPlane(
  input: MultiplayerFailureInput,
): MultiplayerControlPlaneService[] {
  if (input.lifecycle === "establishing") {
    return ["directory", "signaling"];
  }
  if (input.lifecycle === "established") {
    return [];
  }
  if (input.recoveryKind === "ice-restart") {
    return ["signaling"];
  }
  return ["directory", "signaling"];
}

function validateInput(input: MultiplayerFailureInput): void {
  if (input.lifecycle === "recovering" && input.recoveryKind === undefined) {
    throw new Error("recovering sessions require an explicit recovery kind");
  }
  if (input.lifecycle !== "recovering" && input.recoveryKind !== undefined) {
    throw new Error("recovery kind is valid only while recovering");
  }
}

export function simulateMultiplayerFailure(
  input: MultiplayerFailureInput,
): MultiplayerFailureResult {
  validateInput(input);

  const selectedSignalingState = signalingState(input);
  const directoryAvailable = isAvailable(input.directoryState);
  const signalingAvailable = isAvailable(selectedSignalingState);
  const controlPlaneAvailable = directoryAvailable && signalingAvailable;
  const required = requiredControlPlane(input);
  const requiresControlPlane = required.length > 0;
  const blockers: MultiplayerFailureBlocker[] = [];

  if (input.directoryState !== "available") {
    blockers.push({
      service: "directory",
      state: input.directoryState,
      regionId: null,
    });
  }
  if (selectedSignalingState !== "available") {
    blockers.push({
      service: "signaling",
      state: selectedSignalingState,
      regionId: input.signalingRegionId,
    });
  }

  const operationAvailable = required.every((service) =>
    service === "directory" ? directoryAvailable : signalingAvailable,
  );

  if (input.lifecycle === "established") {
    return {
      lifecycle: input.lifecycle,
      recoveryKind: null,
      directoryAvailable,
      signalingAvailable,
      controlPlaneAvailable,
      setupAvailable: controlPlaneAvailable,
      operationAvailable: true,
      recoveryAvailable: null,
      gameplayAvailable: true,
      requiresControlPlane,
      requiredControlPlane: required,
      blockers,
      explanation: controlPlaneAvailable
        ? "The direct peer DataChannel is established; healthy control-plane services remain available but are not on the gameplay path."
        : "The established direct peer DataChannel keeps carrying gameplay even though room lookup or signaling is unavailable.",
    };
  }

  if (input.lifecycle === "recovering") {
    const isIceRestart = input.recoveryKind === "ice-restart";
    return {
      lifecycle: input.lifecycle,
      recoveryKind: input.recoveryKind ?? null,
      directoryAvailable,
      signalingAvailable,
      controlPlaneAvailable,
      setupAvailable: operationAvailable,
      operationAvailable,
      recoveryAvailable: operationAvailable,
      gameplayAvailable: false,
      requiresControlPlane,
      requiredControlPlane: required,
      blockers,
      explanation: operationAvailable
        ? isIceRestart
          ? "The lost DataChannel can attempt an ICE restart because signaling is available; directory lookup is not required for this modeled restart."
          : "The disconnected peer can rejoin because both room lookup and signaling are available."
        : isIceRestart
          ? "ICE restart is blocked because signaling is unavailable again when the gameplay path needs renegotiation."
          : "Rejoin is blocked because room lookup or signaling is unavailable.",
    };
  }

  return {
    lifecycle: input.lifecycle,
    recoveryKind: null,
    directoryAvailable,
    signalingAvailable,
    controlPlaneAvailable,
    setupAvailable: operationAvailable,
    operationAvailable,
    recoveryAvailable: null,
    gameplayAvailable: false,
    requiresControlPlane,
    requiredControlPlane: required,
    blockers,
    explanation: operationAvailable
      ? "Room lookup and signaling are available, so WebRTC establishment may proceed."
      : "WebRTC establishment is blocked because its required control-plane path is unavailable.",
  };
}
