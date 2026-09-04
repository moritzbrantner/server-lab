# server-lab

`server-lab` is an interactive laboratory for learning how server systems behave under load, latency, replication, consistency, overload, failure, recovery, coordination, caching, sharding, admission control, and real network conditions.

The repository deliberately uses two different surfaces:

- **Browser laboratory** — deterministic, visual simulations published with GitHub Pages.
- **Native experiments** — real Rust processes and sockets where operating-system/network behavior is itself part of the lesson.

The browser models are not presented as infrastructure benchmarks, and the native timing results are not treated as deterministic correctness data. The repository makes that boundary explicit so simplified expectations can be compared with measured evidence without conflating them.

## Curriculum

The teaching site has five top-level lessons.

### Routing & capacity

The shared stateless request model teaches:

1. **Latency** — service time versus network delay, queueing delay, and tail latency.
2. **Load balancing** — round-robin, least-connections, and seeded-random routing.
3. **Replica capacity** — replica count, aggregate capacity, and the cost of losing destinations.
4. **Availability** — node failures, successful-request ratio, and recovery through redundancy.
5. **Queues** — worker concurrency, bounded waiting queues, and the latency cost of absorbing overload.
6. **Overload control** — reject-when-busy, bounded queues, and latency-budget load shedding.
7. **Bursts and saturation** — temporary arrival spikes versus sustained service capacity.
8. **Backpressure** — moving waiting toward the producer instead of allowing unbounded server-side work.
9. **Little's Law** — relating measured throughput and mean request time to average requests in the system.

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

The Rust layer leaves the deterministic simulator and exercises real localhost sockets:

1. **TCP server** — a tiny `PING` / `PONG` request-response service.
2. **Probe client** — measures real connect/write/read latency and success.
3. **Fault proxy** — adds deterministic per-direction delay and drops every Nth accepted connection.
4. **Expected-vs-measured runner** — compares a direct baseline with the impaired path and emits JSON evidence.
5. **Real-socket integration tests** — bind ephemeral ports and verify end-to-end behavior in CI.
6. **Machine-readable receipts** — suitable for capture by `runtime-profiler` without making it a hard dependency.

The native layer deliberately does not claim stable benchmark numbers. Exact wall-clock timing is noisy; semantic outcomes and directional effects are the gate.

### Deeper systems

A fifth deterministic lesson keeps several advanced topics narrow and inspectable:

1. **Caching and invalidation** — bounded LRU capacity, TTL expiry, write invalidation, hits, misses, stale reads, and origin pressure.
2. **Consistent hashing and sharding** — key movement when adding a node, virtual nodes, per-shard balance, and hot-key skew.
3. **Rate limiting and admission control** — no control versus token buckets versus concurrency protection under a deterministic burst.
4. **Connection pools and keep-alive** — one-time handshake cost, connection reuse, fan-out, slow children, and head-of-line queueing.
5. **CAP/PACELC through traces** — quorum rejection versus local availability during a partition, plus cross-region quorum latency versus asynchronous stale reads when healthy.

The deeper-systems models are intentionally separate pure functions rather than one generic distributed-systems abstraction. Their job is to expose the mechanism behind each tradeoff.

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
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p server-lab-native --bin experiment -- 20 20 5 5 1000
```

For manual multi-process experiments:

```bash
cargo run -p server-lab-native --bin server -- 127.0.0.1:9000 5
cargo run -p server-lab-native --bin fault-proxy -- 127.0.0.1:9100 127.0.0.1:9000 20 5
cargo run -p server-lab-native --bin client -- 127.0.0.1:9100 20 1000 0
```

The teaching site is a static Next.js export suitable for GitHub Pages; the native experiments run locally or in CI.

## Repository boundaries

`server-lab` owns educational scenarios, deterministic simulation models, visualizations, and experiment harnesses. Production-grade networking primitives or generally reusable algorithms should be extracted only after a concrete experiment proves they deserve a separate owner.

See [`ROADMAP.md`](ROADMAP.md) for the implementation slices, [`docs/contracts/simulation-model.md`](docs/contracts/simulation-model.md) for routing/capacity semantics, [`docs/contracts/replication-model.md`](docs/contracts/replication-model.md) for stateful replication, [`docs/contracts/recovery-model.md`](docs/contracts/recovery-model.md) for recovery/coordination semantics, [`docs/contracts/native-experiments.md`](docs/contracts/native-experiments.md) for the real-socket measurement boundary, and [`docs/contracts/deeper-systems.md`](docs/contracts/deeper-systems.md) for Slice 6 model boundaries.
