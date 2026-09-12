# Server-authoritative multiplayer contract

This experiment is the server-authoritative sibling of the peer-to-peer model exercised by `multiplayer-setup-service`.

The two architectures intentionally do not share an authority model:

- `multiplayer-setup-service` owns rendezvous and connection setup; game state stays outside that service and gameplay normally becomes peer-to-peer.
- this experiment owns the simulation on the server; clients submit bounded intent and receive authoritative snapshots.

The first slice proves the authority and protocol boundaries independently of a browser transport library. The native TCP server is only a transport harness. WebTransport over HTTP/3/QUIC is the intended browser transport for the next slice.

## Authority boundary

The server owns:

- player identity assigned to each accepted connection;
- membership and the 16-player capacity bound;
- the authoritative tick counter;
- current player positions;
- input sequence acceptance;
- movement application and world bounds;
- disconnect/removal;
- snapshot production and state hashes.

A client owns only its requested input direction and monotonically increasing input sequence number.

A client message deliberately contains no player identifier and no position. The transport connection supplies identity to the server, so a client cannot request a state mutation for another player by changing a payload field.

## Tick semantics

The authoritative kernel runs at 20 ticks per second.

Receiving an input does not immediately move a player. A valid newer input only replaces that player's current intent. Position changes occur only when the server advances the next tick.

The latest accepted intent remains active until another newer input replaces it. Duplicate and stale sequences are ignored idempotently. Sequence `0` is reserved so `0` can represent “no input has ever been applied” in snapshots.

Each axis is bounded to `-1`, `0`, or `1`. Movement is clamped to the authoritative world bounds. Clients cannot submit teleport coordinates, elapsed time, simulation ticks, or a claimed resulting state.

## Deterministic state

Players are stored in deterministic player-id order. A snapshot contains:

- authoritative tick;
- deterministic non-cryptographic state hash;
- player count;
- for each player: server-assigned id, x/y position, and last applied input sequence.

The state hash is reconciliation/debug evidence, not authentication. Server authority comes from executing the simulation on the server, not from trusting a client hash.

Replaying the same admitted inputs at the same ticks produces the same snapshots and hashes.

## Browser transport mapping

The protocol is intentionally shaped for WebTransport:

| Semantic | Intended WebTransport primitive | Reason |
| --- | --- | --- |
| Welcome / server-assigned identity | Reliable unidirectional stream | Must arrive exactly once before gameplay |
| Realtime client input | Datagram | Small, frequent, newer input supersedes older input |
| Authoritative snapshots | Datagram | Latest state matters more than retransmitting stale snapshots |
| Future inventory/chat/match commands | Reliable streams | Transactional or ordered semantics |

The compact binary formats keep the realtime messages bounded:

### Input datagram — 8 bytes

```text
u8  protocol version
u8  kind = input
u32 sequence
 i8 horizontal
 i8 vertical
```

No player id is present.

### Snapshot datagram — at most 211 bytes for 16 players

```text
u8  protocol version
u8  kind = snapshot
u64 authoritative tick
u64 state hash
u8  player count
repeat player count:
  u32 player id
  i16 x
  i16 y
  u32 last applied input sequence
```

The bounded 16-player snapshot remains far below the protocol's 256-byte local target and is suitable for unreliable latest-state delivery without fragmentation at this application layer.

### Welcome frame — 18 bytes

```text
u8  protocol version
u8  kind = welcome
u32 player id
u16 tick rate
u8  max players
u8  reserved
u64 current tick
```

## Native TCP harness

`authoritative-tcp-server` proves that the authoritative kernel is usable behind a real connection boundary without coupling the kernel to WebTransport.

The harness:

- assigns a player id on accept;
- sends the welcome frame reliably;
- accepts fixed-size input frames;
- advances one shared world at 20 Hz;
- broadcasts authoritative snapshots;
- uses a one-snapshot queue per client and drops an older pending snapshot rather than allowing unbounded backlog;
- removes a player when the connection closes.

TCP is not presented as the browser realtime transport. It exists so authority, framing, backpressure, disconnect handling, and multi-client state can be exercised with native processes before adding QUIC/TLS/browser concerns.

## Fail-closed rules

The server rejects or disconnects on:

- unsupported protocol versions;
- wrong frame kinds or lengths;
- sequence `0`;
- out-of-range axes;
- unknown player identities at the kernel boundary;
- attempts to exceed 16 connected players;
- malformed snapshots when decoding test evidence;
- snapshot hashes that do not match the encoded state.

Duplicate/stale valid input is not an error; it is ignored idempotently.

## Deliberate exclusions from this slice

This slice does not yet claim:

- production-ready WebTransport deployment;
- browser certificate/TLS setup;
- client-side prediction or reconciliation;
- lag compensation or rollback;
- authoritative physics from `physics-engine`;
- persistent matches;
- matchmaking/accounts/rankings;
- multi-process authoritative world migration;
- anti-cheat beyond the fundamental server-ownership boundary.

Those are later slices and must not weaken the current rule: clients submit intent; the server alone mutates canonical game state.
