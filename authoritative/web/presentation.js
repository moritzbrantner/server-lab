export const AUTHORITATIVE_TICK_MS = 50;
export const AUTHORITATIVE_STEP_UNITS = 64;
export const AUTHORITATIVE_WORLD_LIMIT = 10_000;
export const DEFAULT_MAX_LOCAL_PREDICTION_TICKS = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clonePlayer(player) {
  return {
    playerId: player.playerId,
    x: player.x,
    y: player.y,
    lastAppliedSequence: player.lastAppliedSequence,
  };
}

function snapshotPlayers(snapshot) {
  return new Map(snapshot.players.map((player) => [player.playerId, player]));
}

export function pruneAcknowledgedInputs(inputs, lastAppliedSequence) {
  return inputs.filter((input) => input.sequence > lastAppliedSequence);
}

export function predictLocalPlayer(
  player,
  intent,
  elapsedMs,
  { maxPredictionTicks = DEFAULT_MAX_LOCAL_PREDICTION_TICKS } = {},
) {
  const predictedTicks = clamp(elapsedMs / AUTHORITATIVE_TICK_MS, 0, maxPredictionTicks);
  return {
    ...clonePlayer(player),
    x: clamp(
      player.x + intent.horizontal * AUTHORITATIVE_STEP_UNITS * predictedTicks,
      -AUTHORITATIVE_WORLD_LIMIT,
      AUTHORITATIVE_WORLD_LIMIT,
    ),
    y: clamp(
      player.y + intent.vertical * AUTHORITATIVE_STEP_UNITS * predictedTicks,
      -AUTHORITATIVE_WORLD_LIMIT,
      AUTHORITATIVE_WORLD_LIMIT,
    ),
    predicted: predictedTicks > 0 && (intent.horizontal !== 0 || intent.vertical !== 0),
  };
}

export function interpolateRemotePlayer(previous, current, alpha) {
  const boundedAlpha = clamp(alpha, 0, 1);
  return {
    ...clonePlayer(current),
    x: previous.x + (current.x - previous.x) * boundedAlpha,
    y: previous.y + (current.y - previous.y) * boundedAlpha,
    interpolated: boundedAlpha < 1,
  };
}

export class PresentationTimeline {
  constructor({ localPlayerId, maxPredictionTicks = DEFAULT_MAX_LOCAL_PREDICTION_TICKS } = {}) {
    if (!Number.isSafeInteger(localPlayerId) || localPlayerId < 1) {
      throw new Error("localPlayerId must be a positive safe integer");
    }
    if (!Number.isFinite(maxPredictionTicks) || maxPredictionTicks < 0) {
      throw new Error("maxPredictionTicks must be a non-negative finite number");
    }
    this.localPlayerId = localPlayerId;
    this.maxPredictionTicks = maxPredictionTicks;
    this.previous = null;
    this.current = null;
    this.pendingInputs = [];
  }

  recordInput(input) {
    if (!Number.isSafeInteger(input?.sequence) || input.sequence < 1) {
      throw new Error("input sequence must be a positive safe integer");
    }
    if (![-1, 0, 1].includes(input.horizontal) || ![-1, 0, 1].includes(input.vertical)) {
      throw new Error("input axes must be -1, 0, or 1");
    }
    const lastSequence = this.pendingInputs.at(-1)?.sequence ?? 0;
    if (input.sequence <= lastSequence) return false;
    this.pendingInputs.push({ ...input });
    return true;
  }

  acceptSnapshot(snapshot, receivedAtMs) {
    if (!snapshot || !Array.isArray(snapshot.players)) throw new Error("snapshot players are required");
    if (!Number.isFinite(receivedAtMs)) throw new Error("receivedAtMs must be finite");
    if (this.current && snapshot.tick <= this.current.snapshot.tick) return false;

    this.previous = this.current;
    this.current = {
      snapshot,
      receivedAtMs,
      players: snapshotPlayers(snapshot),
    };
    const local = this.current.players.get(this.localPlayerId);
    if (local) {
      this.pendingInputs = pruneAcknowledgedInputs(
        this.pendingInputs,
        local.lastAppliedSequence,
      );
    }
    return true;
  }

  latestSnapshot() {
    return this.current?.snapshot ?? null;
  }

  pendingInputSequences() {
    return this.pendingInputs.map((input) => input.sequence);
  }

  present(nowMs, intent = { horizontal: 0, vertical: 0 }) {
    if (!this.current) return null;
    if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite");
    const elapsedMs = Math.max(0, nowMs - this.current.receivedAtMs);
    const interpolationAlpha = elapsedMs / AUTHORITATIVE_TICK_MS;
    const previousPlayers = this.previous?.players ?? new Map();

    const players = this.current.snapshot.players.map((player) => {
      if (player.playerId === this.localPlayerId) {
        return predictLocalPlayer(player, intent, elapsedMs, {
          maxPredictionTicks: this.maxPredictionTicks,
        });
      }
      const previous = previousPlayers.get(player.playerId);
      return previous
        ? interpolateRemotePlayer(previous, player, interpolationAlpha)
        : { ...clonePlayer(player), interpolated: false };
    });

    return {
      canonicalTick: this.current.snapshot.tick,
      canonicalStateHash: this.current.snapshot.stateHash,
      players,
      pendingInputSequences: this.pendingInputSequences(),
    };
  }
}
