# Global ingress teaching contract

Slice 7A introduces a deterministic browser model for the control-plane problem that appears when a multiplayer setup service is deployed in several geographic regions behind one logical hostname.

The model is an explanation tool, not a DNS, Anycast, CDN, load-balancer, or Internet-latency benchmark.

## Fixed topology

The lesson has three signaling regions:

- `eu-central` — Frankfurt;
- `us-east` — Virginia;
- `ap-southeast` — Singapore.

Clients also originate from Frankfurt, Virginia, and Singapore. A fixed client-to-region RTT matrix supplies teaching constants. The UI may add a deterministic latency penalty to any region to represent a healthy but degraded path or ingress.

Every request targets the same logical hostname: `multiplayer.example.com`.

## Routing policies

### Round robin

Each new arrival rotates across the currently healthy regions in stable region order.

This demonstrates that even request distribution does not imply good user latency. Unhealthy regions are removed from the rotation.

### Geographic proximity

A client uses its configured home region while that region is healthy. Injected latency does not move the client away from a healthy home region.

When the home region is unhealthy, the model falls back to the healthy region with the lowest baseline RTT. Ties use stable region order.

### Measured latency

A client chooses the healthy region with the lowest baseline RTT plus the configured regional latency penalty.

This demonstrates that a healthy region can still lose traffic when its observed path becomes worse than a cross-region alternative.

## Health and availability

Health is an explicit input. An unhealthy region is never eligible for routing.

If no region is healthy, the logical hostname is modeled as unavailable for new arrivals. Existing WebRTC sessions are outside this slice and therefore make no claim about whether already-connected gameplay survives a signaling-region outage.

The trace distinguishes:

- home-region routing;
- cross-region steering while the home region is still healthy;
- health failover because the home region is unhealthy;
- failure because no healthy region exists.

## Latency metrics

The model reports mean and p95 ingress RTT only for successful arrivals. Those numbers are derived exclusively from the fixed teaching matrix and configured latency penalties.

They are not predictions for Hetzner, Cloudflare, Route 53, Fly.io, TURN, WebRTC, or any other production network.

## Multiplayer ownership boundary

Slice 7A models only the first routing decision that gets a browser to a signaling region.

It does not model:

- room ownership or a global `room -> region` directory;
- redirecting or proxying a join to a room's home region;
- WebSocket state replication;
- WebRTC offer/answer/ICE semantics;
- direct peer-to-peer gameplay latency;
- TURN selection or relay latency;
- DNS TTLs, resolver caches, BGP, Anycast, provider-specific steering, or connection migration;
- real multi-region servers.

Those omissions are deliberate. In particular, routing a player to the nearest ingress is not enough to make independently arriving players converge on the same stateful room.

## Extraction boundary

The model remains owned by `server-lab` because it is teaching-specific. The production `multiplayer-setup-service` should not gain multi-region room state merely because the lab can simulate a global front door.

A reusable deployment or routing primitive should be extracted only after a later native/multi-server experiment proves a stable production contract.
