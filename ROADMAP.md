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

## Next implementation horizon

### Slice 3 — replication semantics

- Separate read replicas from leaders.
- Model synchronous versus asynchronous replication delay.
- Demonstrate stale reads and read-after-write consistency.
- Add quorum reads/writes as a teaching scenario without pretending the simulator is a production database.
- Introduce partitions and replica lag explicitly in the event trace.

### Slice 4 — availability and distributed coordination

- Model health checks, failover delay, retries, and retry amplification.
- Add circuit breakers and exponential backoff.
- Teach availability composition and correlated failure domains.
- Add a small leader-election/consensus exhibit only after the failure model is explicit.

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
