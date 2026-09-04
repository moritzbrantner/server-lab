# Replication semantics contract

Slice 3 introduces a second deterministic teaching model beside the stateless request-routing simulator. It models one versioned logical value replicated from one leader to followers.

It is deliberately not a database implementation, transaction model, or consensus protocol.

## State ownership

- The **leader** is the only write owner.
- A successful write advances the committed version by one.
- Followers apply committed versions after a deterministic replication delay.
- A follower can remain responsive to reads while its replication link to the leader is partitioned.

This distinction is important: **reachable** and **up to date** are different properties.

## Write acknowledgement modes

### Asynchronous

The leader acknowledges a successful write immediately after accepting it locally. Followers apply the committed version later.

This minimizes acknowledgement latency but creates a stale-read window on followers.

### Majority quorum

The leader plus enough followers to form a strict majority must apply the version before the write is acknowledged.

For `N` nodes, quorum size is `floor(N / 2) + 1`.

A single slow or partitioned follower therefore does not necessarily block progress when a majority remains available.

### Synchronous / all replicas

Every follower must apply the version before the write is acknowledged.

If the slowest follower cannot acknowledge before the configured write timeout, the teaching model treats the write as failed and does not commit a partial version.

That simplification keeps the lesson focused on the latency/availability tradeoff rather than recovery of partially replicated writes.

## Read consistency modes

### Eventual follower read

Reads rotate across followers and return the follower's currently applied version. A read is marked stale when that version is below the leader's current committed version.

### Leader read

Reads go to the leader and therefore observe the current committed version in this model.

### Read your writes

The client tracks its most recently acknowledged write version.

A follower read may wait until that follower reaches the required session version. If it cannot do so before the configured read timeout, the read falls back to the leader. The simulator records both waiting and leader fallback explicitly.

### Read quorum

A read samples a strict majority of nodes and returns the highest version observed among them.

When paired with majority write acknowledgement, the read and write quorums must intersect. The exhibit uses this to demonstrate why a stale follower can participate in a successful quorum read without forcing the returned value to be stale.

## Replication delay and jitter

Follower application time is derived only from:

- the write start time;
- configured base replication delay;
- deterministic seeded jitter;
- an optional follower replication partition.

No wall-clock time is read during a scenario.

## Partition semantics

Slice 3 partitions only a follower's **replication link to the leader**.

If a write begins while that link is partitioned, delivery to that follower is held until the partition ends and then pays the configured replication delay.

The client may still read from the isolated follower. This is intentional: the lesson should expose stale-but-responsive state rather than collapsing every partition into a generic server outage.

Leader partitions, split-brain behavior, election, fencing, and term/epoch semantics belong to the coordination horizon.

## Operation scheduling

The default curriculum generates a deterministic single-client sequence of reads and writes.

A client operation cannot begin before the previous operation completes. Therefore:

- asynchronous acknowledgement can expose a stale follower on the next read;
- synchronous acknowledgement delays the client until the required replicas have applied;
- quorum acknowledgement delays the client only until a majority has applied;
- read-your-writes may add read waiting or leader fallback.

Tests may supply an explicit operation schedule for narrow semantic verification.

## Metrics

The replication model reports:

- committed version;
- successful and timed-out writes;
- mean write acknowledgement latency;
- successful reads;
- stale reads and stale-read rate;
- read-your-writes violations;
- leader fallbacks used to preserve the session guarantee;
- mean read wait;
- final follower version and lag;
- maximum observed follower lag;
- pending replication updates;
- quorum size.

## Non-goals

Slice 3 does not model:

- multi-key transactions;
- conflict resolution;
- concurrent writers;
- leader election;
- terms, epochs, fencing, or leases;
- rollback of divergent logs;
- Raft, Paxos, or another consensus protocol;
- real sockets, storage engines, or process scheduling.

Those concepts should be added only when the corresponding teaching scenario requires them.
