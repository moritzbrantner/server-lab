# Deterministic simulation contract

The browser laboratory uses a deliberately small discrete request model. Its purpose is explanation and comparison, not infrastructure benchmarking.

## Determinism

For a fixed configuration and seed, the simulator must produce the same request arrivals, assignments, queue decisions, completion times, event trace, and summary metrics.

The simulator therefore:

- uses an explicitly seeded pseudo-random generator;
- never reads wall-clock time while running a scenario;
- derives steady and burst request arrivals from configuration;
- derives random load-balancer choices and latency jitter from the seeded generator;
- uses stable node and worker ordering to break ties;
- models backpressure by moving simulated arrival times, never by sleeping.

## Topology

A scenario contains:

- a client/request source;
- one logical load balancer;
- one or more replicated server nodes;
- configurable worker concurrency per node;
- a bounded waiting queue per node;
- configurable one-way network latency and service time;
- optional node failures.

For a successful request, modeled end-to-end latency is:

`outbound network delay + queue delay + service time + inbound network delay`

The model does not represent packet-level behavior, TCP, connection establishment, serialization, kernel scheduling, or shared downstream dependencies. Those belong in later native experiments.

## Arrival model

Steady traffic uses a fixed inter-arrival interval derived from `requestsPerSecond`.

An optional burst compresses the interval for a configured range of request indices by a fixed multiplier. A request keeps both:

- its **scheduled arrival**, representing when the producer would like to send it;
- its **actual arrival**, which may be later when client backpressure is enabled.

Client backpressure limits the number of already accepted requests that may still be outstanding. When the limit is reached, the next actual arrival moves to the earliest completion that frees capacity. This is intentionally different from a server queue: waiting occurs at the producer rather than after admission.

## Load-balancing policies

The simulator supports:

- **Round robin** — choose the next healthy node in stable order.
- **Least connections** — choose the healthy node with the fewest accepted requests still in service or queued; break ties by stable node order.
- **Seeded random** — choose a healthy node using the scenario RNG.

## Worker and queue model

Each node owns a fixed number of workers. An admitted request starts immediately when a worker is available. Otherwise its service start is scheduled behind the worker that becomes free first.

The waiting queue contains admitted requests whose service has not started yet. `queueCapacity` counts waiting requests only; active workers do not consume queue slots.

A request already assigned before a later node failure is allowed to finish. Abrupt connection loss and retry semantics remain a later slice.

## Overload policies

When no worker is immediately available:

- **Reject when busy** — fail immediately with `over-capacity`.
- **Bounded queue** — enqueue while space remains; otherwise fail with `queue-full`.
- **Shed by wait budget** — admit only when the queue has space and projected queue delay is at or below `maxQueueWaitMs`; otherwise fail with `shed-load`.

If no healthy replica exists at routing time, the request fails with `no-healthy-node` before overload policy is considered.

## Metrics

The simulator reports:

- attempted, successful, failed, queued, shed, and overload-dropped requests;
- availability = successful / attempted;
- measured actual arrival rate and successful throughput;
- nominal service capacity from worker count and configured service time;
- mean, p50, and p95 successful-request latency;
- mean and p95 queueing delay;
- mean producer delay caused by backpressure;
- per-node routed, successful, rejected, peak-outstanding, and peak-queue counts.

Latency and queue percentiles use nearest-rank selection over sorted successful-request values.

## Little's Law

The teaching surface computes:

- `L`: time-averaged number of successful requests in the modeled end-to-end system;
- `lambda`: successful throughput over the fully observed trace;
- `W`: mean successful end-to-end latency.

It then displays measured `L` beside `lambda * W`. Because the finite trace is observed through the final completion, these values should agree apart from floating-point rounding. This is an accounting identity for the simulator, not a claim that an overloaded production system is necessarily in steady state.

## Ownership boundary

These types and calculations belong to `server-lab` while they are teaching-specific. If a later native experiment proves a generally reusable routing or systems primitive, extraction must preserve this simulator as a consumer rather than turning the lab into the owner of production infrastructure code.
