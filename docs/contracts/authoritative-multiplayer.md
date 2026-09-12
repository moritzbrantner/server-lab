# Server-authoritative multiplayer contract

This experiment is the server-authoritative sibling of the peer-to-peer model exercised by `multiplayer-setup-service`.

The two architectures intentionally do not share an authority model:

- `multiplayer-setup-service` owns rendezvous and connection setup; game state stays outside that service and gameplay normally becomes peer-to-peer.
- this experiment owns the simulation on the server; clients submit bounded intent and receive authoritative snapshots.

The deterministic kernel is transport-independent. The native TCP server is a compatibility harness; WebTransport over HTTP/3/QUIC is the browser-facing transport adapter.

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

Because realtime input uses unreliable datagrams, the browser refreshes its current intent every 50 ms with a newer sequence. This makes packet loss self-healing without changing the server rule that only the latest accepted intent matters.

## Deterministic state

Players are stored in deterministic player-id order. A snapshot contains:

- authoritative tick;
- deterministic non-cryptographic state hash;
- player count;
- for each player: server-assigned id, x/y position, and last applied input sequence.

The state hash is reconciliation/debug evidence, not authentication. Server authority comes from executing the simulation on the server, not from trusting a client hash.

Replaying the same admitted inputs at the same ticks produces the same snapshots and hashes.

## Browser transport mapping

The current browser adapter maps the protocol onto WebTransport:

| Semantic | WebTransport primitive | Reason |
| --- | --- | --- |
| Welcome / server-assigned identity | Reliable unidirectional stream | Must arrive exactly once before gameplay |
| Realtime client input | Datagram | Small, frequent, newer input supersedes older input |
| Authoritative snapshots | Datagram | Latest state matters more than retransmitting stale snapshots |
| Future inventory/chat/match commands | Reliable streams | Transactional or ordered semantics |

The WebTransport session path is `/authoritative`. The server rejects sessions that cannot send an application datagram large enough for the maximum authoritative snapshot.

Snapshot sends are intentionally not converted into a reliable queue when QUIC datagrams are congested. Missing an older snapshot is acceptable because the next server snapshot is newer canonical state. Reliable game semantics must use streams instead.

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

The bounded 16-player snapshot remains below the protocol's 256-byte local target and comfortably below the datagram budget required by the server before admission.

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

## WebTransport server adapter

`authoritative-webtransport-server` terminates the browser WebTransport session and delegates all game decisions to `AuthoritativeWorld`.

The adapter:

- loads a configured TLS certificate/private key and exposes an HTTP/3 WebTransport endpoint;
- accepts only `/authoritative` sessions;
- requires negotiated QUIC datagrams large enough for a 16-player snapshot;
- assigns the player id after transport admission;
- sends the welcome frame on a reliable unidirectional stream;
- treats every received datagram as exactly one bounded input command;
- advances one shared world at 20 Hz independently of client packet arrival;
- broadcasts compact snapshots via datagrams;
- treats broadcast lag as latest-state loss rather than replaying stale snapshots;
- removes admitted players when their connection closes or post-admission setup fails.

`wtransport` is an adapter dependency, not a gameplay authority. Replacing it must not require changing the deterministic kernel or wire semantics.

## Native TCP harness

`authoritative-tcp-server` proves that the authoritative kernel is usable behind a real connection boundary without coupling the kernel to WebTransport.

The harness:

- assigns a player id on accept;
- sends the welcome frame reliably;
- accepts fixed-size input frames;
- advances one shared world at 20 Hz;
- broadcasts authoritative snapshots;
- uses an overwriteable one-snapshot buffer per client so a blocked writer retains the latest snapshot instead of stale backlog;
- removes an admitted player on all post-admission exits, including setup failures.

TCP is not presented as the browser realtime transport. It remains useful for transport-independent native testing.

## Fail-closed rules

The server rejects or disconnects on:

- unsupported protocol versions;
- wrong frame kinds or lengths;
- sequence `0`;
- out-of-range axes;
- unknown player identities at the kernel boundary;
- attempts to exceed 16 connected players;
- WebTransport sessions without adequate datagram support;
- malformed snapshots when decoding test evidence;
- snapshot hashes that do not match the encoded state.

Duplicate/stale valid input is not an error; it is ignored idempotently.

## Deliberate exclusions

The current slices do not yet claim:

- production qualification of the chosen Rust WebTransport implementation;
- automated certificate issuance/rotation;
- client-side prediction or reconciliation;
- lag compensation or rollback;
- authoritative physics from `physics-engine`;
- persistent matches;
- matchmaking/accounts/rankings;
- multi-process authoritative world migration;
- anti-cheat beyond the fundamental server-ownership boundary.

Those are later slices and must not weaken the current rule: clients submit intent; the server alone mutates canonical game state.
