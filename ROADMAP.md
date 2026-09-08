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

### Slice 4 — availability, recovery, and coordination

- [x] Add active and passive health-check models with configurable detection timing.
- [x] Model physical failure, failure detection, and failover completion as separate events.
- [x] Add bounded retries and measure retry amplification as backend attempts per logical request.
- [x] Add exponential backoff with deterministic seeded jitter.
- [x] Add per-backend circuit breakers with closed, open, and half-open states.
- [x] Teach availability composition across independent replicas and correlated/shared failure domains.
- [x] Add a dedicated recovery lesson with fast-failover, retry-storm, circuit-breaker, and zone-outage presets.
- [x] Add leader failure only after recovery timing is explicit.
- [x] Add a minimal majority-based leader-election exhibit with terms/epochs and fencing tokens.
- [x] Demonstrate that loss of a majority prevents safe leader promotion.
- [x] Fence a recovered stale leader after a higher term has elected a replacement.
- [x] Keep recovery, retry, circuit, failure-domain, and election traces deterministic and covered by tests.

### Slice 5 — native network experiments

- [x] Add a dependency-light Rust workspace beside the browser laboratory.
- [x] Add real TCP server and probe-client binaries using `TcpListener` and `TcpStream`.
- [x] Add a controllable fault proxy with per-direction delay and deterministic every-Nth connection loss/failure injection.
- [x] Add a self-contained loopback experiment runner using ephemeral localhost ports.
- [x] Reproduce the browser model's latency/loss expectations against measured real-socket behavior.
- [x] Emit baseline, impaired, expected, and measured outcomes as machine-readable JSON.
- [x] Keep exact wall-clock timing outside deterministic correctness assertions and benchmark claims.
- [x] Keep output compatible with capture by runtime-profiler without making it a hard dependency.
- [x] Add real-socket integration tests plus Rust formatting, Clippy, tests, and experiment smoke validation in CI.
- [x] Publish a dedicated `/native` teaching page with the process topology, commands, and measurement boundary.

### Slice 6 — deeper systems topics

- [x] Add a bounded LRU cache model with TTL expiry and invalidate-on-write versus TTL-only semantics.
- [x] Expose cache hits, misses, stale reads, origin fetches, invalidations, evictions, and read latency.
- [x] Compare modulo sharding with a virtual-node consistent-hash ring when one node is added.
- [x] Expose key movement, shard key counts, weighted request load, and hot-key skew.
- [x] Compare no admission control, token-bucket rate limiting, and concurrency limiting under a deterministic burst.
- [x] Expose rejected work, peak in-flight work, and admissions beyond the backend concurrency envelope.
- [x] Model connection reuse, handshake cost, fixed-size pools, fan-out, deterministic slow children, and FIFO head-of-line queueing.
- [x] Add CAP/PACELC-oriented scenarios grounded in per-operation outcomes, latency, stale reads, divergent writes, and reconciliation work.
- [x] Publish all five mechanisms as a dedicated `/systems` GitHub Pages lesson.
- [x] Add explicit model contracts and deterministic tests for every Slice 6 tradeoff.

### Slice 7A — global multiplayer ingress

- [x] Model one logical multiplayer hostname in front of Frankfurt, Virginia, and Singapore signaling regions.
- [x] Compare round-robin, geographic-proximity, and modeled latency-aware routing.
- [x] Remove unhealthy regions from routing and expose explicit health failover.
- [x] Model healthy-but-degraded regions through deterministic added RTT.
- [x] Keep client-to-region RTT values as teaching constants rather than infrastructure benchmark claims.
- [x] Publish a dedicated `/global` lesson with per-region routing evidence and a request trace.
- [x] Keep room authority, WebRTC gameplay, TURN, DNS internals, and provider-specific routing outside this slice.
- [x] Add a dedicated global-ingress contract and deterministic tests.

## Global multiplayer roadmap

### Slice 7B — regional room authority and directory — integrated

- [x] Give each newly created room exactly one home region rather than replicating live room/WebSocket state everywhere.
- [x] Add a small deterministic global `room -> region` directory model.
- [x] Show how two clients independently routed to different ingress regions converge on the same room owner.
- [x] Compare direct redirect, ingress proxying, and directory lookup costs without hiding their extra hops.
- [x] Compare room-placement policies such as creator-nearest, fixed region, minimum average RTT, and minimum worst-player RTT.
- [x] Model stale or unavailable directory entries fail-closed before adding any production multi-instance state to `multiplayer-setup-service`.

### Slice 7C — control-plane versus gameplay latency

- [ ] Separate room-create/join latency, WebSocket signaling latency, ICE negotiation time, and established gameplay RTT.
- [ ] Demonstrate that moving the signaling region can improve setup latency without changing a direct peer-to-peer gameplay path.
- [ ] Compare full-mesh and host-spoke multiplayer latency geometry, including the importance of host location in host-spoke mode.
- [ ] Add a TURN-relay mode where relay geography becomes part of the gameplay data path.
- [ ] Compare direct-first ICE with regional TURN fallback while keeping TURN credential/policy ownership outside the signaling-room model.

### Slice 7D — regional multiplayer failure and recovery

- [ ] Fail and partition individual signaling regions and the global room directory independently.
- [ ] Distinguish rooms that are still establishing WebRTC from games whose peer DataChannels are already established.
- [ ] Model reconnect/ICE-recovery cases where the control plane becomes necessary again after initial setup.
- [ ] Fail individual TURN regions independently from signaling regions.
- [ ] Reuse the existing recovery lesson's detection, failover, terms, and fencing concepts where they genuinely apply instead of duplicating them.
- [ ] Add native multi-process or multi-host measurements only after the deterministic failure semantics are stable.

## Further horizons

- Add packet-level delay, loss, reordering, jitter, and congestion only through an explicit OS/network-emulation contract; do not mislabel the TCP stream proxy as packet-level netem.
- Reproduce selected cache, shard, admission-control, and global-ingress scenarios with real multi-process native experiments.
- Compare persistent HTTP/TCP connection reuse with the deterministic pool model using measured native evidence.
- Add richer causal/conflict-resolution exhibits only when there is a concrete trace that needs vector clocks, CRDTs, or similar machinery.
- Extract reusable production kernels only after a lab experiment proves a stable cross-repository owner is warranted.
