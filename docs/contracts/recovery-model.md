# Recovery and coordination contract

Slice 4 adds deterministic recovery and coordination exhibits beside the routing/capacity and replication/consistency models.

The goal is to make the time between **physical failure**, **failure detection**, **traffic recovery**, and **leadership recovery** explicit. These are different events and should never be collapsed into one generic "failover" timestamp.

## Service recovery model

The service-recovery exhibit owns a single active endpoint plus ordered standby endpoints.

Each node has:

- a stable id;
- a failure domain;
- service and network latency;
- zero or more physical failure windows.

A physical failure does not instantly change routing. Routing changes only after the configured health model detects the failure and the configured failover delay completes.

### Active health checks

Active checks occur on a fixed deterministic interval.

A node is marked unhealthy after `healthFailureThreshold` consecutive check opportunities inside a physical failure window. Detection therefore depends on:

- failure start time;
- check interval;
- failure threshold.

No wall clock, sleeping, or random scheduler is involved.

### Passive health checks

Passive detection learns only from failed backend attempts.

A node is marked unhealthy after the configured number of observed backend failures. A low request rate can therefore make passive detection slower even when the underlying physical outage is identical.

Circuit-breaker short circuits are not backend observations and do not count toward passive health detection.

## Failover

Failure detection and failover are separate phases.

After the active node is marked unhealthy:

1. a failover-start event is emitted;
2. traffic has no promoted active endpoint during `failoverDelayMs`;
3. the first physically healthy standby in stable order becomes active when promotion completes.

The simulator records the first detection time, first failover completion time, and recovery window from physical failure start to promoted standby.

## Retries and amplification

Retries are bounded by `maxRetries`.

Retry `n` waits:

`baseBackoffMs × 2^n + deterministic jitter`

Jitter comes only from the seeded pseudo-random generator.

The model records both total logical attempts and backend attempts. Short-circuited requests remain logical attempts but do not add backend load.

`retryAmplification = backend attempts / logical requests`

This metric is intentionally about added backend pressure, not merely how many times application code entered a retry loop.

## Circuit breaker

Circuit state is tracked per backend node.

- **Closed** — backend attempts are allowed; consecutive failures are counted.
- **Open** — backend attempts are short-circuited until the open interval expires.
- **Half-open** — one deterministic probe is allowed after the open interval.

A successful half-open probe closes the circuit. A failed half-open probe opens it again.

Failing over to a different node therefore reaches that node's independent breaker state rather than inheriting the failed node's open circuit.

## Failure domains and availability composition

The lab includes two explicit availability helpers.

For independent parallel replicas:

`A = 1 - product(1 - A_i)`

For replicas inside one shared failure domain:

`A_domain_service = A_domain × (1 - (1 - A_node)^replicas)`

Independent domains are then composed in parallel.

This makes the main lesson explicit: three replicas inside one rack, zone, process, or other shared domain do not provide the same availability as three replicas across independent domains.

The calculation assumes the supplied domain probabilities are independent of each other. It is a teaching model, not a complete probabilistic reliability system.

## Minimal leader-election exhibit

The coordination exhibit deliberately comes after failure detection and failover timing.

It models:

- one initial leader;
- periodic leader heartbeats;
- an election timeout after the last observed heartbeat;
- a new monotonically increasing term/epoch;
- deterministic candidate selection in stable node-id order;
- majority availability as a prerequisite for election;
- a fixed election duration;
- the term as a fencing token.

If a majority is available, the selected candidate becomes leader in the new term. If a majority is unavailable, no leader is elected.

When the old leader recovers after a successful election, a write carrying its stale term is rejected because its fencing token is lower than the current term.

## Deliberate non-goals

Slice 4 is not Raft, Paxos, Viewstamped Replication, or another named consensus implementation.

It does not model:

- replicated logs;
- log matching or rollback;
- concurrent candidates;
- randomized election timeouts;
- membership changes;
- leases or clock assumptions;
- durable storage;
- split-brain conflict resolution;
- real network sockets or process scheduling.

A named consensus algorithm should be introduced only when the lab has a concrete lesson that requires those additional contracts.
