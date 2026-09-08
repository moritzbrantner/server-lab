# Repository instructions

## Purpose and boundaries

- Keep the browser laboratory deterministic and suitable for GitHub Pages.
- Keep real operating-system and network behavior in the native Rust experiments.
- Do not present browser simulations as infrastructure benchmarks.
- Do not present CI or localhost timing as stable hardware/network performance evidence; gate semantic outcomes and directional effects instead.
- Keep reusable production networking primitives outside this repository until an experiment demonstrates a concrete extraction boundary.

## Validation

Run the checks that match the changed surface before opening a pull request.

### Rust

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `cargo run --quiet -p server-lab-native --bin experiment -- 10 5 5 1 1000`

### Web

From `web/`:

- `bun run typecheck`
- `bun test`
- `bun run build`

Preserve the explicit distinction between deterministic model evidence and measured native evidence in tests, documentation, and user-facing claims.
