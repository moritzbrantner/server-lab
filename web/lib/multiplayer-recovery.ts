import type { GlobalRegionId } from "./global-ingress";

export type MultiplayerSessionLifecycle = "establishing" | "established" | "recovering";
export type MultiplayerRecoveryKind = "ice-restart" | "rejoin" | "turn-reallocate";
export type RegionalServiceState = "available" | "failed" | "partitioned";
export type MultiplayerControlPlaneService = "directory" | "signaling";
export type MultiplayerService = MultiplayerControlPlaneService | "turn";
export type MultiplayerGameplayPath = "direct" | "turn";

export type MultiplayerFailureInput = {
  lifecycle: MultiplayerSessionLifecycle;
  signalingRegionId: GlobalRegionId;
  signalingStateByRegion: Partial<Record<GlobalRegionId, RegionalServiceState>>;
  directoryState: RegionalServiceState;
  recoveryKind?: MultiplayerRecoveryKind;
  gameplayPath?: MultiplayerGameplayPath;
  turnRegionId?: GlobalRegionId;
  turnStateByRegion?: Partial<Record<GlobalRegionId, RegionalServiceState>>;
  replacementTurnRegionId?: GlobalRegionId;
};

export type MultiplayerFailureBlocker = {
  service: MultiplayerService;
  state: Exclude<RegionalServiceState, "available">;
  regionId: GlobalRegionId | null;
};

