# `server-setup` extraction candidates

Slices 8–10 deliberately prove behavior inside `server-lab` before moving any generic infrastructure into another owner. This note records the parts that may become useful to `server-setup` later without committing to an extraction yet.

## Candidate 1: region placement

A reusable region selector could accept:

- stable workload identity;
- eligible regions;
- health state;
- hard capacity and current load evidence;
- participant or caller latency evidence;
- an explicit placement policy.

It would return a deterministic region decision plus enough explanation/evidence to reproduce that decision. It would not own multiplayer room semantics, game rules, DNS, provider provisioning, or persistence.

## Candidate 2: process distribution

A reusable intra-region scheduler could accept:

- an already-selected region;
- stable workload identity and demand;
- discovered hosts/processes;
- failure-domain identity;
- health and drain state;
- hard capacity/current load;
- an explicit scheduling policy.

It would return one deterministic target process or fail closed. It must never reinterpret a region-local capacity failure as permission to migrate the workload to another region.

## Candidate 3: network impairment test topology

An opt-in Linux test capability could:

- create isolated network namespaces and links;
- apply declared `tc netem` impairment profiles;
- run caller-supplied workloads;
- capture machine-readable traffic/experiment receipts;
- guarantee cleanup on success or failure.

This capability is test infrastructure only. Its contract must make it impossible for a production interface to accidentally inherit laboratory qdiscs.

## Extraction rule

Do not move these into `server-setup` merely because the lab implementation exists. Extraction is justified when at least one concrete `server-setup` workflow needs the generic contract and the lab evidence shows that the boundary remains stable under another real consumer. Keep domain-specific adapters in their owning repositories.
