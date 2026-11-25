# Quality Gate Contract

This document defines the unified Quality Gate for **Mihomo Multi** (Tauri v2 + Rust + React 19 + TypeScript + Tailwind CSS).

## Canonical Entrypoint

```bash
pnpm quality
```

`pnpm quality` runs `node scripts/quality-gate.mjs` with quiet-on-success output (concise `[PASS]` lines on success; full captured stdout/stderr on failure with nonzero exit).

- Run specific stages during iteration:
  ```bash
  node scripts/quality-gate.mjs --stage format:fe,lint:fe,typecheck
  node scripts/quality-gate.mjs --list
  ```
- Version parity check with explicit release tag:
  ```bash
  node scripts/check-version-parity.mjs --tag v1.6.8
  ```

## Coverage Matrix

| Capability | Provider / Configuration | Command / Task | Scope | Phase / Severity | Status |
| --- | --- | --- | --- | --- | --- |
| Application version consistency | `scripts/check-version-parity.mjs` | `pnpm check:version` (`version` stage) | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/constants/app.ts` | Gate & CI / blocking | verified |
| Frontend formatting | Biome (`biome.json`) | `pnpm format:check` (`format:fe` stage) | Frontend TS/TSX/JS/JSON/CSS | Gate & CI / blocking | verified |
| Backend formatting | rustfmt (`src-tauri/rustfmt.toml`) | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` (`format:be` stage) | `src-tauri/**` | Gate & CI / blocking | verified |
| Frontend lint | ESLint (`eslint.config.js`, React Hooks + TS) | `pnpm lint:fe` (`eslint . --max-warnings 0`) | `src/**` | Gate & CI / blocking (0 warnings) | verified |
| Type check | TypeScript (`tsconfig.json`) | `pnpm typecheck` (`tsc --noEmit`) | `src/**` | Gate & CI / blocking | verified |
| Backend static analysis & warnings | Rust Clippy | `pnpm lint:be` (`cargo clippy --all-targets -- -D warnings`) | `src-tauri/**` (lib, app bin, CLI bin, tests) | Gate & CI / blocking | verified |
| Frontend tests | Node test runner | `pnpm test:fe` (`test:fe` stage) | `scripts/test-*.mjs` | Gate & CI / blocking | verified |
| Backend tests | Cargo test | `pnpm test:be` (`test:be` stage) | `src-tauri/**` | Gate & CI / blocking | verified |
| Frontend build validation | TypeScript + Vite | `pnpm build` (`build:fe` stage) | `src/**` -> `dist/` | Gate & CI / blocking | verified |
| CI Quality Gate | GitHub Actions (`.github/workflows/ci.yml`) | `lint` job + `test` matrix (`ubuntu-22.04`, `windows-latest`) | Full repo | Push / PR to `main` | configured |
| Local Git hooks | Not installed by default | N/A | Local | Optional | missing (deferred) |

## Diagnostic Limits & Policy

- **Zero new warnings**: Both ESLint (`--max-warnings 0`) and Clippy (`-D warnings`) fail on any warning.
- **No ad-hoc suppressions**: Do not add `@ts-ignore`, `eslint-disable`, `#[allow(...)]`, or `--no-verify` to bypass a failing gate.
- **Release builds**: Full Tauri native installer packaging (`pnpm build:tauri` / `pnpm build:release`) is executed in `.github/workflows/release.yml` on version tags and is not part of the fast local `pnpm quality` loop.
