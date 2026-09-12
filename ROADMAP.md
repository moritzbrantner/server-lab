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

### Slice 7C — control-plane versus gameplay latency — integrated

- [x] Separate room-create/join latency, WebSocket signaling latency, ICE negotiation time, and established gameplay RTT.
- [x] Demonstrate that moving the signaling region can improve setup latency without changing a direct peer-to-peer gameplay path.
- [x] Compare full-mesh and host-spoke multiplayer latency geometry, including the importance of host location in host-spoke mode.
- [x] Add a TURN-relay mode where relay geography becomes part of the gameplay data path.
- [x] Compare direct-first ICE with regional TURN fallback while keeping TURN credential/policy ownership outside the signaling-room model.

The deterministic `/global` lesson separates control-plane setup from established gameplay paths and makes TURN geography explicit only when the relay is actually on the data path.

### Slice 7D — regional multiplayer failure and recovery — completed

- [x] Fail and partition individual signaling regions and the global room directory independently.
- [x] Distinguish rooms that are still establishing WebRTC from games whose peer DataChannels are already established.
- [x] Model reconnect/ICE-recovery cases where the control plane becomes necessary again after initial setup.
- [x] Fail individual TURN regions independently from signaling regions.
- [x] Reuse the existing recovery lesson's detection, failover, terms, and fencing concepts where they genuinely apply instead of duplicating them.
- [x] Add native multi-process reproduction once deterministic failure semantics are stable.

The deterministic `/global` lesson models lifecycle-scoped signaling, directory, and TURN failure; explicit ICE restart, room rejoin, and relay reallocation; and stateful directory-authority recovery using the existing election term and fencing model. Stateless signaling and TURN remain outside that election contract.

The native `multiplayer-recovery-experiment` launches independent loopback processes for directory, signaling, direct gameplay, and TURN, kills them independently, and gates the expected dependency separation using real sockets. Its wall-clock timings are evidence only and are not presented as regional/provider measurements.

## Placement, distribution, and packet-level networking roadmap

### Slice 8 — multi-region fleet placement — completed

- [x] Move beyond single-room placement and evaluate a deterministic fleet of many rooms.
- [x] Enforce regional health and hard capacity before considering placement score.
- [x] Compare minimum-average RTT and minimum-worst-player RTT.
- [x] Add latency-plus-load scoring as an explicit tradeoff rather than hiding capacity pressure inside RTT.
- [x] Add rendezvous hashing for stable ownership and deterministic remapping.
- [x] Add power-of-two choices with deterministic candidate selection and load-aware choice.
- [x] Measure failed placements, mean/worst player RTT, per-region utilization, forced moves, and cascade churn.
- [x] Verify that rendezvous hashing causes no avoidable moves from still-healthy owners after one region fails when spare capacity exists.
- [x] Publish the fleet-placement comparison in `/global` and document a narrow possible `server-setup` extraction contract.

Slice 8 owns only the region decision. It consumes health, capacity/load evidence, stable room identity, and deterministic participant-latency evidence. It does not provision servers or own game rules.

### Slice 9 — hierarchical server distribution — completed

- [x] Preserve the Slice 8 region decision as an input rather than recomputing it during process scheduling.
- [x] Model `room -> region -> host/failure domain -> process` explicitly.
- [x] Enforce health, drain state, and hard process capacity.
- [x] Fail closed when a region has no eligible process instead of silently spilling to another region.
- [x] Compare round-robin, least-loaded, rendezvous hashing, and power-of-two choices inside each region.
- [x] Distinguish host failure from graceful draining.
- [x] Classify forced moves separately from cascade churn after a host failure.
- [x] Verify rendezvous stability on still-healthy processes when remaining capacity is sufficient.
- [x] Publish the process-distribution comparison in `/global` and document the generic scheduler boundary that may later fit `server-setup`.

Slice 9 establishes a generic infrastructure-shaped scheduling boundary without claiming that the lab owns real host discovery, cloud provisioning, containers, deployment rollout, persistence, or live game-state migration.

