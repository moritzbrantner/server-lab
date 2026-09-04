# Deeper systems teaching contract

Slice 6 adds five deterministic browser models. They are intentionally separate because caching, sharding, admission control, flow scheduling, and partition tradeoffs have different state and failure semantics.

None of these models is a production implementation or benchmark.

## Shared rules

Every Slice 6 model:

- is a pure deterministic function of configuration;
- never reads wall-clock time;
- uses stable ordering for tie-breaking;
- exposes the mechanism that produced each metric;
- has focused tests for the semantic tradeoff being taught;
- stays inside `server-lab` while the logic is teaching-specific.

The models must not be presented as throughput or latency predictions for real infrastructure. Native measurement remains the responsibility of the Rust experiments introduced in Slice 5.

## Cache model

The cache exhibit uses a fixed hot/warm/cold key sequence and deterministic writes.

It models:

- bounded cache capacity;
- LRU eviction;
- operation-count TTL expiry;
- invalidate-on-write versus TTL-only freshness;
- cache hits and misses;
- stale reads when a cached version trails the origin;
- cache-versus-origin latency as configured teaching constants.

A write advances the origin version for one key. With invalidate-on-write, that key is removed immediately from the cache. With TTL-only mode, the previous cached version may continue to serve until expiry.

The model does not include distributed invalidation buses, stampede prevention, write-back caching, multi-tier caches, or real storage latency.

## Sharding model

The sharding exhibit compares modulo placement with a consistent-hash ring.

It models:

- deterministic FNV-1a-style key hashing;
- adding one node to an existing shard set;
- key movement before versus after that topology change;
- virtual nodes on the consistent-hash ring;
- per-node key counts;
- weighted request load for one configurable hot key.

The movement metric counts keys whose owner changes when one node is added.

The hot-key metric is deliberately separate from key-count balance. A placement scheme can distribute keys evenly while one frequently accessed key still overloads its owner.

The model does not include replication, resharding bandwidth, persistent storage movement, split/merge algorithms, or multi-key transactions.

## Admission-control model

The admission exhibit uses a fixed base arrival rate with a deterministic middle burst.

It compares:

- no admission control;
- token-bucket rate limiting;
- concurrency limiting.

The token bucket has a configured capacity and refill rate. The concurrency limiter admits work only while accepted requests still in service remain below the configured backend concurrency.

Accepted work completes after one fixed service duration. The model records when accepted work already exceeds the nominal backend concurrency envelope so the lesson can distinguish request-rate shaping from simultaneous-work protection.

The model does not include queues, fairness between tenants, distributed counters, leases, or adaptive concurrency algorithms.

## Connection-pool, fan-out, and head-of-line model

The flow exhibit creates parent requests that fan out into deterministic child tasks sharing a fixed connection pool.

It models:

- FIFO child scheduling;
- a fixed number of reusable connections;
- one-time connection handshake cost when reuse is enabled;
- per-child service time;
- deterministic slow children;
- child queue delay while every connection is busy;
- parent completion only after its slowest child completes.

A narrow pool makes slow children occupy scarce connections longer, increasing queueing for later work. Increasing pool size can reduce that head-of-line effect but is not modeled as free capacity: the exhibit simply changes the number of parallel connection slots.

The model does not include HTTP/2 or HTTP/3 stream multiplexing, transport congestion control, socket buffer behavior, DNS, TLS internals, or real kernel connection limits.

## CAP / PACELC model

The CAP/PACELC exhibit uses two client regions that alternate operations. A fixed middle operation window is partitioned.

Two strategies are compared:

### Quorum / consistency

Outside the partition, reads and writes pay configured quorum latency and both regions observe the newest version.

During the partition, region A represents the quorum side and continues. Operations from isolated region B are rejected instead of being acknowledged without the required quorum.

### Local / availability

Outside the partition, each region serves locally at lower configured latency and replication to the other region is delayed by a deterministic number of operations. Reads may therefore observe an older version.

During the partition, both regions continue serving locally. Writes accepted while disconnected are marked divergent. When the partition heals, the model records reconciliation work and converges both sides to the newest version used by the teaching trace.

The model reports concrete operation availability, successful-operation latency, stale reads, divergent writes, and reconciliation count. The labels "CAP" and "PACELC" are explanatory names for these observed tradeoffs, not substitutes for the event trace.

The model does not implement conflict-free data types, vector clocks, causal consistency, distributed transactions, real quorum protocols, or a complete consistency hierarchy.

## Extraction boundary

These models remain owned by `server-lab` because their abstractions are optimized for explanation.

If a future native experiment proves that a cache policy, hash-ring primitive, admission algorithm, or scheduler deserves reuse elsewhere, extraction should create a new production-oriented owner while preserving these lab models as explicit teaching consumers.
