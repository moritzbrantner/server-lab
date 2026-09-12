# server-lab-authoritative

This crate is the proving ground for the server-authoritative sibling of `multiplayer-setup-service`.

The P2P service keeps gameplay outside the rendezvous server. This crate deliberately tests the opposite authority model: clients send intent to one server-owned simulation and receive canonical snapshots back.

## Current slice

The first slice establishes the transport-independent kernel:

- deterministic 20 Hz server ticks;
- up to 16 server-assigned players;
- compact client input without a player-id or position field;
- stale/duplicate input rejection by sequence;
- server-only position mutation;
- compact authoritative snapshots and deterministic state hashes;
- native TCP multi-client harness for real-socket testing.

Run the kernel tests with:

```bash
cargo test -p server-lab-authoritative
```

Run the native compatibility harness with:

```bash
cargo run -p server-lab-authoritative --bin authoritative-tcp-server -- 127.0.0.1:9443
```

The TCP framing is a native experiment only. It is not the target browser transport.

## Transport roadmap

### Slice A — authoritative kernel and framing

- [x] Server-owned tick and world state.
- [x] Server-assigned connection identity.
- [x] Intent-only input protocol.
- [x] Monotonic sequence validation and stale-input idempotence.
- [x] Compact authoritative snapshots under 256 bytes at 16 players.
- [x] Deterministic state hash evidence.
- [x] Native real-socket harness with bounded latest-snapshot backpressure.

### Slice B — WebTransport / HTTP/3

- [ ] Add a WebTransport server adapter without moving game semantics into the transport layer.
- [ ] Map welcome/session metadata to a reliable unidirectional stream.
- [ ] Map realtime client inputs to WebTransport datagrams.
- [ ] Map authoritative latest-state snapshots to WebTransport datagrams.
- [ ] Require datagram support and keep application payloads bounded.
- [ ] Add certificate configuration suitable for local testing and a documented production TLS boundary.
- [ ] Add a minimal browser client that proves real browser-to-Rust connectivity.
- [ ] Keep a WebSocket compatibility adapter as a fallback only if a concrete browser/deployment requirement needs it.

### Slice C — client prediction and reconciliation

- [ ] Predict only the local player's presentation state.
- [ ] Preserve server tick/state as canonical.
- [ ] Use `lastAppliedSequence` to discard acknowledged local input history.
- [ ] Reconcile prediction against authoritative snapshots without mutating server history.
- [ ] Add interpolation for remote players and bounded extrapolation only where measured evidence supports it.

### Slice D — authoritative gameplay services

- [ ] Separate session admission from game-world ownership.
- [ ] Add explicit reliable command channels for transactional actions such as inventory or match state.
- [ ] Introduce authoritative physics only through a reusable owner such as `physics-engine`, not a second physics implementation here.
- [ ] Add persistence/match recovery only when a game actually requires it.
- [ ] Add multi-process placement/migration only after the single-process authority contract is stable.

## Invariants

1. Clients submit intent; they never submit canonical state.
2. A connection determines player identity; an input payload cannot impersonate another player.
3. The server alone advances ticks and mutates authoritative positions.
4. Duplicate/stale valid input is idempotently ignored.
5. Realtime transport may drop stale packets, but the simulation rules are independent of packet delivery APIs.
6. Transport-specific code must remain an adapter around this crate's deterministic kernel.
7. WebTransport is the browser target because this model is client-to-server; WebRTC remains the appropriate P2P transport for the separate rendezvous architecture.

See `../docs/contracts/authoritative-multiplayer.md` for the exact protocol and authority contract.
