# server-lab

`server-lab` is an interactive laboratory for learning how server systems behave under load, latency, replication, consistency, overload, failure, recovery, coordination, caching, sharding, admission control, global routing, and real network conditions.

The repository deliberately uses three different surfaces:

- **Browser laboratory** — deterministic, visual simulations published with GitHub Pages.
- **Native experiments** — real Rust processes and sockets where operating-system/network behavior is itself part of the lesson.
- **Authoritative multiplayer proof** — a separate Rust/WebTransport experiment where the server owns canonical game state and browser prediction remains presentation-only.

The browser models are not presented as infrastructure benchmarks, and native timing results are not treated as deterministic correctness data. The repository makes those boundaries explicit so simplified expectations can be compared with measured evidence without conflating them.

## Curriculum

The teaching site has six top-level lessons, with the authoritative multiplayer proof living beside the site as a separate transport/game-authority experiment.

### Routing & capacity

The shared stateless request model teaches:

1. **Latency** — service time versus network delay, queueing delay, and tail latency.
2. **Load balancing** — round-robin, least-connections, and seeded-random routing.
3. **Replica capacity** — replica count, aggregate capacity, and the cost of losing destinations.
4. **Availability** — node failures, successful requests, p50/p95 latency, and recovery through redundancy.
5. **Queues** — worker concurrency, bounded waiting queues, and the latency cost of absorbing overload.
6. **Overload control** — reject-when-busy, bounded queues, and latency-budget load shedding.
7. **Bursts and saturation** — temporary arrival spikes versus sustained service capacity.
8. **Backpressure** — moving waiting toward the producer instead of allowing unbounded server-side work.
9. **Little's Law** — relating measured throughput and mean request time to average requests in the system.

### Global multiplayer ingress

A dedicated deterministic lesson uses the multiplayer setup service as a concrete global-routing case study:

1. **One hostname, several regions** — Frankfurt, Virginia, and Singapore sit behind `multiplayer.example.com`.
2. **Routing policy** — compare round-robin, geographic proximity, and modeled latency-aware steering.
3. **Regional room authority** — each room has one home region and a deterministic global directory.
4. **Control plane versus gameplay path** — room lookup, signaling, direct WebRTC, host-spoke/full-mesh geometry, and TURN relay geography are modeled separately.
5. **Failure and recovery** — directory, signaling, gameplay, and TURN failures have lifecycle-specific effects; ICE restart, rejoin, relay replacement, election terms, and fencing are explicit.
6. **Native process evidence** — the stable dependency boundaries are reproduced by independent loopback processes without claiming regional/provider timing realism.

### Replication & consistency

A separate stateful version model teaches:

1. **Leaders and followers** — one write owner with explicit follower versions.
2. **Asynchronous replication** — immediate leader acknowledgement and a visible stale-read window.
3. **Synchronous replication** — waiting for all followers and exposing the latency/availability cost of the slowest replica.
4. **Write quorums** — majority acknowledgement that can continue past one lagging or partitioned follower.
5. **Eventual reads** — a responsive follower may still return an older version.
6. **Read-your-writes** — bounded waiting or leader fallback preserves a client's acknowledged session state.
7. **Read quorums** — majority reads expose why intersecting read/write quorums can recover the newest acknowledged version.
8. **Replica lag** — divergence is measured in versions and pending replication updates.
9. **Partitions** — a follower can remain client-readable while its replication link to the leader is cut.

### Recovery & coordination

A third deterministic model makes recovery timing and coordination explicit:

1. **Active and passive health checks**.
2. **Failure detection versus failover delay**.
3. **Bounded retries and exponential backoff**.
4. **Retry amplification**.
5. **Circuit breakers** with closed, open, and half-open states.
6. **Independent versus correlated failure domains**.
7. **Leader failure and heartbeat timeout**.
8. **Terms, majority election, and fencing**.

### Native network experiments

The Rust layer leaves the deterministic simulator and exercises real localhost sockets and processes:

1. **TCP server** — a tiny `PING` / `PONG` request-response service.
2. **Probe client** — measures real connect/write/read latency and success.
3. **Fault proxy** — adds deterministic per-direction delay and drops every Nth accepted connection.
4. **Expected-vs-measured runner** — compares a direct baseline with the impaired path and emits JSON evidence.
5. **Multi-process multiplayer recovery** — spawns directory, signaling, direct-gameplay, and TURN processes, terminates them independently, and verifies the Slice 7D dependency boundaries with real sockets.
6. **Real-socket integration tests** — bind ephemeral ports and verify end-to-end behavior in CI.
7. **Machine-readable receipts** — suitable for capture by `runtime-profiler` without making it a hard dependency.

