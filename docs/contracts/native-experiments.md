# Native network experiment contract

Slice 5 adds real localhost networking beside the deterministic browser models. Its purpose is to compare simplified expectations with observable operating-system and socket behavior without turning `server-lab` into a production server framework.

## Surfaces

The `server-lab-native` crate exposes four binaries:

- `server` — a small TCP request/response server with configurable service delay;
- `client` — a probe client that records success and real elapsed latency;
- `fault-proxy` — a TCP proxy that can add deterministic delay and drop every Nth accepted request;
- `experiment` — a self-contained loopback runner that compares a direct baseline with an impaired proxy path and prints machine-readable JSON.

The shared library owns the actual socket primitives used by both binaries and tests.

## Protocol

The teaching protocol is deliberately tiny:

```text
PING <request-id>\n
PONG <request-id>\n
```

Each request uses one TCP connection. This intentionally avoids HTTP framework behavior, connection pools, TLS, keep-alive, multiplexing, serialization formats, or application-specific routing so the first native experiments expose the network path itself.

## Fault proxy semantics

The proxy operates at request/connection granularity, not packet granularity.

For each accepted connection it may:

- close every Nth connection before forwarding it;
- wait a configured delay before forwarding the request upstream;
- wait the same delay before forwarding the response downstream.

Therefore a configured `D` millisecond one-way proxy delay should add roughly `2 × D` milliseconds to successful request latency, plus ordinary scheduling and socket noise.

The drop policy is deterministic by accepted-connection ordinal. It is not a model of random packet loss.

## Measurement semantics

Native latency uses `std::time::Instant` around the real connect/write/read round trip.

The client reports:

- attempted requests;
- successful and failed requests;
- success rate;
- mean successful-request latency;
- p50 and p95 successful-request latency.

These measurements are intentionally **not deterministic**. Tests assert semantic outcomes and broad lower bounds rather than exact timing.

## Expected versus measured behavior

The `experiment` runner creates a backend server and a fault proxy on ephemeral localhost ports. It runs:

1. a direct baseline against the backend;
2. an impaired run through the proxy.

The report contains both measured summaries and simple expectations derived from configuration:

- expected successful requests after deterministic every-Nth dropping;
- expected added latency from the configured two proxy delay legs;
- measured added mean latency;
- an `expectationsHold` boolean used as a smoke gate.

This comparison is explanatory evidence, not a benchmark score.

## CI boundary

CI runs:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run --quiet -p server-lab-native --bin experiment -- 10 5 5 1 1000
```

The integration tests bind ephemeral localhost ports and exercise real `TcpListener` / `TcpStream` paths.

## runtime-profiler boundary

The native experiment output is machine-readable JSON so it can be captured by `runtime-profiler` or other experiment tooling without making `runtime-profiler` a hard dependency of this lab.

Timing claims should remain experiment receipts, not correctness gates. CI only checks that the native experiment behaves semantically as configured and that the expected-vs-measured comparison is directionally consistent.

## Non-goals

Slice 5 does not yet model or benchmark:

- HTTP/1.1, HTTP/2, HTTP/3, TLS, QUIC, or DNS;
- packet-level loss, reordering, duplication, bandwidth, or congestion;
- kernel queue tuning or socket-buffer sizing;
- multi-process orchestration across machines;
- persistent connections or connection pools;
- production load generation;
- statistically rigorous benchmarking.

Those should be introduced only as later experiments with explicit ownership and measurement contracts.
