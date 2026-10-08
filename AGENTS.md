# js-otlpout

Formatting follows the WITH code guidelines
(https://with-codeguidelines.readthedocs-hosted.com/en/latest/code-formatting.html):
Prettier with `tabWidth: 4`, `.editorconfig` at 4 spaces (YAML too, Makefile
tabs).

## Formatting

- Reformat: `make format` (prettier `--write`)
- Check: `make lint` (prettier `--check` + eslint)

## Testing

- Full suite: `make test` (`pnpm exec vitest run`, ~0.3s, timeout 60000ms)
- SvelteKit e2e: `make test-sveltekit` (`pnpm --filter sveltekit-pet test`;
  builds the toy app then drives a real adapter-node SSR request, timeout
  600000ms). Needs Node 22+ (SvelteKit 3 uses `Promise.withResolvers`), so CI
  runs it on Node 22/24 only.
- Type check: `make typecheck` (`pnpm exec tsc --noEmit`)
- Build: `make build` (`pnpm run build`, tsup)
- Always: redirect output to a temp file; silent on success; dump failures only.
- Last measured: 2026-10-08, full suite 0.3s, SvelteKit e2e ~4s (after build).
