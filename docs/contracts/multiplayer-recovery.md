# Regional multiplayer failure and recovery contract

Slice 7D extends the deterministic global multiplayer lesson with failure semantics. The browser model is teaching evidence; the native experiment adds process/socket evidence without turning localhost into a claim about production WebRTC, TURN, or provider availability.

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

The established gameplay path is explicit as either **direct** or **TURN-relayed**.

TURN health is scoped per relay region and remains independent from signaling health. A TURN outage affects gameplay only when that relay is actually on the established data path. Direct gameplay does not acquire a TURN dependency merely because TURN infrastructure exists elsewhere.

A failed relay is not silently replaced. Recovery uses an explicit **TURN reallocation** operation: signaling becomes necessary again and a replacement relay region must be selected and available. A fresh room-directory lookup is not required for this modeled relay replacement because the session identity and room ownership remain known.

### TURN invariants

1. Failure of any TURN region cannot affect an established direct DataChannel.
2. Failure of the active TURN region immediately makes the relayed gameplay path unavailable even when signaling is healthy.
3. Failure of an unrelated TURN region cannot affect a relayed path through a different healthy region.
4. TURN recovery requires an explicit ICE recovery operation; the model never auto-switches relays behind an established session.
5. TURN reallocation requires signaling and the selected replacement relay to be available, but not a fresh directory lookup.
6. A replacement relay that is failed or partitioned causes recovery to fail closed.

## 7D-D: recovery integration and authority fencing

The deterministic recovery slice reuses the existing recovery lesson instead of introducing a second generic coordination engine.

The global room directory is modeled as a **stateful authority**, so its leader recovery legitimately reuses the existing election semantics:

- heartbeat-based failure detection remains distinct from the physical failure start;
- promotion occurs only after the election timeout and election duration;
- a successful replacement starts a higher term that acts as a fencing token;
- if the previous leader later recovers, writes carrying its stale term are rejected.

A short failure that ends before the modeled detection threshold does not trigger an unnecessary promotion. A longer failure can elect another healthy directory authority only when a majority remains available.

Those coordination concepts are deliberately **not** copied onto stateless signaling or TURN services. A signaling or TURN region may fail, partition, or be explicitly replaced, but it does not receive an election term merely because the directory authority uses one.

The `/global` lesson exposes the combined deterministic model interactively: lifecycle, signaling health, directory health, direct versus relayed gameplay, ICE/rejoin/relay recovery, and the directory-authority election trace can be inspected without conflating control-plane and gameplay dependencies.

### Integration invariants

1. Failure detection and failover completion remain separate moments rather than a single availability toggle.
2. Directory authority promotion increments the term and fences a recovered stale writer.
3. A failure that heals before detection does not create a new directory leader or term.
4. Signaling and TURN failure semantics stay independent from directory election mechanics.
5. The interactive lesson consumes the same deterministic models covered by tests rather than duplicating their decisions in presentation code.
6. All deterministic timing and availability values remain teaching constants, not measured provider behavior.

## 7D-E: native multi-process reproduction

The stable dependency boundaries are also reproduced by `multiplayer-recovery-experiment` in the native Rust crate.

The experiment launches independent child processes on ephemeral loopback sockets for:

- directory authority reachability;
- signaling reachability;
- an already-established direct gameplay path;
- an active TURN relay.

It then terminates those child processes independently and records real connect/write/read outcomes.

The native semantic gate requires:

1. all baseline services are reachable before failure injection;
2. terminating the directory blocks modeled new setup while the established direct path remains reachable;
3. terminating signaling blocks the modeled ICE-restart dependency while the established direct path remains reachable;
4. terminating the active TURN relay leaves direct gameplay reachable but makes the relayed path unreachable;
5. explicit TURN replacement succeeds only after both signaling and the replacement relay are reachable.

These checks validate the **dependency separation across real process/socket boundaries**. They do not implement WebRTC, ICE, TURN allocation, DNS, or regional routing protocols themselves.

The experiment emits observed loopback probe latency as machine-readable evidence, but pass/fail depends only on the semantic reachability outcomes. Exact timing is deliberately not gated.

### Native evidence boundary

- Multi-process behavior is now measured rather than inferred from the deterministic browser model.
- The experiment runs on one host and does not claim multi-region latency or provider-failure realism.
- Real multi-host/regional reproduction remains a future experiment only if there is a concrete infrastructure question worth measuring.
- Browser-model constants and native loopback timings must not be presented as production performance numbers.
