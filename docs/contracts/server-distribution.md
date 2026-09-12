# Hierarchical server distribution contract

Slice 9 starts only after Slice 8 has assigned each room one regional authority. Its job is narrower: distribute region-owned rooms across eligible server processes without reopening the region decision.

## Hierarchy

The teaching topology is explicit:

`room -> region authority -> host/failure domain -> server process`

A process belongs to exactly one host and one region. A room can be assigned only to a process in its already-selected region.

## Process eligibility

A process is eligible for new placement only when:

- its region matches the room authority;
- it is healthy;
- it is not draining;
- it has enough remaining hard capacity for the room demand.

If no process is eligible, placement fails closed. The scheduler never silently moves the room to another region to make capacity appear available.

## Distribution algorithms

Slice 9 compares:

1. **Round robin** — stable process ordering with a region-local cursor.
2. **Least loaded** — minimum current utilization, then stable process id.
3. **Rendezvous hashing** — stable room/process hashing for ownership stability.
4. **Power of two choices** — deterministic two-candidate sampling followed by lower utilization.

## Failure domains and draining

A host id is also the initial failure-domain boundary. Failing one host marks every process in that host unavailable while processes on the sibling host remain eligible.

Draining is distinct from failure: draining processes are healthy but receive no new placements. This establishes the boundary needed for graceful maintenance without pretending that drain and crash have identical semantics.

## Required invariants

1. A room is never assigned outside its regional authority.
2. Unhealthy or draining processes receive no new placements.
3. Used process capacity never exceeds configured process capacity.
4. Failure of one host excludes every process in that failure domain without implicitly failing the region.
5. Lack of region-local process capacity rejects the room instead of cross-region spilling.
6. Rendezvous hashing preserves assignments on still-healthy processes after one host fails when remaining process capacity is sufficient.
7. Failure comparison distinguishes forced moves from cascade churn.
8. All decisions remain deterministic for identical topology and workload inputs.

## Possible fleet-scheduler extraction boundary

This slice is infrastructure-shaped but remains above host bootstrap. A reusable fleet scheduler could consume discovered process topology, health, drain state, capacity, failure-domain identity, and stable workload identity, then return a deterministic target process inside the already-selected region.

`game-server` should expose truthful process/match capacity, readiness, and drain state; a fleet scheduler can consume those facts. `server-setup` may expose or validate host-level facts and prerequisites, but application/process placement is outside its current host-management boundary.

Actual host discovery, cloud provisioning, containers, service managers, deployment rollout, persistence, and game state migration remain outside the lab model until concrete production requirements prove those interfaces.
