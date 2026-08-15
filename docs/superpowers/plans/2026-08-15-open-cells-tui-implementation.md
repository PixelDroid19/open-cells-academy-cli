# OpenCells Academy CLI Interactive TUI Implementation Plan

**Date:** 2026-08-15
**Design Document:** [`docs/superpowers/specs/2026-08-15-open-cells-tui-design.md`](../specs/2026-08-15-open-cells-tui-design.md)
**Status:** Approved for Execution

---

## 1. Goal

Implement a zero-dependency, high-performance terminal user interface (TUI) for OpenCells Academy CLI that serves as an interactive supervisor and command discovery hub when running `cells` or `cells tui` in an interactive terminal, while keeping 100% backward compatibility for all existing direct commands and automated environments (CI, pipes, `TERM=dumb`).

---

## 2. Implementation Phases & Tasks

### Phase 1: Grammar, Entrypoint Routing & Fallbacks
- [ ] Task 1.1: **RED** - Write contract tests in `test/contract/tui-grammar.test.js` verifying:
  - `cells` with interactive TTY returns action `tui`.
  - `cells tui` returns action `tui` with options (`--no-animation`, `--language`).
  - `cells` in non-interactive / pipe / `TERM=dumb` / CI environment returns action `help` with exit code `0` and does not engage raw mode.
  - `cells --help` and `cells -h` continue returning action `help`.
  - `cells <command>` continues returning action `command`.
- [ ] Task 1.2: **GREEN** - Update `src/cli/parse-argv.js` and `bin/cells.js` to implement grammar parsing and routing.
- [ ] Task 1.3: **REFACTOR / VERIFY** - Run existing `test/contract/cli-kernel.test.js` and `test/contract/all-commands-process.test.js` to verify zero regressions.

### Phase 2: Command Catalog & Legacy Compatibility Aliases
- [ ] Task 2.1: **RED** - Write tests in `test/contract/tui-grammar.test.js` and `test/domain/command-catalog.test.js` verifying:
  - `lit-components:serve` (plural) resolves to `component:dev`.
  - Unified catalog maps all 19 commands and all legacy aliases (`lit-component:*`).
  - Help rendering and TUI metadata display canonical names and compatible aliases.
- [ ] Task 2.2: **GREEN** - Implement `src/domain/tui/command-catalog.js` and update `src/cli/parse-argv.js` / `src/cli/command-registry.js`.
- [ ] Task 2.3: **REFACTOR / VERIFY** - Ensure all aliases point to the single canonical use case handler in `src/cli/composition.js`.

### Phase 3: Domain State, Bounded Ring Buffer & Task Supervisor
- [ ] Task 3.1: **RED** - Write unit & contract tests:
  - `test/domain/ring-buffer.test.js`: Ring buffer FIFO eviction, capacity bounds, search, and credential sanitization (NPM/GitHub tokens, HTTP auth URLs).
  - `test/domain/session-state.test.js`: Session state transitions, panel focus, selection, active tasks, filter updates.
  - `test/contract/supervisor-contract.test.js`: Process supervisor lifecycle (`starting` $\to$ `running` $\to$ `passed`/`failed`/`stopped`), concurrent tasks (`serve` + `unit`/`coverage`), port conflict detection, process group isolation, graceful `SIGINT` abortion and cleanup.
- [ ] Task 3.2: **GREEN** - Implement:
  - `src/domain/tui/ring-buffer.js`
  - `src/domain/tui/task-state.js`
  - `src/domain/tui/session-state.js`
  - `src/ports/task-supervisor.js`
  - `src/adapters/node/task-supervisor.js`
- [ ] Task 3.3: **REFACTOR / VERIFY** - Test supervisor with mock processes and ensure no unhandled rejections or leaked timers.

### Phase 4: Terminal Renderer, Responsive Layout & Title Animation
- [ ] Task 4.1: **RED** - Write unit tests for terminal rendering:
  - `test/domain/box-drawing.test.js`: Responsive layout calculation across wide ($\ge 100$), medium ($70-99$), and narrow ($<70$) columns.
  - `test/domain/title-animator.test.js`: 8–12 FPS title shimmer, idle suspension, static fallback with `NO_COLOR`, `--no-animation`, `TERM=dumb`.
  - `test/domain/ansi-screen.test.js`: Alternate screen buffer management (`\x1b[?1049h`/`l`), cursor visibility, raw mode management, keyboard escape code parsing (`arrows`, `j/k`, `Tab`, shortcuts, `Esc`, `q`).
- [ ] Task 4.2: **GREEN** - Implement:
  - `src/adapters/terminal/box-drawing.js`
  - `src/adapters/terminal/ansi-screen.js`
  - `src/adapters/terminal/title-animator.js`
  - `src/adapters/terminal/log-sanitizer.js`
  - `src/adapters/terminal/terminal-renderer.js`
- [ ] Task 4.3: **REFACTOR / VERIFY** - Test terminal restoration on simulated error/abort conditions.

### Phase 5: Workspace Inspector & TUI Application Controller
- [ ] Task 5.1: **RED** - Write integration tests in `test/integration/tui-supervisor-serve.test.js` verifying:
  - Non-destructive workspace inspection (detects OpenCells app vs Lit component vs uninitialized directory).
  - TUI controller connects keybindings (`s`, `r`, `u`, `c`, `e`, `b`, `l`, `o`, `Tab`, `Enter`, `q`) to supervisor actions.
  - Starting `serve` and executing `test` / `coverage` concurrently retains the same `serve` PID.
  - Cancelling `test` does not kill `serve`.
  - Restarting `serve` terminates previous instance and starts new process.
- [ ] Task 5.2: **GREEN** - Implement:
  - `src/application/tui/workspace-inspector.js`
  - `src/application/tui/tui-controller.js`
  - `src/application/tui/start-tui.js`
  - Wire `startTui` in `src/cli/composition.js` and `bin/cells.js`.
- [ ] Task 5.3: **REFACTOR / VERIFY** - Test interactive controller loop with simulated event emitter streams.

### Phase 6: Real Acceptance & Verification Gates
- [ ] Task 6.1: **Acceptance Test Suite** - Write `test/integration/tui-acceptance-lifecycle.test.js`:
  - Package local CLI via `packSelf`.
  - Scaffold fresh Academy application and component in temporary workspaces.
  - Run TUI session in simulated PTY.
  - Start server from TUI; assert HTTP 200 and HMR endpoint.
  - Run unit tests and coverage without terminating serve; verify coverage lcov and persistent PID.
  - Mutate a source file; verify HMR update log arrives in TUI buffer.
  - Exit TUI cleanly; verify no lingering processes or locked ports.
- [ ] Task 6.2: **Security & Quality Gates**:
  - Run `npm run verify:release`.
  - Run `git diff --check`.
  - Verify all JavaScript & JSON files parse.
  - Run `npm pack --dry-run --json` to verify package contents.
  - Verify no secrets, no absolute local machine paths, and clean repository state.

---

## 3. Execution Checkpoint Protocol

After each phase, report:
1. Current phase name.
2. RED test executed & test count.
3. GREEN test executed & test count.
4. Modified and created files.
5. Active processes / open ports (confirming 0 leaked).
6. Exact blocker (if any).
7. Next step.
