import {
  AUTHORITATIVE_WORLD_LIMIT,
  PresentationTimeline,
} from "./presentation.js";

const PROTOCOL_VERSION = 1;
const INPUT_KIND = 1;
const SNAPSHOT_KIND = 2;
const WELCOME_KIND = 3;
const INPUT_BYTES = 8;
const WELCOME_BYTES = 18;
const SNAPSHOT_HEADER_BYTES = 19;
const SNAPSHOT_PLAYER_BYTES = 12;
const TICK_INTERVAL_MS = 50;

const form = document.querySelector("#connect-form");
const endpointInput = document.querySelector("#endpoint");
const disconnectButton = document.querySelector("#disconnect");
const statusOutput = document.querySelector("#status");
const playerOutput = document.querySelector("#player");
const tickOutput = document.querySelector("#tick");
const hashOutput = document.querySelector("#hash");
const playersOutput = document.querySelector("#players");
const canvas = document.querySelector("#arena");
const context = canvas.getContext("2d");

let transport = null;
let datagramWriter = null;
let inputTimer = null;
let animationFrame = null;
let inputSendInFlight = false;
let sequence = 0;
let localPlayerId = null;
let timeline = null;
let horizontal = 0;
let vertical = 0;
const pressed = new Set();

function setStatus(value) {
  statusOutput.textContent = value;
}

function nextSequence() {
  sequence = (sequence + 1) >>> 0;
  if (sequence === 0) sequence = 1;
  return sequence;
}

function encodeInput(input) {
  const bytes = new Uint8Array(INPUT_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, INPUT_KIND);
  view.setUint32(2, input.sequence);
  view.setInt8(6, input.horizontal);
  view.setInt8(7, input.vertical);
  return bytes;
}

function decodeWelcome(bytes) {
  if (bytes.byteLength !== WELCOME_BYTES) throw new Error("Invalid welcome length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION || view.getUint8(1) !== WELCOME_KIND) {
    throw new Error("Unsupported welcome frame");
  }
  return {
    playerId: view.getUint32(2),
    tickHz: view.getUint16(6),
    maxPlayers: view.getUint8(8),
    currentTick: view.getBigUint64(10),
  };
}

function decodeSnapshot(bytes) {
  if (bytes.byteLength < SNAPSHOT_HEADER_BYTES) throw new Error("Snapshot is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION || view.getUint8(1) !== SNAPSHOT_KIND) {
    throw new Error("Unsupported snapshot frame");
  }
  const count = view.getUint8(18);
  const expected = SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_PLAYER_BYTES;
  if (bytes.byteLength !== expected) throw new Error("Snapshot length does not match player count");

  const players = [];
  for (let index = 0; index < count; index += 1) {
    const offset = SNAPSHOT_HEADER_BYTES + index * SNAPSHOT_PLAYER_BYTES;
    players.push({
      playerId: view.getUint32(offset),
      x: view.getInt16(offset + 4),
      y: view.getInt16(offset + 6),
      lastAppliedSequence: view.getUint32(offset + 8),
    });
  }
  return {
    tick: view.getBigUint64(2),
    stateHash: view.getBigUint64(10),
    players,
  };
}

