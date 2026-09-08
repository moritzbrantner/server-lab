# Regional multiplayer failure and recovery contract

Slice 7D extends the deterministic global multiplayer lesson with failure semantics. The model is teaching evidence, not a production WebRTC, TURN, or provider availability measurement.

## 7D-A: control-plane failure semantics

The model distinguishes two lifecycle states:

- **establishing**: room lookup and the selected signaling region are required before a peer DataChannel exists;
- **established**: a healthy direct peer DataChannel already exists, so directory and signaling services are no longer on the gameplay data path.

Signaling health is scoped per region. A failed or partitioned region affects sessions that selected that region, but does not implicitly fail other signaling regions. The global room directory can fail or partition independently from signaling.

### Required invariants

1. An establishing session fails closed when either the directory or its selected signaling region is failed or partitioned.
2. Failure of an unrelated signaling region cannot block setup in a healthy selected region.
3. A directory partition is independent from signaling-region health.
4. An already-established healthy direct DataChannel keeps carrying gameplay when directory or signaling becomes unavailable.
5. Control-plane unavailability may prevent new setup or later recovery without being described as an immediate gameplay outage for an established direct path.

## Deferred to later 7D slices

- reconnect and ICE restart after an established data path is lost;
- TURN-region failure and relay replacement;
- failure detection and bounded failover timing;
- directory/authority terms, epochs, and fencing;
- native multi-process or multi-host measurements.

Those behaviors are added only after their lifecycle and ownership boundaries are explicit.