### Slice 10 — packet-level network emulation — completed

- [x] Keep the existing Rust fault proxy explicitly request/connection-level rather than mislabeling it packet loss.
- [x] Create isolated Linux client/server network namespaces connected by a veth pair.
- [x] Apply real kernel `tc netem` qdiscs rather than sleeping inside application handlers.
- [x] Demonstrate fixed packet delay through real TCP sockets with a broad directional latency gate.
- [x] Add a numbered UDP echo probe so packet loss, duplication, and reordering are visible to the application.
- [x] Add a deterministic gap-reordering acceptance scenario.
- [x] Add a mixed delay/jitter/loss/duplication/rate scenario and retain `tc -s qdisc` evidence.
- [x] Keep noisy RNG/timing outcomes as evidence rather than exact deterministic correctness claims.
- [x] Clean namespaces and child processes on success or failure.
- [x] Run the packet-level experiment as a Linux CI gate and publish the boundary on `/native`.

The netem slice is single-host kernel evidence, not a claim about physical WANs, provider routing, or geographic Internet performance. Its useful future extraction boundary is an opt-in test-topology capability; production interfaces must never inherit laboratory qdiscs.

## Server-authoritative multiplayer roadmap

This track is the client-to-server sibling of the P2P architecture explored through `multiplayer-setup-service`. It lives in the isolated `authoritative` crate so transport choice cannot redefine game authority.

### Slice A — deterministic authority kernel — integrated

- [x] Add one server-owned 20 Hz world for up to 16 players.
- [x] Assign identity from the accepted connection rather than trusting a player id in input payloads.
- [x] Keep client input intent-only and apply state mutation only on authoritative ticks.
- [x] Ignore duplicate/stale input idempotently with monotonic sequences.
- [x] Emit bounded canonical snapshots and deterministic state hashes.
- [x] Add a native TCP harness with fail-closed admission cleanup and latest-state backpressure.

### Slice B — WebTransport / HTTP/3 — integrated

- [x] Add a Rust WebTransport/QUIC adapter without moving authority semantics out of the kernel.
- [x] Send session/welcome metadata over a reliable unidirectional stream.
- [x] Use bounded datagrams for realtime client input and authoritative snapshots.
- [x] Require sufficient datagram capacity and explicit TLS identity configuration.
- [x] Add a browser-to-Rust client proof and lock the Rust dependency graph in CI.

### Slice C — client presentation prediction and reconciliation — integrated

- [x] Predict only the local player's presentation state and keep server snapshots canonical.
- [x] Use authoritative `lastAppliedSequence` to prune acknowledged local inputs.
- [x] Bound local visual prediction and reset it from newer canonical snapshots.
- [x] Interpolate remote players without extrapolating them beyond the newest server state.
- [x] Add deterministic presentation tests and a browser bundle gate.

Gameplay-specific services such as inventory transactions, persistence, match recovery, authoritative physics, and live multi-process world migration are intentionally not unfinished transport work. They should be introduced only for a concrete game that needs them and should reuse their proper owning repositories where possible.

## Further horizons

These are research/experiment directions rather than incomplete roadmap commitments:

- Run the authoritative WebTransport/QUIC transport through the established namespace/netem harness and compare stream versus datagram behavior under identical impairments.
- Reproduce selected fleet-placement and host/process-distribution scenarios with real multi-host or multi-region infrastructure when a concrete production decision justifies the cost.
- Reproduce selected cache, shard, and admission-control scenarios with real native processes when there is a concrete measurement question.
- Compare persistent HTTP/TCP connection reuse with the deterministic pool model using measured native evidence.
- Run multiplayer recovery across actual hosts/regions only when there is a concrete infrastructure decision to validate.
- Add richer causal/conflict-resolution exhibits only when there is a concrete trace that needs vector clocks, CRDTs, or similar machinery.
- Extract reusable production kernels into repositories such as `server-setup` only after the lab contract has proved stable and more than one concrete consumer benefits from the abstraction.
