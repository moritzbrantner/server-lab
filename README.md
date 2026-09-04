# server-lab

`server-lab` is an interactive laboratory for learning how server systems behave under load, latency, replication, and failure.

The repository uses two deliberately different surfaces:

- **Browser laboratory** — deterministic, visual simulations that can run on GitHub Pages.
- **Native experiments** — real processes, sockets, and operating-system/network behavior where simulation would hide the lesson. These come in later slices.

The browser lab is not presented as a benchmark of real infrastructure. Its job is to make system behavior inspectable and repeatable: the same seed and configuration must produce the same request trace and metrics.

## First curriculum

The first implementation horizon uses one shared request-routing model to teach:

1. **Latency** — service time versus network delay and tail latency.
2. **Load balancing** — round-robin, least-connections, and random routing.
3. **Replication** — replica count, read capacity, and the cost of losing replicas.
4. **Availability** — node failures, successful-request ratio, and recovery through redundancy.

The same topology, controls, event trace, and metrics are reused across the lessons so that changing one system property has an understandable effect.

## Development

```bash
cd web
bun install
bun run typecheck
bun test
bun run build
bun run dev
```

The teaching site is a static Next.js export suitable for GitHub Pages.

## Repository boundaries

`server-lab` owns educational scenarios, deterministic simulation models, visualizations, and experiments. Production-grade networking primitives or generally reusable algorithms should be extracted only after a concrete experiment proves they deserve a separate owner.

See [`ROADMAP.md`](ROADMAP.md) for the implementation slices and [`docs/contracts/simulation-model.md`](docs/contracts/simulation-model.md) for the deterministic simulation contract.
