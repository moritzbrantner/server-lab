# server-lab

`server-lab` is an interactive laboratory for learning how server systems behave under load, latency, replication, consistency, overload, failure, recovery, and coordination.

The repository uses two deliberately different surfaces:

- **Browser laboratory** — deterministic, visual simulations that can run on GitHub Pages.
- **Native experiments** — real processes, sockets, and operating-system/network behavior where simulation would hide the lesson. These come in later slices.

The browser lab is not presented as a benchmark of real infrastructure. Its job is to make system behavior inspectable and repeatable: the same seed and configuration must produce the same event trace and metrics.

## Browser curriculum

The teaching site has three top-level lessons.

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

The routing lesson includes steady-state, saturation, and burst presets while keeping the underlying controls available.

### Replication & consistency

A separate stateful version model teaches:

1. **Leaders and followers** — one write owner with explicit follower versions.
2. **Asynchronous replication** — immediate leader acknowledgement and a visible stale-read window.
3. **Synchronous replication** — waiting for all followers and exposing the latency/availability cost of the slowest replica.
4. **Write quorums** — majority acknowledgement that can continue past one lagging or partitioned follower.
5. **Eventual reads** — a responsive follower may still return an older version.
6. **Read-your-writes** — bounded waiting or leader fallback preserves a client's acknowledged session state.
7. **Read quorums** — majority reads expose why intersecting read/write quorums can recover the newest acknowledged version.
8. **Replica lag** — divergence is measured in versions and pending replication updates, not hidden inside generic latency.
9. **Partitions** — a follower can remain client-readable while its replication link to the leader is cut.

The replication lesson includes Eventual, Session, Quorum, and Partition presets plus the underlying acknowledgement, read-consistency, delay, jitter, timeout, and operation controls.

### Recovery & coordination

A third deterministic model makes recovery timing and coordination explicit:

1. **Active health checks** — failure detection depends on check interval and threshold.
2. **Passive health checks** — detection depends on observed failed requests and therefore traffic.
3. **Failover delay** — promotion happens after detection rather than at physical failure time.
4. **Bounded retries** — retry count and exponential backoff are visible in each logical request trace.
5. **Retry amplification** — backend attempts are measured separately from logical requests.
6. **Circuit breakers** — closed, open, and half-open states bound repeated backend failures.
7. **Failure domains** — replica availability is compared inside one shared domain and across independent domains.
8. **Leader failure** — heartbeat loss and election timeout are separate from the physical failure event.
9. **Terms and fencing** — a recovered stale leader cannot continue writing after a higher term elects a replacement.
10. **Majority requirement** — no leader is promoted when the surviving nodes cannot form a quorum.

The recovery lesson includes Fast failover, Retry storm, Circuit breaker, and Zone outage presets plus independent election controls.

## Development

```bash
cd web
bun install
bun run typecheck
bun test
bun run build
bun run dev
```

The teaching site is a static Next.js export suitable for GitHub Pages.

## Repository boundaries

`server-lab` owns educational scenarios, deterministic simulation models, visualizations, and experiments. Production-grade networking primitives or generally reusable algorithms should be extracted only after a concrete experiment proves they deserve a separate owner.

See [`ROADMAP.md`](ROADMAP.md) for the implementation slices, [`docs/contracts/simulation-model.md`](docs/contracts/simulation-model.md) for routing/capacity semantics, [`docs/contracts/replication-model.md`](docs/contracts/replication-model.md) for stateful replication, and [`docs/contracts/recovery-model.md`](docs/contracts/recovery-model.md) for recovery, failure-domain, and minimal election semantics.
