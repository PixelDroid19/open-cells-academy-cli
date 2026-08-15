# OpenCells Academy CLI Interactive TUI Design

**Date:** 2026-08-15
**Status:** Approved for Implementation
**Repository:** `PixelDroid19/open-cells-academy-cli`
**Package:** `open-cells-academy-cli`
**Executable:** `cells`
**Target Version:** `0.2.0`

---

## 1. Executive Summary & Purpose

OpenCells Academy CLI currently provides 19 robust command-line operations for scaffolding, developing, testing, linting, documenting, building, and previewing OpenCells applications and Lit components.

This design introduces an interactive, terminal-native user interface (**TUI**) that activates seamlessly when executing:
```bash
cells
```
in an interactive terminal (TTY), or explicitly via:
```bash
cells tui
```

The TUI acts as an ergonomic, non-intrusive **process supervisor and command discovery hub**. It allows developers to:
1. Discover and trigger all Academy CLI commands with auto-completion and keyboard shortcuts.
2. Run and supervise the local development server (`app:dev` / `component:dev`).
3. Execute unit tests, coverage runs, E2E tests, linters, i18n locale generators, and documentation builds **concurrently without terminating the running development server**.
4. View real-time aggregated logs with streaming, filtering, scroll lock, and sensitive token redaction.
5. Monitor HMR file changes, test pass/fail statistics, code coverage metrics, and server health.
6. Gracefully stop, restart, or cancel background tasks with full process group cleanup.

Direct CLI invocations (e.g. `cells app:dev -c dev.js`, `cells component:test --coverage`, `cells lit-component:serve`) and automated scripts (CI, pipes, `TERM=dumb`, non-TTY) retain 100% backward compatibility with identical text outputs and exit codes.

---

## 2. Evaluation of Implementation Alternatives

To select the most robust, maintainable, and lightweight architecture, three implementation strategies were evaluated:

| Criterion | Option A: Pure Native Node.js Zero-Dependency Engine (Recommended) | Option B: React / Ink Terminal Framework (`ink` + `react`) | Option C: Modular TUI Component Library (`terminal-kit` / `enquirer`) |
| :--- | :--- | :--- | :--- |
| **Dependency Weight** | **0 KB** (0 new external dependencies) | **~12–18 MB** (React, Yoga layout WASM/native, slice-ansi, cli-cursor, etc.) | **~2–5 MB** (Multiple transitive dependencies) |
| **ESM & Node >= 22.12** | **100% Native ESM**, zero interop wrappers, native `node:readline` & ANSI | Good ESM in Ink 4+, but Yoga WASM / native bindings require runtime glue | Mixed CJS/ESM across older terminal modules |
| **Cross-Platform (Linux / macOS / Windows)** | **Full VT100 / ANSI** support via Windows Terminal / ConHost; native signal handling | Requires native binary or WASM for Yoga layout; occasional Windows ConHost artifacts | Inconsistent Windows ConHost raw-mode behavior |
| **Accessibility & Fallbacks** | Full programmatic control of `NO_COLOR`, `TERM=dumb`, CI detection, `--no-animation`, high contrast | Handled by Ink layout, but disabling animations cleanly requires complex React context | Partial support; difficult to decouple styling from state |
| **Testability & TDD** | **Exceptional**: Pure state reducers, in-memory stream harnesses, deterministic ANSI snapshots | Requires `ink-testing-library`, React component test harnesses, and async act() loops | Complex mocking of terminal screen buffers |
| **Resize & Viewport Handling** | Direct `process.stdout.on('resize')` with debounce and atomic alternate screen redraw | Yoga flexbox recalculation; can cause flicker or CPU spikes during rapid log streaming | Full-screen repaint glitches on fast resize events |
| **Process Supervision Isolation** | **Complete decoupling**: Pure Domain State $\to$ Task Supervisor $\to$ Terminal View | UI tightly coupled to React lifecycle; unmounting components can leak child process handlers | Supervisor logic intermingled with UI widget callbacks |
| **Supply Chain & Security Gates** | **Zero supply chain expansion**; 100% passes `verify:release` & `release-gates.test.js` | Adds ~25+ external packages, increasing CVE exposure and npm audit risk | Adds ~8–15 external packages, potential audit warnings |