async function readExactly(reader, length) {
  const result = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Reliable welcome stream ended early");
    if (!(value instanceof Uint8Array)) throw new Error("Welcome stream returned non-binary data");
    if (offset + value.byteLength > length) throw new Error("Reliable welcome stream exceeded expected length");
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

async function readWelcome(currentTransport) {
  const streams = currentTransport.incomingUnidirectionalStreams.getReader();
  try {
    const { value: stream, done } = await streams.read();
    if (done || !stream) throw new Error("Server closed before sending session metadata");
    const reader = stream.getReader();
    try {
      return decodeWelcome(await readExactly(reader, WELCOME_BYTES));
    } finally {
      reader.releaseLock();
    }
  } finally {
    streams.releaseLock();
  }
}

function formatCoordinate(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function render(presentation) {
  tickOutput.textContent = presentation.canonicalTick.toString();
  hashOutput.textContent = `0x${presentation.canonicalStateHash.toString(16).padStart(16, "0")}`;
  playersOutput.textContent = presentation.players
    .map((player) => {
      const mode = player.playerId === localPlayerId && player.predicted
        ? " predicted"
        : player.interpolated
          ? " interpolated"
          : "";
      return `${player.playerId}@(${formatCoordinate(player.x)},${formatCoordinate(player.y)})#${player.lastAppliedSequence}${mode}`;
    })
    .join(" · ");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  for (const player of presentation.players) {
    const x = ((player.x + AUTHORITATIVE_WORLD_LIMIT) / (AUTHORITATIVE_WORLD_LIMIT * 2)) * canvas.width;
    const y = ((player.y + AUTHORITATIVE_WORLD_LIMIT) / (AUTHORITATIVE_WORLD_LIMIT * 2)) * canvas.height;
    context.beginPath();
    context.arc(x, y, player.playerId === localPlayerId ? 8 : 5, 0, Math.PI * 2);
    context.fill();
    context.fillText(String(player.playerId), x + 10, y - 8);
  }
}

function startRenderLoop(currentTransport) {
  cancelAnimationFrame(animationFrame);
  const frame = () => {
    if (transport !== currentTransport) return;
    const presentation = timeline?.present(performance.now(), { horizontal, vertical });
    if (presentation) render(presentation);
    animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);
}

async function consumeSnapshots(currentTransport) {
  const reader = currentTransport.datagrams.readable.getReader();
  try {
    while (transport === currentTransport) {
      const { value, done } = await reader.read();
      if (done) return;
      if (!(value instanceof Uint8Array)) continue;
      timeline?.acceptSnapshot(decodeSnapshot(value), performance.now());
    }
  } finally {
    reader.releaseLock();
  }
}

async function sendCurrentInput(currentTransport) {
  if (transport !== currentTransport || !datagramWriter || inputSendInFlight) return;
  inputSendInFlight = true;
  const input = {
    sequence: nextSequence(),
    horizontal,
    vertical,
  };
  timeline?.recordInput(input);
  try {
    await datagramWriter.write(encodeInput(input));
  } finally {
    inputSendInFlight = false;
  }
}

function startInputLoop(currentTransport) {
  clearInterval(inputTimer);
  inputTimer = setInterval(() => {
    sendCurrentInput(currentTransport).catch((error) => {
      if (transport === currentTransport) setStatus(`Input send failed: ${error.message}`);
    });
  }, TICK_INTERVAL_MS);
}

function updateAxes() {
  horizontal = Number(pressed.has("ArrowRight") || pressed.has("KeyD")) -
    Number(pressed.has("ArrowLeft") || pressed.has("KeyA"));
  vertical = Number(pressed.has("ArrowDown") || pressed.has("KeyS")) -
    Number(pressed.has("ArrowUp") || pressed.has("KeyW"));
}

function isMovementKey(code) {
  return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(code);
}

window.addEventListener("keydown", (event) => {
  if (!isMovementKey(event.code)) return;
  event.preventDefault();
  pressed.add(event.code);
  updateAxes();
});

window.addEventListener("keyup", (event) => {
  if (!isMovementKey(event.code)) return;
  event.preventDefault();
  pressed.delete(event.code);
  updateAxes();
});

function resetUi() {
  disconnectButton.disabled = true;
  playerOutput.textContent = "—";
  tickOutput.textContent = "—";
  hashOutput.textContent = "—";
  playersOutput.textContent = "—";
  localPlayerId = null;
  timeline = null;
  sequence = 0;
  pressed.clear();
  updateAxes();
}

async function disconnect(status = "Disconnected") {
  clearInterval(inputTimer);
  inputTimer = null;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  const currentTransport = transport;
  transport = null;
  try {
    datagramWriter?.releaseLock();
  } catch {
    // The transport may have already released the writer while closing.
  }
  datagramWriter = null;
  currentTransport?.close();
  resetUi();
  setStatus(status);
}

async function connect(endpoint) {
  await disconnect();
  if (!("WebTransport" in globalThis)) throw new Error("This browser does not support WebTransport");

  setStatus("Connecting…");
  const currentTransport = new WebTransport(endpoint);
  transport = currentTransport;
  await currentTransport.ready;
  if (transport !== currentTransport) return;

  const welcome = await readWelcome(currentTransport);
  localPlayerId = welcome.playerId;
  timeline = new PresentationTimeline({ localPlayerId });
  playerOutput.textContent = `${welcome.playerId} · ${welcome.tickHz} Hz · max ${welcome.maxPlayers}`;
  tickOutput.textContent = welcome.currentTick.toString();
  datagramWriter = currentTransport.datagrams.writable.getWriter();
  disconnectButton.disabled = false;
  setStatus("Connected · local prediction is presentation-only");
  startInputLoop(currentTransport);
  startRenderLoop(currentTransport);
  consumeSnapshots(currentTransport).catch((error) => {
    if (transport === currentTransport) setStatus(`Snapshot stream failed: ${error.message}`);
  });
  currentTransport.closed.then(
    () => {
      if (transport === currentTransport) disconnect("Connection closed");
    },
    (error) => {
      if (transport === currentTransport) disconnect(`Connection closed: ${error.message}`);
    },
  );
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  connect(endpointInput.value.trim()).catch((error) => {
    disconnect(`Connection failed: ${error.message}`);
  });
});

disconnectButton.addEventListener("click", () => disconnect());
resetUi();
