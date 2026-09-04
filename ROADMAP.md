# server-lab roadmap

## Completed slices

### Slice 1 — deterministic browser laboratory

- [x] Establish the repository boundary between teaching simulation and real network experiments.
- [x] Define one deterministic request-routing model shared by the first lessons.
- [x] Teach network latency, service latency, throughput, and tail latency.
- [x] Compare round-robin, least-connections, and seeded-random load balancing.
- [x] Model replicated server pools and node failures.
- [x] Expose availability, successful requests, p50/p95 latency, and per-node utilization.
- [x] Publish the interactive laboratory as a static GitHub Pages site.
- [x] Add deterministic unit tests and CI.

### Slice 2 — queues, overload, and backpressure

- [x] Add configurable worker concurrency and bounded per-node queues.
- [x] Make queueing delay explicit in individual request traces and aggregate metrics.
- [x] Compare reject, bounded-queue, and wait-budget load-shedding policies.
- [x] Add deterministic burst traffic and a capacity-saturation preset.
- [x] Model client-side backpressure as delayed offered work rather than server queueing.
- [x] Expose nominal service capacity, overload drops, queued requests, and peak queue depth.
- [x] Demonstrate Little's Law from measured throughput, mean request time, and average requests in the system.
- [x] Add deterministic tests for each overload and flow-control behavior.

### Slice 3 — replication semantics

- [x] Separate the stateful replication lesson from the stateless request-routing simulator.
- [x] Establish one write leader and explicit follower versions.
- [x] Compare asynchronous leader acknowledgement, majority quorum acknowledgement, and sync-all acknowledgement.
- [x] Demonstrate stale follower reads and leader reads.
- [x] Add read-your-writes session consistency with bounded waiting and leader fallback.
- [x] Add majority read quorums and make quorum intersection visible.
- [x] Model deterministic replication delay, jitter, follower lag, and pending updates.
- [x] Partition a follower replication link while keeping that follower readable by the client.
- [x] Expose write timeouts, stale-read rate, acknowledgement latency, read waiting, final versions, and maximum lag.
- [x] Add deterministic tests for asynchronous staleness, session guarantees, quorum progress, sync-all timeout, and partition lag.
- [x] Publish replication and consistency as a dedicated GitHub Pages lesson with top-level lab navigation.

## Next implementation horizon

### Slice 4 — availability, recovery, and coordination

- Add active and passive health-check models with configurable detection delay.
- Model failover delay separately from failure detection.
- Add bounded retries and make retry amplification visible in offered load.
- Add exponential backoff with deterministic jitter.
- Add circuit breakers with closed, open, and half-open states.
- Teach availability composition across independent and correlated failure domains.
- Add leader failure only after the recovery model can explain detection and promotion timing.
- Add a minimal leader-election exhibit with terms/epochs and fencing before introducing a named consensus algorithm.
- Keep retry, failover, and election traces deterministic and explicit.

### Slice 5 — native network experiments

- Add small Rust server/client binaries using real sockets or HTTP.
- Reproduce selected browser scenarios with multiple localhost processes.
- Add a controllable proxy for delay, packet loss, and failure injection.
- Compare simulated expectations with measured native results.
- Use runtime-profiler where useful, while keeping benchmark claims separate from the browser simulator.

### Slice 6 — deeper systems topics

- Caching and cache invalidation.
- Consistent hashing and sharding.
- Rate limiting and admission control.
- Connection pools and keep-alive behavior.
- Queues, workers, fan-out, and head-of-line blocking.
- CAP/PACELC-oriented scenarios grounded in concrete traces rather than slogans.