### Detailed Trade-Off Comparison

#### Option A: Pure Native Node.js Zero-Dependency Engine (Recommended)
- **Strengths:**
  - Zero external package bloat preserves the lightweight, self-contained philosophy of the OpenCells Academy CLI.
  - 100% deterministic testability with Node's native test runner (`node --test`).
  - Native Node streams (`node:readline`, `node:events`, `node:string_decoder`) handle ANSI escapes, alternate screen buffers (`\x1b[?1049h`/`\x1b[?1049l`), and raw keyboard input with sub-millisecond latency.
  - Complete control over process groups, signal propagation (`SIGINT`, `SIGTERM`), and terminal teardown guarantees that no zombie processes or garbled terminal states remain.
- **Weaknesses:**
  - Requires writing clean, modular box-drawing and layout calculation utilities (e.g. 150 lines of pure string formatting functions).
- **Verdict:** **Recommended**. Perfectly fits OpenCells educational and production quality standards.

#### Option B: React / Ink Framework
- **Strengths:** Declarative JSX component model.
- **Weaknesses:** Substantial dependency bloat (>12MB), complex Yoga engine compilation, high CPU usage during high-throughput log streaming from Vite and Vitest, and difficult integration with strict isolated contract tests.
- **Verdict:** Rejected.

#### Option C: Modular TUI Component Library
- **Strengths:** Reusable widgets out of the box.
- **Weaknesses:** Unnecessary dependency maintenance burden, risk of unmaintained upstream packages, and impedance mismatch with domain-driven ports/adapters architecture.
- **Verdict:** Rejected.

---

## 3. Architecture & Separation of Responsibilities

The TUI architecture strictly follows hexagonal / clean architecture principles, separating user interaction, process management, domain state, and terminal rendering:

```
+-----------------------------------------------------------------------------------+
|                                  CLI Entrypoint                                   |
|               (bin/cells.js -> parseArgv -> TTY / Non-TTY Detection)              |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                                 StartTui Use Case                                 |
|                       (src/application/tui/start-tui.js)                          |
+----------------------------------------+------------------------------------------+
                                         |
     +-----------------------------------+-----------------------------------+
     |                                   |                                   |
     v                                   v                                   v
+-----------------------+   +-----------------------+   +---------------------------+
|  WorkspaceInspector   |   |    CommandCatalog     |   |       TuiController       |
| (Detect App/Component)|   | (19 Cmds + Aliases)   |   | (Input / Selection / Redux)|
+-----------------------+   +-----------------------+   +-------------+-------------+
                                                                      |
                                       +------------------------------+------------------------------+
                                       |                                                             |
                                       v                                                             v
                    +-------------------------------------+                       +-------------------------------------+
                    |           TaskSupervisor            |                       |          TerminalRenderer           |
                    | (src/adapters/node/task-supervisor) |                       | (src/adapters/terminal/renderer.js) |
                    +------------------+------------------+                       +------------------+------------------+
                                       |                                                             |
                 +---------------------+---------------------+                 +---------------------+---------------------+
                 |                     |                     |                 |                     |                     |
                 v                     v                     v                 v                     v                     v
          [DevServer Port]      [TestRunner Port]     [ProcessRunner]    [AnsiScreen / Box]     [RingBuffer View]     [Title Animator]
          (App/Comp Toolchain)  (Vitest / WTR)       (Detached PGID)    (Responsive Layout)    (Scroll & Redaction)  (8-12 FPS Throttle)
```

### Module Responsibilities

1. **`src/cli/parse-argv.js` & `src/cli/command-registry.js`**:
   - Parses incoming CLI tokens.
   - Detects `cells` (no args) vs `cells tui` vs `cells <command>` vs `cells --help`.
   - Normalizes legacy aliases (`lit-component:*`, `lit-components:serve`).

2. **`src/application/tui/workspace-inspector.js`**:
   - Inspects the current working directory non-destructively.
   - Identifies whether the workspace is an **OpenCells App**, a **Lit Component**, or an **Unknown/Uninitialized Directory**.
   - Determines configuration files (`dev.js`, `prod.js`, `component.json`, etc.).

