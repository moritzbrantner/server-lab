# Native network experiment contract

Slice 5 adds real localhost networking beside the deterministic browser models. Its purpose is to compare simplified expectations with observable operating-system and socket behavior without turning `server-lab` into a production server framework.

## Surfaces

The `server-lab-native` crate exposes five experiment binaries:

- `server` — a small TCP request/response server with configurable service delay;
- `client` — a probe client that records success and real elapsed latency;
- `fault-proxy` — a TCP proxy that can add deterministic delay and drop every Nth accepted request;
- `experiment` — a self-contained loopback runner that compares a direct baseline with an impaired proxy path and prints machine-readable JSON;
- `multiplayer-recovery-experiment` — a coordinator that spawns independent directory, signaling, direct-gameplay, and TURN processes, terminates them independently, and records the resulting socket-level recovery semantics.

The shared library owns the basic socket primitives used by the original server/proxy/client experiments. The multiplayer recovery runner deliberately uses separate OS processes so service-lifetime independence is measured rather than simulated inside one deterministic function.

## Protocol

The teaching protocol is deliberately tiny:

```text
PING <request-id>\n
PONG <request-id>\n
```

The multiplayer recovery child services use an even smaller process-health probe:

```text
PING\n
PONG <service-name>\n
```

These protocols intentionally avoid HTTP framework behavior, production signaling formats, TLS, WebRTC, TURN allocation messages, or application-specific routing. The experiments test process/socket boundaries and failure independence, not production protocol compatibility.

## Fault proxy semantics

The proxy operates at request/connection granularity, not packet granularity.

For each accepted connection it may:

- close every Nth connection before forwarding it;
- wait a configured delay before forwarding the request upstream;
- wait the same delay before forwarding the response downstream.

Therefore a configured `D` millisecond one-way proxy delay should add roughly `2 × D` milliseconds to successful request latency, plus ordinary scheduling and socket noise.

The drop policy is deterministic by accepted-connection ordinal. It is not a model of random packet loss.

## Measurement semantics

Native latency uses `std::time::Instant` around real connect/write/read round trips.

The ordinary client reports:

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

## Native multiplayer recovery evidence

`multiplayer-recovery-experiment` reproduces the stable Slice 7D dependency boundaries with real child processes and real loopback TCP sockets.

The coordinator starts independent processes representing:

- the global room directory;
- the selected signaling service;
- an already-established direct gameplay path;
- the active TURN relay.

It then terminates services independently and verifies these semantic outcomes:

1. baseline directory, signaling, direct gameplay, and relay paths are reachable;
2. killing the directory blocks new setup while the established direct path remains reachable;
3. killing signaling blocks the modeled ICE-restart dependency while the established direct path remains reachable;
4. killing the active TURN process does not affect direct gameplay but makes the modeled relayed path unreachable;
5. explicit TURN replacement succeeds only when a replacement relay and signaling are both reachable.

A fresh replacement signaling/TURN process uses a fresh ephemeral socket. The experiment is testing service-process independence rather than TCP port rebinding behavior.

The report includes observed probe latency, but `expectationsHold` depends only on the reachability/dependency semantics above. Loopback timing is not used as evidence for regional latency or provider performance.

This is deliberately **multi-process, single-host evidence**. It validates that the deterministic 7D dependency model can be reproduced across real process/socket boundaries; it does not claim validation against real regional WebRTC, DNS, signaling, or TURN infrastructure.

## CI boundary

CI runs:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo run --quiet --locked -p server-lab-native --bin experiment -- 10 5 5 1 1000
cargo run --quiet --locked -p server-lab-native --bin multiplayer-recovery-experiment
```

The integration tests and experiment processes use ephemeral localhost ports. Native timing remains evidence, while semantic outcomes are the gate.

## runtime-profiler boundary

Native experiment output is machine-readable JSON so it can be captured by `runtime-profiler` or other experiment tooling without making `runtime-profiler` a hard dependency of this lab.

Timing claims should remain experiment receipts, not correctness gates. CI only checks that the native experiments behave semantically as configured and that the expected-vs-measured comparison is directionally consistent where a directional timing expectation exists.

## Non-goals

The native experiments do not currently claim or benchmark:

- production HTTP/1.1, HTTP/2, HTTP/3, TLS, QUIC, DNS, WebRTC, or TURN protocol behavior;
- packet-level loss, reordering, duplication, bandwidth, or congestion;
- kernel queue tuning or socket-buffer sizing;
- multi-host or geographically distributed orchestration;
- production load generation;
- statistically rigorous benchmarking.

Those should be introduced only as later experiments with explicit ownership and measurement contracts.
