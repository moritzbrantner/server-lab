import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  AUTHORITATIVE_STEP_UNITS,
  AUTHORITATIVE_TICK_MS,
  AUTHORITATIVE_WORLD_LIMIT,
  PresentationTimeline,
  interpolateRemotePlayer,
  predictLocalPlayer,
  pruneAcknowledgedInputs,
} from "../web/presentation.js";

function snapshot(tick, players, stateHash = BigInt(tick)) {
  return { tick: BigInt(tick), stateHash, players };
}

function player(playerId, x, y, lastAppliedSequence = 0) {
  return { playerId, x, y, lastAppliedSequence };
}

test("local prediction is presentation-only, bounded, and does not mutate canonical state", () => {
  const canonical = player(1, 0, 0, 3);
  const predicted = predictLocalPlayer(
    canonical,
    { horizontal: 1, vertical: -1 },
    AUTHORITATIVE_TICK_MS * 20,
  );

  assert.equal(canonical.x, 0);
  assert.equal(canonical.y, 0);
  assert.equal(predicted.x, AUTHORITATIVE_STEP_UNITS * 4);
  assert.equal(predicted.y, -AUTHORITATIVE_STEP_UNITS * 4);
  assert.equal(predicted.predicted, true);

  const edge = predictLocalPlayer(
    player(1, AUTHORITATIVE_WORLD_LIMIT - 10, 0),
    { horizontal: 1, vertical: 0 },
    AUTHORITATIVE_TICK_MS,
  );
  assert.equal(edge.x, AUTHORITATIVE_WORLD_LIMIT);
});

test("acknowledged input history is discarded by authoritative lastAppliedSequence", () => {
  const pending = [
    { sequence: 4 },
    { sequence: 5 },
    { sequence: 6 },
  ];
  assert.deepEqual(pruneAcknowledgedInputs(pending, 5).map((input) => input.sequence), [6]);

  const timeline = new PresentationTimeline({ localPlayerId: 1 });
  for (const sequence of [4, 5, 6]) {
    timeline.recordInput({ sequence, horizontal: 1, vertical: 0 });
  }
  timeline.acceptSnapshot(snapshot(10, [player(1, 128, 0, 5)]), 1_000);
  assert.deepEqual(timeline.pendingInputSequences(), [6]);
});

test("stale snapshots cannot roll presentation authority backwards", () => {
  const timeline = new PresentationTimeline({ localPlayerId: 1 });
  assert.equal(timeline.acceptSnapshot(snapshot(10, [player(1, 0, 0)]), 1_000), true);
  assert.equal(timeline.acceptSnapshot(snapshot(9, [player(1, 999, 999)]), 1_010), false);
  assert.equal(timeline.latestSnapshot().tick, 10n);
  assert.equal(timeline.latestSnapshot().players[0].x, 0);
});

test("remote players interpolate between authoritative snapshots without extrapolating past current state", () => {
  const previous = player(2, 0, 0, 1);
  const current = player(2, 100, 50, 2);
  assert.deepEqual(interpolateRemotePlayer(previous, current, 0.5), {
    ...current,
    x: 50,
    y: 25,
    interpolated: true,
  });
  assert.deepEqual(interpolateRemotePlayer(previous, current, 3), {
    ...current,
    x: 100,
    y: 50,
    interpolated: false,
  });
});

test("new canonical snapshots reset the local prediction basis", () => {
  const timeline = new PresentationTimeline({ localPlayerId: 1 });
  timeline.acceptSnapshot(snapshot(1, [player(1, 0, 0, 1)]), 0);
  const first = timeline.present(100, { horizontal: 1, vertical: 0 });
  assert.equal(first.players[0].x, AUTHORITATIVE_STEP_UNITS * 2);

  timeline.acceptSnapshot(snapshot(2, [player(1, 40, 0, 2)]), 100);
  const corrected = timeline.present(100, { horizontal: 1, vertical: 0 });
  assert.equal(corrected.players[0].x, 40);
  assert.equal(corrected.canonicalTick, 2n);
});

test("presentation combines bounded local prediction with delayed remote interpolation", () => {
  const timeline = new PresentationTimeline({ localPlayerId: 1 });
  timeline.acceptSnapshot(snapshot(1, [player(1, 0, 0), player(2, 0, 100)]), 0);
  timeline.acceptSnapshot(snapshot(2, [player(1, 64, 0, 1), player(2, 100, 100)]), 50);

  const halfway = timeline.present(75, { horizontal: 1, vertical: 0 });
  const local = halfway.players.find((entry) => entry.playerId === 1);
  const remote = halfway.players.find((entry) => entry.playerId === 2);
  assert.equal(local.x, 96);
  assert.equal(remote.x, 50);
  assert.equal(remote.interpolated, true);
});