3. **`src/domain/tui/command-catalog.js`**:
   - Single source of truth for all 19 canonical commands, legacy compatibility aliases, descriptions, parameter requirements, and interactive shortcuts.

4. **`src/domain/tui/session-state.js` & `task-state.js`**:
   - Pure, immutable domain state and reducers.
   - Tracks active view, focused panel, selected command, search query, modal overlays, running tasks, log buffers, and test metrics.

5. **`src/ports/task-supervisor.js` & `src/adapters/node/task-supervisor.js`**:
   - Manages subprocess execution without shell strings (`shell: false`).
   - Ensures only one primary dev server runs per workspace.
   - Allows concurrent execution of `serve` + `unit test` / `coverage` / `e2e` / `lint` / `locales` / `build`.
   - Prevents conflicting concurrent writes (e.g. concurrent `coverage` or concurrent `build`).
   - Manages bounded ring buffers for task logs (default 2,000 lines).
   - Handles graceful signal escalation (`SIGINT` $\to$ grace period $\to$ `SIGTERM`/`SIGKILL`).

6. **`src/adapters/terminal/terminal-renderer.js`**:
   - Encapsulates ANSI terminal control, alternate screen buffer, raw mode, keyboard event parsing, dynamic layout sizing, box drawing, and color formatting.
   - Implements the discrete, low-power "ACADEMY CELLS" title animation (8–12 FPS, paused on idle, disabled under `NO_COLOR` / `--no-animation`).

---

## 4. User Experience & Interface Design

### 4.1 CLI Invocations & Fallback Matrix

| Invocation | Environment | Behavior |
| :--- | :--- | :--- |
| `cells` | Interactive TTY | **Opens Interactive TUI**. |
| `cells tui` | Interactive TTY | **Opens Interactive TUI**. |
| `cells tui --no-animation` | Interactive TTY | Opens TUI with title animation completely static. |
| `cells` | Non-TTY / Pipe / CI | Prints standard formatted help text (`renderHelp`) and exits with code `0`. Does not activate raw mode. |
| `cells` | `TERM=dumb` | Prints standard formatted help text and exits with code `0`. |
| `cells --help` / `-h` | Any | Prints textual command help and exits with code `0`. |
| `cells <command>` | Any | Executes direct command immediately through existing dispatchers. |

### 4.2 Main Screen Layout (Wide Viewport $\ge 100$ columns)

