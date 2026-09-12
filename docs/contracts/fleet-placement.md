# Multi-region fleet placement contract

Slice 8 extends the single-room authority lesson into deterministic fleet-level placement. It remains teaching/research evidence, not a provider benchmark or a production scheduler.

## Purpose

The model answers a narrower question than `server-setup` eventually would: given a fixed set of eligible regions, deterministic participant RTT evidence, room demand, and bounded regional capacity, how do different placement algorithms trade latency, load balance, and ownership stability?

It deliberately does not provision machines, create DNS records, move real processes, or own game rules.

## Inputs

Each room contributes:

- a stable room id;
- one or more participant site ids;
- a bounded demand value expressed as abstract capacity units.

Each region contributes:

- a stable region id;
- health eligibility;
- a hard capacity limit.

Client-to-region RTT values are the same deterministic teaching constants used elsewhere in the `/global` lesson. They are not measured Internet or provider performance.

## Algorithms

Slice 8 compares five deterministic policies:

1. **Minimum average RTT** — select the eligible region with the smallest mean participant RTT.
2. **Minimum worst-player RTT** — minimize the largest participant RTT.
3. **Latency + current load** — add a bounded utilization penalty to mean participant RTT.
4. **Rendezvous hashing** — select the eligible region with the highest stable room/region hash score.
5. **Power of two choices** — deterministically derive two eligible candidates, then select the lower-utilization candidate with latency as a tie-breaker.

All policies are capacity-aware. A room is rejected rather than overcommitting a region when no healthy candidate has sufficient remaining capacity.

## Failure comparison

The model reruns the same workload after one region becomes unavailable and classifies ownership changes as:

- **forced moves** — the room's previous owner is the failed region;
- **cascade churn** — the previous owner remains healthy but the policy moves the room anyway;
- **unchanged** — the room remains on its prior owner.

This distinction is part of the acceptance contract. Stability is not inferred merely from total moved-room counts.

## Required invariants

1. An unhealthy region never receives a new room placement.
2. Used capacity never exceeds configured regional capacity.
3. Lack of eligible capacity fails closed by rejecting the room.
4. Workload generation and every policy decision are deterministic for identical inputs.
5. Rendezvous hashing moves no room from a still-healthy owner after one region fails when the remaining regions have sufficient capacity.
6. Failure comparison reports forced movement separately from avoidable cascade churn.
7. Latency values remain model constants and are not described as measured network performance.

## Possible `server-setup` extraction boundary

If a later production repository needs this capability, the reusable boundary should be small: an input contract describing eligible regions, health, capacity/load evidence, participant latency evidence, and stable workload identity; plus a deterministic placement decision and explanation.

Provider discovery, provisioning, server process lifecycle, DNS, persistence, and game-domain authority remain outside this slice. Slices 9 and 10 must establish the distribution and network-measurement boundaries before any larger extraction is justified.