export type MultiplayerFailureResult = {
  lifecycle: MultiplayerSessionLifecycle;
  recoveryKind: MultiplayerRecoveryKind | null;
  gameplayPath: MultiplayerGameplayPath;
  directoryAvailable: boolean;
  signalingAvailable: boolean;
  controlPlaneAvailable: boolean;
  turnRegionId: GlobalRegionId | null;
  turnAvailable: boolean | null;
  replacementTurnRegionId: GlobalRegionId | null;
  replacementTurnAvailable: boolean | null;
  setupAvailable: boolean;
  operationAvailable: boolean;
  recoveryAvailable: boolean | null;
  recoveryRequired: boolean;
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

function turnState(
  input: MultiplayerFailureInput,
  regionId: GlobalRegionId,
): RegionalServiceState {
  return input.turnStateByRegion?.[regionId] ?? "available";
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
  if (input.recoveryKind === "rejoin") {
    return ["directory", "signaling"];
  }
  return ["signaling"];
}

function validateInput(input: MultiplayerFailureInput): void {
  if (input.lifecycle === "recovering" && input.recoveryKind === undefined) {
    throw new Error("recovering sessions require an explicit recovery kind");
  }
  if (input.lifecycle !== "recovering" && input.recoveryKind !== undefined) {
    throw new Error("recovery kind is valid only while recovering");
  }

  const gameplayPath = input.gameplayPath ?? "direct";
  if (gameplayPath === "turn" && input.turnRegionId === undefined) {
    throw new Error("TURN gameplay paths require the active relay region");
  }
  if (gameplayPath === "direct" && input.turnRegionId !== undefined) {
    throw new Error("direct gameplay paths cannot name an active TURN relay");
  }

  if (input.recoveryKind === "turn-reallocate") {
    if (gameplayPath !== "turn") {
      throw new Error("TURN reallocation requires an existing relayed gameplay path");
    }
    if (input.replacementTurnRegionId === undefined) {
      throw new Error("TURN reallocation requires an explicit replacement relay region");
    }
  } else if (input.replacementTurnRegionId !== undefined) {
    throw new Error("replacement TURN region is valid only for TURN reallocation");
  }
}

export function simulateMultiplayerFailure(
  input: MultiplayerFailureInput,
): MultiplayerFailureResult {
  validateInput(input);

  const gameplayPath = input.gameplayPath ?? "direct";
  const selectedSignalingState = signalingState(input);
  const directoryAvailable = isAvailable(input.directoryState);
  const signalingAvailable = isAvailable(selectedSignalingState);
  const controlPlaneAvailable = directoryAvailable && signalingAvailable;
  const required = requiredControlPlane(input);
  const requiresControlPlane = required.length > 0;
  const currentTurnState = gameplayPath === "turn" ? turnState(input, input.turnRegionId!) : null;
  const turnAvailable = currentTurnState === null ? null : isAvailable(currentTurnState);
  const replacementTurnState =
    input.replacementTurnRegionId === undefined
      ? null
      : turnState(input, input.replacementTurnRegionId);
  const replacementTurnAvailable =
    replacementTurnState === null ? null : isAvailable(replacementTurnState);
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
  if (gameplayPath === "turn" && currentTurnState !== null && currentTurnState !== "available") {
    blockers.push({
      service: "turn",
      state: currentTurnState,
      regionId: input.turnRegionId!,
    });
  }
  if (replacementTurnState !== null && replacementTurnState !== "available") {
    blockers.push({
      service: "turn",
      state: replacementTurnState,
      regionId: input.replacementTurnRegionId!,
    });
  }

  const requiredControlPlaneAvailable = required.every((service) =>
    service === "directory" ? directoryAvailable : signalingAvailable,
  );
  const setupDataPathAvailable = gameplayPath === "direct" || turnAvailable === true;
  const recoveryDataPathAvailable =
    input.recoveryKind !== "turn-reallocate" || replacementTurnAvailable === true;
  const operationAvailable =
    input.lifecycle === "establishing"
      ? requiredControlPlaneAvailable && setupDataPathAvailable
      : input.lifecycle === "recovering"
        ? requiredControlPlaneAvailable && recoveryDataPathAvailable
        : gameplayPath === "direct" || turnAvailable === true;
  const gameplayAvailable =
    input.lifecycle === "established" && (gameplayPath === "direct" || turnAvailable === true);
  const recoveryRequired = input.lifecycle === "established" && !gameplayAvailable;

  if (input.lifecycle === "established") {
    let explanation: string;
    if (gameplayPath === "turn" && !gameplayAvailable) {
      explanation = `The established relayed gameplay path is unavailable because TURN in ${input.turnRegionId} is unavailable; signaling health alone cannot keep that data path alive.`;
    } else if (gameplayPath === "turn") {
      explanation = `The established gameplay path is relayed through TURN in ${input.turnRegionId}; directory and signaling are not carrying the gameplay packets.`;
    } else {
      explanation = controlPlaneAvailable
        ? "The direct peer DataChannel is established; healthy control-plane services remain available but are not on the gameplay path."
        : "The established direct peer DataChannel keeps carrying gameplay even though room lookup or signaling is unavailable.";
    }

    return {
      lifecycle: input.lifecycle,
      recoveryKind: null,
      gameplayPath,
      directoryAvailable,
      signalingAvailable,
      controlPlaneAvailable,
      turnRegionId: input.turnRegionId ?? null,
      turnAvailable,
      replacementTurnRegionId: null,
      replacementTurnAvailable: null,
      setupAvailable: controlPlaneAvailable,
      operationAvailable,
      recoveryAvailable: null,
      recoveryRequired,
      gameplayAvailable,
      requiresControlPlane,
      requiredControlPlane: required,
      blockers,
      explanation,
    };
  }

  if (input.lifecycle === "recovering") {
    const isIceRestart = input.recoveryKind === "ice-restart";
    const isTurnReallocate = input.recoveryKind === "turn-reallocate";
    let explanation: string;
    if (isTurnReallocate) {
      explanation = operationAvailable
        ? `The failed relay is replaced only through an explicit ICE recovery operation using TURN in ${input.replacementTurnRegionId}.`
        : "TURN reallocation is blocked until signaling and the explicitly selected replacement relay are both available.";
    } else if (isIceRestart) {
      explanation = operationAvailable
        ? "The lost DataChannel can attempt an ICE restart because signaling is available; directory lookup is not required for this modeled restart."
        : "ICE restart is blocked because signaling is unavailable again when the gameplay path needs renegotiation.";
    } else {
      explanation = operationAvailable
        ? "The disconnected peer can rejoin because both room lookup and signaling are available."
        : "Rejoin is blocked because room lookup or signaling is unavailable.";
    }

    return {
      lifecycle: input.lifecycle,
      recoveryKind: input.recoveryKind ?? null,
      gameplayPath,
      directoryAvailable,
      signalingAvailable,
      controlPlaneAvailable,
      turnRegionId: input.turnRegionId ?? null,
      turnAvailable,
      replacementTurnRegionId: input.replacementTurnRegionId ?? null,
      replacementTurnAvailable,
      setupAvailable: operationAvailable,
      operationAvailable,
      recoveryAvailable: operationAvailable,
      recoveryRequired: true,
      gameplayAvailable: false,
      requiresControlPlane,
      requiredControlPlane: required,
      blockers,
      explanation,
    };
  }

  const explanation = !requiredControlPlaneAvailable
    ? "WebRTC establishment is blocked because its required control-plane path is unavailable."
    : !setupDataPathAvailable
      ? `WebRTC establishment cannot complete because the selected TURN relay in ${input.turnRegionId} is unavailable.`
      : "Room lookup and signaling are available, so WebRTC establishment may proceed.";

  return {
    lifecycle: input.lifecycle,
    recoveryKind: null,
    gameplayPath,
    directoryAvailable,
    signalingAvailable,
    controlPlaneAvailable,
    turnRegionId: input.turnRegionId ?? null,
    turnAvailable,
    replacementTurnRegionId: null,
    replacementTurnAvailable: null,
    setupAvailable: operationAvailable,
    operationAvailable,
    recoveryAvailable: null,
    recoveryRequired: false,
    gameplayAvailable: false,
    requiresControlPlane,
    requiredControlPlane: required,
    blockers,
    explanation,
  };
}