```
┌─ ACADEMY CELLS ───────────────────────────────────────────────────────────── [Workspace: my-button (Component)] ──┐
│                                                                                                                     │
│  COMMANDS [Filter: /]                │ ACTIVE TASKS                                                                 │
│  > s  component:dev                  │ [1] SERVE    PID: 41205  RUNNING (00:04:12)  http://127.0.0.1:8001/          │
│    u  component:test                 │ [2] COVERAGE PID: 41380  PASSED  (00:00:04)  Lines: 96.4% Statements: 95.8%  │
│    c  component:test --coverage      ├──────────────────────────────────────────────────────────────────────────────┤
│    b  component:build:demo           │ LOG STREAM [Filter: All (Tab to switch) | Mode: AUTO-SCROLL]                 │
│    l  component:lint                 │ 11:42:01 [serve] [vite] ready in 240ms. URL: http://127.0.0.1:8001/          │
│    d  component:documentation        │ 11:42:15 [serve] [vite] hmr update /src/MyButton.js                          │
│    i  component:locales              │ 11:43:00 [cov]   ✓ test/unit/my-button.test.js (4 tests passed)              │
│    p  component:install              │ 11:43:04 [cov]   Coverage: 96.4% lines (27/28), 95.8% statements             │
│    g  component:changelog            │                                                                              │
│    +  component:create               │                                                                              │
│                                      │                                                                              │
├──────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ STATUS: Server: http://127.0.0.1:8001/ | HMR: /src/MyButton.js (11:42:15) | Unit: 4/4 PASSED | Cov: 96.4%          │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [s] Serve  [u] Unit  [c] Coverage  [e] E2E  [b] Build  [/] Search  [Tab] Panel  [l] Log Filter  [?] Help  [q] Quit  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Responsive Layout Modes

1. **Wide Layout ($\ge 100$ cols, $\ge 24$ rows):**
   - Left Column (35%): Searchable Command List & Shortcuts.
   - Right Top (25% height): Active Tasks & Process PIDs.
   - Right Bottom (75% height): Scrollable Log Stream & Filtering.
   - Bottom: Status Bar & Keybinding footer.

2. **Medium Layout ($70 \le \text{cols} < 100$):**
   - Top Half: Tabbed view between Commands and Active Tasks.
   - Bottom Half: Log Stream.
   - Compact status & key hints.

3. **Narrow Layout ($< 70$ cols or $< 20$ rows):**
   - Single-column stacked mode.
   - Dedicated full-screen views navigable via `Tab` (Commands $\to$ Tasks $\to$ Logs).
   - Essential one-line summary at top.

### 4.4 Header Title Animation Specifications

- **Text:** `ACADEMY CELLS` with subtle gradient wave / shimmer across the letter glyphs.
- **Frame Rate:** Throttled to **8–12 FPS** using a low-overhead timer (`setInterval(..., 100)`).
- **Dirty Region Rendering:** Only redraws the top title line during animation ticks; does not repaint log panes or process lists.
- **Power Efficiency & Suspension:**
  - Automatically stops when the TUI loses focus or receives no events for $> 30$ seconds (or when suspended).
  - Reactivates immediately on keypress or incoming process log.
- **Disabling Conditions:**
  - `NO_COLOR` environment variable is set.
  - `--no-animation` flag is provided.
  - `TERM=dumb` or non-interactive environment.

---

## 5. Keyboard Navigation & Shortcuts

| Key | Context | Action |
| :--- | :--- | :--- |
| `↑` / `k` | Commands / Logs | Move selection up / Scroll logs up 1 line. |
| `↓` / `j` | Commands / Logs | Move selection down / Scroll logs down 1 line. |
| `PageUp` / `PageDown` | Logs | Scroll logs up / down 10 lines. |
| `Home` / `End` | Logs | Jump to oldest log / Jump to newest log (resumes auto-scroll). |
| `Enter` | Commands | Execute the selected command. |
| `/` | Any | Focus Command Search / Palette input. |
| `s` | Any | Toggle Development Server (Start if idle; Confirm Stop if running). |
| `r` | Any | Restart Development Server with clean PID cycle. |
| `u` | Any | Trigger Unit Test Suite (`app:test` / `component:test`). |
| `c` | Any | Trigger Test Coverage Run (`--coverage`). |
| `e` | Any | Trigger E2E Test Suite (if configured). |
| `b` | Any | Trigger Build (`app:build` / `component:build:demo`). |
| `l` | Any | Cycle Log Filters: `All` $\to$ `Serve` $\to$ `Unit` $\to$ `Coverage` $\to$ `Errors`. |
| `o` | Any | Open active dev server URL in the system browser. |
| `Tab` / `Shift+Tab` | Any | Switch focus between panels (Commands $\to$ Tasks $\to$ Logs). |
| `Esc` | Modal / Search | Close modal / clear search / cancel prompt. |
| `?` | Any | Open full interactive Keybinding & Help Dialog. |
| `q` | Any | Quit TUI. If tasks are running, prompts for confirmation (`[y/N]`). |

*Non-destructive safety rule:* Stopping active servers or quitting with background tasks requires explicit confirmation (`y`/`n`), preventing accidental process termination.

---

## 6. Process Supervision & Concurrency Model

### 6.1 Process Port & Concurrency Rules

```
                      +-----------------------------+
                      |   TaskSupervisor Registry   |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               |                                           |
               v                                           v
    [Persistent Server Task]                    [Transient Task Queue]
    (app:dev / component:dev)                   (tests / coverage / lint / build)
    - Only 1 instance at a time                 - Max 1 writer per artifact directory
    - Stays alive across test runs              - Independent cancellation token
