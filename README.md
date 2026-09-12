# server-lab

`server-lab` is an interactive laboratory for learning how server systems behave under load, latency, replication, consistency, overload, failure, recovery, coordination, caching, sharding, admission control, global routing, placement, distribution, and real network conditions.

The repository deliberately uses three different surfaces:

- **Browser laboratory** — deterministic, visual simulations published with GitHub Pages.
- **Native experiments** — real Rust processes, sockets, Linux network namespaces, and packet-level network emulation where operating-system/network behavior is itself part of the lesson.
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

### Global multiplayer and distribution

A dedicated deterministic lesson uses multiplayer infrastructure as a concrete global-routing and scheduling case study:

1. **One hostname, several regions** — Frankfurt, Virginia, and Singapore sit behind `multiplayer.example.com`.
2. **Routing policy** — compare round-robin, geographic proximity, and modeled latency-aware steering.
3. **Regional room authority** — each room has one home region and a deterministic global directory.
4. **Control plane versus gameplay path** — room lookup, signaling, direct WebRTC, host-spoke/full-mesh geometry, and TURN relay geography are modeled separately.
5. **Failure and recovery** — directory, signaling, gameplay, and TURN failures have lifecycle-specific effects; ICE restart, rejoin, relay replacement, election terms, and fencing are explicit.
6. **Native process evidence** — the stable dependency boundaries are reproduced by independent loopback processes without claiming regional/provider timing realism.
7. **Fleet-level region placement** — compare minimum-average RTT, minimum-worst-player RTT, load-aware placement, rendezvous hashing, and power-of-two choices while enforcing hard regional capacity.
8. **Placement stability** — regional failure distinguishes unavoidable room movement from avoidable cascade churn.
9. **Hierarchical distribution** — already region-owned rooms are scheduled across hosts and processes without allowing process scheduling to silently reopen the region decision.
10. **Failure domains and draining** — host failure, process health, hard capacity, and graceful draining are modeled as distinct scheduling evidence.

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

The Rust layer leaves the deterministic simulator and exercises real sockets, processes, and kernel network paths:

1. **TCP server** — a tiny `PING` / `PONG` request-response service.
2. **Probe client** — measures real connect/write/read latency and success.
3. **Fault proxy** — adds deterministic per-direction delay and drops every Nth accepted connection at request/connection granularity.
4. **Expected-vs-measured runner** — compares a direct baseline with the impaired proxy path and emits JSON evidence.
5. **Multi-process multiplayer recovery** — spawns directory, signaling, direct-gameplay, and TURN processes, terminates them independently, and verifies the lifecycle dependency boundaries with real sockets.
6. **Packet-level netem** — isolated Linux network namespaces and `tc netem` apply delay, jitter, packet loss, duplication, reordering, and rate limits to real packet paths rather than application handlers.
7. **UDP sequence evidence** — numbered datagrams expose packet loss, duplication, and reordering that TCP intentionally hides from application delivery.
8. **Machine-readable receipts** — native experiments emit evidence suitable for capture by `runtime-profiler` without making it a hard dependency.
9. **Cross-repository WebTransport evidence** — the extracted `game-server` runs its real QUIC/WebTransport endpoint through the same netem boundary and gates authoritative convergence plus same-session outage recovery.

The native layer deliberately does not claim stable benchmark numbers. Exact wall-clock timing is noisy; semantic outcomes and broad directional effects are the gate.

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

The P2P and authoritative models intentionally remain separate: WebRTC remains appropriate for direct browser-to-browser gameplay, while WebTransport is used where the server itself owns the canonical simulation. The stable production-shaped boundary has since been extracted into `game-server`; new reusable runtime work should happen there rather than growing this proof into another production owner.

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

For the Linux-only packet-level experiment:

```bash
cargo build --locked -p server-lab-native --bin server --bin client --bin netem-udp
sudo bash native/netem/experiment.sh
```

The script creates isolated network namespaces and removes them on exit. Do not apply the laboratory qdiscs to a production interface.

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

`server-lab` owns educational scenarios, deterministic simulation models, visualizations, transport/game-authority experiments, placement/distribution experiments, and measurement harnesses. Production-grade networking primitives or generally reusable algorithms should be extracted only after a concrete experiment proves they deserve a separate owner.

The placement experiments establish a possible future **fleet-scheduler** boundary above host setup:

- **region placement contract** — eligible regions, health/capacity/load evidence, participant latency evidence, stable workload identity, and a deterministic placement decision;
- **process distribution contract** — already-owned region, discovered host/process topology, failure-domain identity, health/drain state, hard capacity, stable workload identity, and a deterministic target process.

`game-server` can expose truthful workload/process capacity, health, readiness, and drain facts for such a scheduler. `server-setup` remains a host-management owner: it may expose or validate host facts such as region/failure-domain labels, CPU/memory capacity, UDP/QUIC prerequisites, and maintenance intent, but it does not choose application regions or processes under its current architecture.

The netem harness suggests one plausible `server-setup` test-infrastructure boundary: construct isolated Linux test links, apply declared impairment profiles, run a supplied workload, and capture receipts. It must remain opt-in/disposable-host functionality and must never leak impairment into production networking.

Gameplay-specific persistence, inventories, match recovery, authoritative physics, and actual live game-state migration remain outside these generic scheduling/network-test contracts. They should be introduced only for a concrete game that needs them, with reusable owners such as `physics-engine` remaining authoritative for their domain.

See [`ROADMAP.md`](ROADMAP.md), [`docs/contracts/simulation-model.md`](docs/contracts/simulation-model.md), [`docs/contracts/global-ingress.md`](docs/contracts/global-ingress.md), [`docs/contracts/multiplayer-recovery.md`](docs/contracts/multiplayer-recovery.md), [`docs/contracts/fleet-placement.md`](docs/contracts/fleet-placement.md), [`docs/contracts/server-distribution.md`](docs/contracts/server-distribution.md), [`docs/contracts/replication-model.md`](docs/contracts/replication-model.md), [`docs/contracts/recovery-model.md`](docs/contracts/recovery-model.md), [`docs/contracts/native-experiments.md`](docs/contracts/native-experiments.md), [`docs/contracts/netem.md`](docs/contracts/netem.md), [`docs/contracts/deeper-systems.md`](docs/contracts/deeper-systems.md), and [`docs/contracts/authoritative-multiplayer.md`](docs/contracts/authoritative-multiplayer.md).
