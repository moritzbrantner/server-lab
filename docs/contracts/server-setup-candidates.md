# Cross-repository extraction candidates

Slices 8–10 prove several reusable-looking boundaries inside `server-lab`, but they do not all belong to `server-setup`. The later repository review made the ownership split explicit: `server-setup` manages and validates hosts, while application placement, replicas, load balancing, and application routing belong above that host boundary.

## Candidate 1: region placement — fleet/game-server scheduler

A reusable region selector could accept:

- stable workload identity;
- eligible regions;
- health state;
- hard capacity and current load evidence;
- participant or caller latency evidence;
- an explicit placement policy.

It would return a deterministic region decision plus enough explanation/evidence to reproduce that decision. It would not own multiplayer room semantics, game rules, DNS, provider provisioning, or persistence.

This is **not** a `server-setup` responsibility under its current architecture. The natural owner is a future fleet scheduler beside `game-server`, once real multi-host hosting provides a second concrete consumer for the contract.

## Candidate 2: process distribution — fleet/game-server scheduler

A reusable intra-region scheduler could accept:

- an already-selected region;
- stable workload identity and demand;
- discovered hosts/processes;
- failure-domain identity;
- health and drain state;
- hard capacity/current load;
- an explicit scheduling policy.

It would return one deterministic target process or fail closed. It must never reinterpret a region-local capacity failure as permission to migrate the workload to another region.

This also belongs above host bootstrap. `game-server` should first expose truthful per-process capacity, health, and drain facts; a fleet scheduler can then consume them without teaching `server-setup` about matches or application replicas.

## Candidate 3: network impairment test topology — possible `server-setup` test capability

An opt-in Linux test capability could:

- create isolated network namespaces and links;
- apply declared `tc netem` impairment profiles;
- run caller-supplied workloads;
- capture machine-readable traffic/experiment receipts;
- guarantee cleanup on success or failure.

This capability is host-level test infrastructure, so it is the one Slice 10 extraction that plausibly fits `server-setup`. It must remain opt-in/disposable-host functionality, and its contract must make it impossible for a production host configuration to accidentally inherit laboratory qdiscs.

## Host facts that may support a scheduler

`server-setup` may eventually expose or validate host facts without making placement decisions itself, for example:

- region / failure-domain labels supplied by deployment configuration;
- CPU and memory capacity diagnostics;
- health/readiness prerequisites;
- UDP/QUIC firewall and kernel prerequisites;
- a drain-intent or maintenance fact if a higher-level scheduler needs one.

Those are host facts. The algorithm that maps a match or workload onto a region/process remains outside `server-setup`.

## Extraction rule

Do not move a lab implementation merely because it looks reusable. Extraction is justified only when a concrete second consumer needs the same contract and the destination repository actually owns that responsibility. In particular, changing `server-setup` from host management into an application scheduler would require a deliberate architecture decision rather than an incidental code move.
