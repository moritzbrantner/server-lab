# Deterministic simulation contract

The browser laboratory uses a deliberately small discrete request model. Its purpose is explanation and comparison, not infrastructure benchmarking.

## Determinism

For a fixed configuration and seed, the simulator must produce the same request assignments, completion times, event trace, and summary metrics.

The simulator therefore:

- uses an explicitly seeded pseudo-random generator;
- never reads wall-clock time while running a scenario;
- derives request arrival times from the configured request rate;
- derives random load-balancer choices and latency jitter from the seeded generator;
- uses stable node ordering to break ties.

## Topology

A scenario contains:

- a client/request source;
- one logical load balancer;
- one or more replicated server nodes;
- configurable one-way network latency between the load balancer and servers;
- configurable service time per server;
- optional node failures.

A request is routed to one healthy server. Its modeled latency is:

`queue delay + outbound network delay + service time + inbound network delay`

The first slice does not model packet-level behavior, TCP, connection establishment, serialization, kernel scheduling, or shared downstream dependencies. Those belong in later native experiments.

## Load-balancing policies

The first slice supports:

- **Round robin** — choose the next healthy node in stable order.
- **Least connections** — choose the healthy node with the fewest requests still in flight at the request arrival time; break ties by stable node order.
- **Seeded random** — choose a healthy node using the scenario RNG.

## Failure semantics

A failed node is unavailable for new requests for the configured interval. Requests already assigned before the failure are allowed to complete in slice 1; later slices may model abrupt connection loss and retry behavior explicitly.

If no healthy node exists at an arrival time, the request fails immediately with the reason `no-healthy-node`.

## Metrics

The simulator reports:

- attempted requests;
- successful and failed requests;
- availability = successful / attempted;
- throughput over the modeled scenario duration;
- p50 and p95 successful-request latency;
- per-node routed request count;
- per-node peak in-flight request count.

Latency percentiles use nearest-rank selection over sorted successful-request latencies.

## Ownership boundary

These types and calculations belong to `server-lab` while they are teaching-specific. If a later native experiment proves a generally reusable routing or systems primitive, extraction must preserve this simulator as a consumer rather than turning the lab into the owner of production infrastructure code.
