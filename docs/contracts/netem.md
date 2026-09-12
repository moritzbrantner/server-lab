# Packet-level network-emulation contract

Slice 10 introduces Linux network namespaces and `tc netem` so impairment occurs in the kernel packet path rather than inside the application request proxy.

## Boundary

The experiment creates two isolated Linux network namespaces connected by a veth pair:

`client namespace -> veth/netem -> server namespace`

The repository's existing TCP server/client binaries and a small UDP sequence probe run inside those namespaces. No impairment is implemented in application code.

This distinction matters: the existing fault proxy is still useful for deterministic request/connection-level teaching, but it must not be described as packet loss, packet reordering, jitter, or link-rate emulation.

## Scenarios

### Fixed packet delay over TCP

A fixed 30 ms egress delay is applied in both directions. The TCP client then exercises real socket traffic through the qdiscs.

The correctness gate is directional rather than an exact benchmark: all requests must still succeed and measured mean round-trip latency must increase by a broad lower bound. Exact timing remains noisy operating-system evidence.

### Gap-based packet reordering over UDP

The client egress qdisc combines fixed delay with `reorder 100% gap 5`. The 100% reorder probability and fixed gap provide the deterministic acceptance case, while the UDP probe sends monotonically numbered datagrams and records whether echoed sequence numbers arrive out of order.

The gate requires observable reordering, not a precise timing distribution.

### Loss, jitter, duplication, and rate limiting over UDP

A second netem qdisc combines delay variation, random packet loss, duplication, and a fixed link-rate limit. The UDP sequence probe records delivered, lost, duplicate, and reordered datagrams, while `tc -s qdisc` output is retained in the experiment receipt.

The installed iproute2 version on the authoritative runner does not expose the newer netem `seed` option, so random-number-generator reproducibility is deliberately not part of this contract. The gate requires that communication remains observable and packet loss is actually observed over a sufficiently large sample. Exact loss, jitter, duplication, throughput, and timing values are evidence only.

## Required invariants

1. Network impairment is implemented with kernel qdiscs on isolated namespace interfaces, never by delaying application handlers.
2. Namespace and process cleanup occurs on successful or failed experiment exit.
3. Baseline TCP communication succeeds before impairment is applied.
4. Fixed-delay TCP evidence demonstrates a clear latency increase without asserting exact timing.
5. The deterministic gap-reordering scenario observes packet reordering through sequence numbers.
6. The mixed lossy UDP scenario observes actual packet loss and records qdisc statistics without treating RNG outcomes as exact correctness data.
7. No result is presented as production Internet/provider performance.
8. CI failure means the repository can no longer reproduce the claimed packet-level semantics on its authoritative Linux runner.

## Current limitations

This first packet-level slice is deliberately Linux-only and single-host. Network namespaces create real isolated kernel paths, but they do not reproduce physical WANs, NIC hardware, provider routing, or geographic Internet behavior.

TCP can hide packet loss and reordering through retransmission and ordering semantics, which is why UDP sequence evidence is included separately. Netem timing is also subject to kernel timer granularity and scheduler effects. A later experiment can run the authoritative WebTransport/QUIC adapter through the same namespace/netem harness without changing the network-emulation ownership boundary.

## Possible `server-setup` extraction boundary

The useful reusable concept is not the teaching script itself. A future `server-setup` integration could expose an optional Linux test-topology capability that creates isolated namespaces/links, applies declared impairment profiles, runs a supplied workload, and captures receipts.

It should remain opt-in test infrastructure. Production networking must never accidentally inherit netem qdiscs from the laboratory path.
