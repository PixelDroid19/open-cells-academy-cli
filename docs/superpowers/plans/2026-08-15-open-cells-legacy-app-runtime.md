# OpenCells Legacy Application Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run established Cells applications through the public OpenCells CLI, delivering serve first and then build, test, and locales.

**Architecture:** Normalize legacy command names into the canonical grammar, resolve nested configurations under a symlink-safe boundary, and compose an Academy-owned Vite pipeline that prepares config, templates, locales, and Sass without invoking another CLI. Reuse the same preparation boundary for build, tests, and locale generation.

**Tech Stack:** Node.js ESM, immutable command grammar, Vite 7, Sass, native `node:test`, existing OpenCells filesystem and process-supervision adapters.

## Global Constraints

- Do not modify the external acceptance application source.
- Do not reference a source repository or local absolute path in public code, comments, documentation, commits, or package metadata.
- Do not execute shell commands through `shell: true`.
- Reject absolute, traversal, symlinked, or identity-changing configuration paths.
- Preserve caller environment variables and existing unrelated processes.
- Use one causal RED and one GREEN cycle for every task.
- Publish in focused conventional commits and keep release gates green.

---

### Task 1: Legacy serve command and trusted configuration paths

**Files:**
- Modify: `src/cli/parse-argv.js`
- Modify: `src/adapters/vite/config-loader.js`
- Modify: `test/contract/cli-kernel.test.js`
- Modify: `test/integration/config-html-pipeline.test.js`

**Interfaces:**
- Produces: `app:serve` normalized to canonical `app:dev`.
- Produces: `loadCellsConfig(session, 'co/web-dev.js')` with immutable `sourcePath` and `legacy` payload.

- [ ] Add parser and config-loader tests for the alias, nested path, traversal, symlink, ancestor replacement, CommonJS, and ESM cases.
- [ ] Run the focused tests and record failures caused by the missing alias and rejected nested path.
- [ ] Implement command normalization and a segment-by-segment identity-checked resolver under `app/config/`.
- [ ] Import, revalidate, clone, and freeze the full selected configuration as `legacy` while preserving existing normalized fields.
- [ ] Run focused tests and commit `feat(app): support legacy serve configuration`.

### Task 2: Non-mutating legacy Vite runtime preparation

**Files:**
- Create: `src/adapters/vite/legacy-app-runtime.js`
- Modify: `src/adapters/vite/app-toolchain.js`
- Modify: `src/application/app/dev-app.js`
- Modify: `test/integration/app-toolchain.test.js`
- Modify: `test/integration/app-scaffold-lifecycle.test.js`

**Interfaces:**
- Consumes: normalized config with `legacy` and `sourcePath`.
- Produces: `createLegacyAppPlugins({ session, configName, config, sassLogLevel })` returning Vite plugins with no direct source overwrite.
- Produces: `AppToolchain.startDev()` lifecycle with owned readiness and cleanup.

- [ ] Add RED tests that materialize a legacy app fixture importing `config/app.config.js`, using `tpls/index.tpl`, locales, and application Sass.
- [ ] Assert the selected config and template are served, source hashes remain unchanged, HMR invalidates changed inputs, and failed preparation leaves no residue.
- [ ] Implement a virtual configuration loader plugin, in-memory template transform, locale preparation hook, and Sass watch hook.
- [ ] Compose the plugins only for validated legacy layout; retain the Academy root-layout behavior unchanged.
- [ ] Run focused application toolchain/scaffold tests and commit `feat(app): add legacy runtime pipeline`.

### Task 3: Real DEV and QA serve acceptance

**Files:**
- Create: `test/integration/legacy-app-serve.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: installed/package-local `cells app:serve`.
- Produces: deterministic real-runtime evidence for two configurations.

- [ ] Add a hermetic legacy fixture proving DEV/QA select distinct configuration values.
- [ ] Run both profiles sequentially on verified-free strict ports with `CELLS_LITE_DEVELOPER=true` and the requested `NODE_OPTIONS` values.
- [ ] Assert HTTP 200 for `/` and `/@vite/client`, configuration-specific browser-visible data, HMR, SIGINT exit, and free ports.
- [ ] Run the same bounded lifecycle against an external real application without changing its sources.
- [ ] Document `app:serve` and commit `test(app): validate legacy serve profiles`.

### Task 4: Legacy application build

**Files:**
- Modify: `src/adapters/vite/legacy-app-runtime.js`
- Modify: `src/adapters/vite/app-toolchain.js`
- Modify: `src/application/app/build-app.js`
- Modify: `test/integration/app-toolchain.test.js`
- Modify: `test/integration/legacy-app-serve.test.js`

**Interfaces:**
- Produces: atomic `build/<nested-config-without-extension>/` output.

- [ ] Add RED tests for nested output naming, templates, resources, vendor, manifest, locales, sourcemaps, and rollback.
- [ ] Reuse legacy preparation in the Vite build boundary and preserve guarded stage publication.
- [ ] Run a real DEV-config build and verify executable output without altering sources.
- [ ] Commit `feat(app): build legacy applications`.

### Task 5: Legacy application tests

**Files:**
- Modify: `src/application/tui/workspace-inspector.js`
- Modify: `src/cli/composition.js`
- Modify: `src/adapters/testing/wtr-runner.js`
- Modify: `test/integration/test-commands.test.js`
- Modify: `test/integration/legacy-app-serve.test.js`

**Interfaces:**
- Produces: runner detection and `cells app:test` artifacts for established app layouts.

- [ ] Add RED tests for declared WTR and modern Vitest app contracts, config forwarding, and coverage artifacts.
- [ ] Extend runner selection without generic npm fallbacks.
- [ ] Run tests while a serve PID remains alive and assert JUnit/coverage outputs.
- [ ] Commit `feat(app): test legacy applications`.

### Task 6: Legacy application locales

**Files:**
- Modify: `src/adapters/vite/locales-pipeline.js`
- Modify: `src/application/app/generate-locales.js`
- Modify: `test/integration/locales-pipeline.test.js`
- Modify: `test/integration/legacy-app-serve.test.js`

**Interfaces:**
- Produces: project-local locale plan for per-language and bundle modes selected by nested config.

- [ ] Add RED tests for root locales, dependency locales, market config, bundles, stale removal, and symlink refusal.
- [ ] Map the established config fields into the existing immutable locale plan and publisher.
- [ ] Run a real locale generation and verify catalog parity and source containment.
- [ ] Commit `feat(app): generate legacy application locales`.

### Task 7: Release, installation, and final acceptance

**Files:**
- Modify only if a verified release defect is found.

**Interfaces:**
- Produces: pushed branch and matching global installation.

- [ ] Run focused suites, full safe sequential suites, syntax checks, `git diff --check`, release gates, and package dry-run.
- [ ] Verify no source-tree residue, live owned processes, or task ports remain.
- [ ] Push each reviewed commit to the current feature branch.
- [ ] Pack the final commit, replace only the exact global OpenCells CLI package, and compare installed hashes.
- [ ] Re-run DEV, QA, build, test, and locales through the installed `cells` executable.