The native layer deliberately does not claim stable benchmark numbers. Exact wall-clock timing is noisy; semantic outcomes and directional effects are the gate.

### Deeper systems

A fifth deterministic lesson keeps several advanced topics narrow and inspectable:

1. **Caching and invalidation** — bounded LRU capacity, TTL expiry, write invalidation, hits, misses, stale reads, and origin pressure.
2. **Consistent hashing and sharding** — key movement when adding a node, virtual nodes, per-shard balance, and hot-key skew.
3. **Rate limiting and admission control** — no control versus token buckets versus concurrency protection under a deterministic burst.
4. **Connection pools and keep-alive** — one-time handshake cost, connection reuse, fan-out, slow children, and head-of-line queueing.
5. **CAP/PACELC through traces** — quorum rejection versus local availability during a partition, plus cross-region quorum latency versus asynchronous stale reads when healthy.

The deeper-systems models are intentionally separate pure functions rather than one generic distributed-systems abstraction. Their job is to expose the mechanism behind each tradeoff.

## Server-authoritative multiplayer proof

The `authoritative` Rust crate explores the architectural sibling of `multiplayer-setup-service`:

- one server-owned deterministic 20 Hz world for up to 16 players;
- server-assigned identity rather than trusting identity inside input payloads;
- intent-only client input with monotonic sequences;
- bounded canonical snapshots and deterministic state hashes;
- a native TCP compatibility harness for transport-independent process/socket evidence;
- a real WebTransport/HTTP/3 adapter using reliable session metadata plus datagrams for realtime input/snapshots;
- a browser client with bounded local presentation prediction, authoritative reconciliation, acknowledgement pruning, and remote interpolation.

The P2P and authoritative models intentionally remain separate: WebRTC remains appropriate for direct browser-to-browser gameplay, while WebTransport is used where the server itself owns the canonical simulation.

See [`authoritative/README.md`](authoritative/README.md) and [`docs/contracts/authoritative-multiplayer.md`](docs/contracts/authoritative-multiplayer.md).

## Development

### Web

```bash
cd web
bun install
bun run typecheck
bun test
bun run build
bun run dev
```

### Native Rust

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo run --locked -p server-lab-native --bin experiment -- 20 20 5 5 1000
cargo run --locked -p server-lab-native --bin multiplayer-recovery-experiment
```

For manual multi-process experiments:

```bash
cargo run --locked -p server-lab-native --bin server -- 127.0.0.1:9000 5
cargo run --locked -p server-lab-native --bin fault-proxy -- 127.0.0.1:9100 127.0.0.1:9000 20 5
cargo run --locked -p server-lab-native --bin client -- 127.0.0.1:9100 20 1000 0
```

### Authoritative WebTransport

Provide a browser-trusted TLS certificate/key for local development, then run:

```bash
export AUTHORITATIVE_CERT_PEM=/path/to/localhost-cert.pem
export AUTHORITATIVE_KEY_PEM=/path/to/localhost-key.pem
export AUTHORITATIVE_PORT=4433
cargo run --locked -p server-lab-authoritative --bin authoritative-webtransport-server
```

Serve `authoritative/web/` with an ordinary local HTTP server and connect the browser client to `https://localhost:4433/authoritative`.

The teaching site is a static Next.js export suitable for GitHub Pages; native and authoritative experiments run locally or in CI as applicable.

## Repository boundaries

`server-lab` owns educational scenarios, deterministic simulation models, visualizations, transport/game-authority experiments, and measurement harnesses. Production-grade networking primitives or generally reusable algorithms should be extracted only after a concrete experiment proves they deserve a separate owner.

Gameplay-specific persistence, inventories, match recovery, authoritative physics, and multi-process world placement are not unfinished networking work. They should be introduced only for a concrete game that needs them, with reusable owners such as `physics-engine` remaining authoritative for their domain.

See [`ROADMAP.md`](ROADMAP.md), [`docs/contracts/simulation-model.md`](docs/contracts/simulation-model.md), [`docs/contracts/global-ingress.md`](docs/contracts/global-ingress.md), [`docs/contracts/multiplayer-recovery.md`](docs/contracts/multiplayer-recovery.md), [`docs/contracts/replication-model.md`](docs/contracts/replication-model.md), [`docs/contracts/recovery-model.md`](docs/contracts/recovery-model.md), [`docs/contracts/native-experiments.md`](docs/contracts/native-experiments.md), [`docs/contracts/deeper-systems.md`](docs/contracts/deeper-systems.md), and [`docs/contracts/authoritative-multiplayer.md`](docs/contracts/authoritative-multiplayer.md).
