# Regional multiplayer failure and recovery contract

Slice 7D extends the deterministic global multiplayer lesson with failure semantics. The model is teaching evidence, not a production WebRTC, TURN, or provider availability measurement.

## 7D-A: control-plane failure semantics

The model distinguishes two lifecycle states before recovery is needed:

- **establishing**: room lookup and the selected signaling region are required before a peer DataChannel exists;
- **established**: a healthy peer DataChannel already exists, so directory and signaling services are no longer on the gameplay data path.

Signaling health is scoped per region. A failed or partitioned region affects sessions that selected that region, but does not implicitly fail other signaling regions. The global room directory can fail or partition independently from signaling.

### Required invariants

1. An establishing session fails closed when either the directory or its selected signaling region is failed or partitioned.
2. Failure of an unrelated signaling region cannot block setup in a healthy selected region.
3. A directory partition is independent from signaling-region health.
4. An already-established healthy direct DataChannel keeps carrying gameplay when directory or signaling becomes unavailable.
5. Control-plane unavailability may prevent new setup or later recovery without being described as an immediate gameplay outage for an established direct path.

## 7D-B: reconnect and ICE recovery

A third lifecycle state, **recovering**, is entered only after the established gameplay path itself is lost. Recovery is explicit rather than implied by a control-plane outage.

Two recovery operations are modeled:

- **ICE restart** keeps the known room/session identity and requires signaling again, but does not require a fresh global directory lookup in this model;
- **rejoin** performs room discovery again and therefore requires both the directory and signaling.

Gameplay is unavailable while the modeled DataChannel is being recovered. The control plane becoming necessary again does not retroactively mean it was on the established gameplay path before the loss.

### Recovery invariants

1. A healthy established DataChannel does not require signaling merely because signaling becomes unavailable.
2. Once that DataChannel is lost, an ICE restart requires the selected signaling region again.
3. A directory failure alone does not block the modeled ICE restart because room ownership is already known.
4. A full rejoin requires both directory lookup and signaling.
5. Recovery kind is explicit; the model does not silently convert a blocked ICE restart into a different recovery operation.

## 7D-C: TURN failure and relay replacement

The established gameplay path is now explicit as either **direct** or **TURN-relayed**.

TURN health is scoped per relay region and remains independent from signaling health. A TURN outage affects gameplay only when that relay is actually on the established data path. Direct gameplay does not acquire a TURN dependency merely because TURN infrastructure exists elsewhere.

A failed relay is not silently replaced. Recovery uses an explicit **TURN reallocation** operation: signaling becomes necessary again and a replacement relay region must be selected and available. A fresh room-directory lookup is not required for this modeled relay replacement because the session identity and room ownership remain known.

### TURN invariants

1. Failure of any TURN region cannot affect an established direct DataChannel.
2. Failure of the active TURN region immediately makes the relayed gameplay path unavailable even when signaling is healthy.
3. Failure of an unrelated TURN region cannot affect a relayed path through a different healthy region.
4. TURN recovery requires an explicit ICE recovery operation; the model never auto-switches relays behind an established session.
5. TURN reallocation requires signaling and the selected replacement relay to be available, but not a fresh directory lookup.
6. A replacement relay that is failed or partitioned causes recovery to fail closed.

## Deferred to the final 7D slice

- failure detection and bounded failover timing;
- directory/authority terms, epochs, and fencing;
- the interactive failure/recovery teaching panel and roadmap integration;
- native multi-process or multi-host measurements.

Native measurements remain deferred until the deterministic failure semantics are stable.
