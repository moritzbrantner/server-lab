# Control-plane versus gameplay latency contract

Slice 7C separates multiplayer setup latency from the established gameplay data path. The model is deterministic teaching evidence, not a production network benchmark.

## Authority and phases

- The selected **signaling region** owns the modeled room create/join and WebSocket signaling path.
- **ICE negotiation** is a setup phase. Direct-first ICE may either establish a direct peer path or exhaust a bounded modeled attempt before TURN allocation.
- Once a direct peer connection is established, the signaling region is not on the modeled gameplay path.
- When TURN fallback is selected, the chosen **TURN relay region** is explicitly on the established gameplay path and therefore affects gameplay RTT.

The model reports room create/join, WebSocket signaling, and ICE latency separately before summing them into total setup latency.

## Gameplay topology

Two deterministic topologies are supported:

- **Full mesh**: every participant pair has one gameplay path.
- **Host-spoke**: only host-to-peer paths carry modeled gameplay traffic, so host geography can change the worst gameplay path.

Direct peer RTTs and client-to-region RTTs are teaching constants. A TURN path is modeled as the sum of both peers' RTTs to the relay region.

## Required invariants

1. Changing only the signaling region changes setup latency but cannot change an already-established direct gameplay RTT.
2. TURN geography can change established gameplay RTT because the relay is part of the data path.
3. Direct-first TURN fallback keeps the failed direct attempt visible in ICE setup cost rather than pretending relay allocation was the first choice.
4. Full-mesh and host-spoke path sets are explicit and deterministic.
5. No number from this model is described as measured provider, Internet, WebRTC, or TURN performance.

## Out of scope

- TURN credentials, authentication, quotas, or provider selection
- real NAT traversal success probabilities
- packet loss, jitter, reordering, congestion, codecs, or application frame timing
- signaling/directory/TURN regional failure recovery; that is Slice 7D
- native multi-host or Internet measurements

Those concerns can be added only when their ownership and measurement contracts are explicit.
