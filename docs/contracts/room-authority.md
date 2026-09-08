# Regional room authority contract

Slice 7B separates global request ingress from live room authority.

## Authority

- Every room has exactly one authoritative region at a time.
- The global directory maps `roomId` to `{ regionId, generation }`.
- A client's first ingress region does not become room authority merely because the request arrived there.
- This slice does not replicate live room or WebSocket state across regions.

## Placement

The lab compares deterministic placement policies:

- creator-nearest: choose the region with the lowest modeled RTT for the creator;
- fixed-region: use the explicitly selected region;
- minimum average RTT: minimize mean modeled RTT across participants;
- minimum worst-player RTT: minimize the largest participant RTT.

Ties retain the stable region ordering from the global ingress model, so repeated inputs produce the same owner.

## Directory resolution

A fresh entry with the expected generation resolves to its single room owner. Stale, unavailable, or generation-mismatched directory state fails closed. The caller must not guess an owner or create a second authority.

## Join-path model

The lab keeps routing costs explicit rather than hiding them in one latency number:

- redirect: reach the first ingress, then establish a client connection to the room owner;
- proxy: reach the ingress, which then crosses regions when the owner is elsewhere;
- directory: resolve the owner through the global directory, then connect to it directly.

The latency matrix and directory lookup cost are deterministic teaching inputs, not production measurements or an SLA. They exist to make topology and extra hops visible before introducing production multi-region setup state.