```

### Concurrency Matrix

| Primary Task Running | Requested Task | Allowed? | Behavior |
| :--- | :--- | :---: | :--- |
| `app:dev` (PID A) | `app:test` | **YES** | Runs unit tests in background; `app:dev` retains PID A and continues serving HTTP/HMR. |
| `app:dev` (PID A) | `app:test --coverage` | **YES** | Runs coverage; `app:dev` retains PID A. |
| `component:dev` (PID A) | `component:test` | **YES** | Runs unit tests; `component:dev` retains PID A. |
| `component:dev` (PID A) | `component:test --coverage`| **YES** | Runs coverage; `component:dev` retains PID A. |
| `component:dev` (PID A) | `component:lint` | **YES** | Runs ESLint concurrently. |
| `component:dev` (PID A) | `component:locales` | **YES** | Generates locales; HMR detects updated JSON files. |
| `component:dev` (PID A) | `component:build:demo` | **YES** | Compiles demo bundle to `dist/`. |
| `app:test` (running) | `app:test --coverage` | **NO** | Rejects / queues with message: *"Test suite already executing"*. |
| `app:build` (running) | `app:build` | **NO** | Rejects with message: *"Build already executing on target output"*. |

### 6.2 Task Model & Lifecycle States

Each managed task adheres to the following immutable interface:
```javascript
{
  id: "task-cov-1723724580",
  type: "coverage",              // 'serve' | 'unit' | 'coverage' | 'e2e' | 'lint' | 'build' | 'doc' | 'locales'
  logicalCommand: "component:test --coverage",
  argv: ["node", "src/...", "--coverage"],
  pid: 41380,
  status: "running",            // 'idle' | 'starting' | 'running' | 'passed' | 'failed' | 'stopping' | 'stopped'
  startedAt: 1723724580120,
  finishedAt: null,
  exitCode: null,
  abortController: AbortController,
  url: undefined,
  port: undefined,
  metrics: { passed: 4, failures: 0, coveragePct: 96.4 }
}
```

### 6.3 Signal Management & Cleanup Protocol

1. **Subprocess Spawning**: Children are spawned using `NodeProcessRunner` with `shell: false`, detached process groups on POSIX (`detached: true`), and explicit argv arrays.
2. **Cancellation**: Triggering task cancellation fires `abortController.abort()`, sending `SIGINT` to the child process group.
3. **Grace Period & Escalation**:
   - Waits up to `500ms` for clean exit.
   - If child is still alive, sends `SIGTERM`.
   - After another `500ms`, sends `SIGKILL` only to owned PIDs.
4. **Session Teardown**:
   - When exiting (`q` or `SIGINT` to the main process):
     - Stops animation interval.
     - Disables raw mode (`process.stdin.setRawMode(false)`).
     - Restores standard screen buffer (`\x1b[?1049l`).
     - Restores cursor visibility (`\x1b[?25h`).
     - Gracefully terminates all owned child processes.
     - Never leaves dangling ports or orphaned child processes.

---

## 7. Logging, File Change Detection & Secret Redaction

### 7.1 Ring Buffer & Log Management
- Fixed capacity ring buffer (**2,000 log entries** per session).
- Automatically evicts oldest lines when limit is reached (bounded memory footprint $< 4\text{MB}$).
- Combined `stdout` and `stderr` streams tagged with timestamps and task identifiers.
- **Scroll Lock:** When the user scrolls up to review history, automatic scrolling pauses and displays `[NEW LOGS AVAILABLE (N)]`. Pressing `End` or scrolling to the bottom immediately re-engages live auto-scrolling.

### 7.2 Sensitive Data Redaction
Before appending any chunk to the ring buffer, logs pass through a sanitizer that redacts:
- NPM and GitHub tokens: `(?:_authToken|NPM_TOKEN|ghp_[A-Za-z0-9]+)\s*=\s*[\S]+` $\to$ `[REDACTED_TOKEN]`
- HTTP Basic Auth URLs: `https?://[^\s/@:]+:[^\s/@]+@` $\to$ `https://[REDACTED_AUTH]@`
- Private key headers and JWT tokens.

### 7.3 HMR & File Change Detection
- Reuses Vite’s internal file watcher events (e.g. `[vite] hmr update /src/...`).
- Displays relative file paths only (e.g., `src/MyButton.js`), never exposing absolute local machine paths.
- Records and displays the "Last Updated" timestamp in the status header.

---

## 8. Command Grammar & Compatibility Aliases

### 8.1 Unified Command Table

The 19 canonical commands and their compatibility aliases are unified in a single immutable table:

| Canonical Command | Compatibility Alias(es) | Description Key |
| :--- | :--- | :--- |
| `component:dev` | `lit-component:serve`, `lit-components:serve` | `command_component_dev` |
| `component:test` | `lit-component:test` | `command_component_test` |
| `component:documentation` | `lit-component:documentation` | `command_component_documentation` |
| `component:locales` | `lit-component:locales` | `command_component_locales` |
| `component:build:demo` | `lit-component:build:demo` | `command_component_build_demo` |
| `component:lint` | `lit-component:lint` | `command_component_lint` |
| `component:create` | — | `command_component_create` |
| `component:install` | — | `command_component_install` |
| `component:changelog` | — | `command_component_changelog` |
| `component:sass` | — | `command_component_sass` |
| `app:dev` | — | `command_app_dev` |
| `app:test` | — | `command_app_test` |
| `app:build` | — | `command_app_build` |
| `app:preview` | — | `command_app_preview` |
| `app:lint` | — | `command_app_lint` |
| `app:locales` | — | `command_app_locales` |
| `app:create` | — | `command_app_create` |
| `app:install` | — | `command_app_install` |
| `app:changelog` | — | `command_app_changelog` |

All aliases resolve to the exact same use case handlers and parameter definitions in `src/cli/composition.js`.

---

## 9. Proposed File Tree for TUI Implementation

```
cli/
├── bin/
│   └── cells.js                          (Updated entrypoint with TTY / TUI detection)
├── src/
│   ├── cli/
│   │   ├── command-registry.js           (Catalog metadata for TUI discovery)
│   │   ├── parse-argv.js                 (Updated with plural alias & TUI routing)
│   │   └── render-help.js                (Updated alias presentation)
│   ├── domain/
│   │   └── tui/
│   │       ├── command-catalog.js        (Canonical & alias mappings)
│   │       ├── ring-buffer.js            (Bounded FIFO log buffer)
│   │       ├── session-state.js          (Pure state reducers & view models)
│   │       └── task-state.js             (Task lifecycle state machines)
│   ├── ports/
│   │   ├── task-supervisor.js            (Port definition for task supervisor)
│   │   └── terminal-screen.js            (Port definition for terminal I/O)
│   ├── adapters/
│   │   ├── node/
│   │   │   └── task-supervisor.js        (Process supervisor adapter)
│   │   └── terminal/
│   │       ├── ansi-screen.js            (Escape codes, alternate buffer, raw mode)
│   │       ├── box-drawing.js            (Responsive Unicode/ASCII layout boxes)
│   │       ├── log-sanitizer.js          (Credential & secret redaction)
│   │       ├── terminal-renderer.js      (Screen painter & event dispatcher)
│   │       └── title-animator.js         (Throttled 8-12 FPS header animation)
│   └── application/
│       └── tui/
│           ├── start-tui.js              (TUI composition root)
│           ├── tui-controller.js         (Interaction & keybinding coordinator)
│           └── workspace-inspector.js    (Non-destructive app/component detector)
└── test/
    ├── domain/
    │   ├── ring-buffer.test.js           (FIFO eviction & capacity tests)
    │   └── session-state.test.js         (State reducer & transition tests)
    ├── contract/
    │   ├── tui-grammar.test.js           (Contract tests for cells, cells tui, aliases)
    │   └── supervisor-contract.test.js   (Process state & concurrency contract tests)
    └── integration/
        ├── tui-pty-lifecycle.test.js     (PTY-based TUI startup & teardown tests)
        ├── tui-supervisor-serve.test.js  (Serve + test concurrency & PID preservation)
        └── tui-acceptance-lifecycle.test.js (Full end-to-end acceptance suite)
```

---

## 10. TDD Implementation Plan & Phases

### Phase 1: Grammar, Contracts & Invocations
- **RED:** Add tests in `test/contract/tui-grammar.test.js` verifying:
  - `cells` on interactive TTY invokes TUI runner.
  - `cells tui` explicitly invokes TUI runner.
  - `cells` on non-TTY / pipe / `TERM=dumb` prints textual help and exits with 0.
  - `cells --help` prints textual help.
  - `lit-components:serve` resolves identically to `component:dev`.
- **GREEN:** Implement routing in `bin/cells.js` and alias normalization in `src/cli/parse-argv.js`.

### Phase 2: Domain State & Task Supervisor
- **RED:** Add tests in `test/domain/session-state.test.js`, `ring-buffer.test.js`, and `test/contract/supervisor-contract.test.js` verifying:
  - Task state transitions (`idle` $\to$ `starting` $\to$ `running` $\to$ `passed`/`failed`/`stopped`).
  - Ring buffer capacity limits, eviction, and secret redaction.
  - Task supervisor concurrency: allowing `serve` + `unit` / `coverage` while preserving server PID.
  - Clean `SIGINT` abort handling and process group settlement.
- **GREEN:** Implement `src/domain/tui/*` and `src/adapters/node/task-supervisor.js`.

### Phase 3: Terminal Renderer, Responsive Layout & Title Animation
- **RED:** Add tests for `box-drawing.js`, `terminal-renderer.js`, and `title-animator.js` verifying:
  - Responsive box calculations for wide ($\ge 100$), medium ($70-99$), and narrow ($<70$) columns.
  - Keyboard key parsing (`j/k`, arrows, shortcuts, `Tab`, `Enter`, `Esc`, `q`).
  - Animation frame throttling (8–12 FPS), suspension on idle, and static fallback when `NO_COLOR` or `--no-animation` is set.
  - Complete terminal state restoration on exit (alternate screen, cursor, raw mode).
- **GREEN:** Implement `src/adapters/terminal/*`.

### Phase 4: Application TUI Controller & Action Dispatching
- **RED:** Add tests in `test/integration/tui-supervisor-serve.test.js` verifying:
  - `s` key starts `app:dev` / `component:dev`.
  - `u` key triggers unit tests while server is active.
  - `c` key triggers coverage while server is active.
  - `r` restarts the server with fresh PID.
  - `l` cycles log filters.
- **GREEN:** Implement `src/application/tui/tui-controller.js` and `workspace-inspector.js`.

### Phase 5: End-to-End Acceptance on Real Workspaces
- **Acceptance Steps:**
  1. Package CLI locally via `packSelf`.
  2. Scaffold a fresh OpenCells Application and Lit Component in clean temporary workspaces.
  3. Launch TUI session in simulated PTY.
  4. Start dev server from TUI; verify HTTP 200 and HMR websocket endpoint.
  5. Run unit tests and coverage from TUI without terminating the dev server; verify lcov report and PID persistence.
  6. Trigger a local file modification; verify HMR update is reflected in the TUI log panel.
  7. Exit TUI; verify all child processes, PIDs, and ports are completely released.

### Phase 6: Release Gates & Packaging Verification
- Execute `npm run verify:release`.
- Verify `git diff --check`, no absolute local paths, no credentials, no private registry leaks.
- Run `npm pack --dry-run --json` to ensure tarball contains only production files.

---

## 11. Acceptance & Definition of Done

The feature is complete when all of the following conditions are demonstrated:
1. `cells` opens an interactive TUI in any TTY terminal.
2. `cells lit-component:serve` and `cells lit-components:serve` execute reliably.
3. Dev server remains running with constant PID while unit tests and coverage runs execute concurrently.
4. Server URL, port, PID, test metrics, and HMR logs are live in the TUI.
5. Log scroll, filters, search, and credential redaction work without dropping events.
6. Title animation runs smoothly at 8–12 FPS and falls back to static under `NO_COLOR`, `TERM=dumb`, or `--no-animation`.
7. Exiting TUI completely restores the user's terminal and terminates all spawned child processes.
8. All unit, contract, integration, and security release tests pass cleanly.
