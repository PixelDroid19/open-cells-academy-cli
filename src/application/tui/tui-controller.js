import { createSessionState, sessionReducer } from '../../domain/tui/session-state.js';
import path from 'node:path';
import { createCommandRegistry } from '../../cli/command-registry.js';
import { parseArgv } from '../../cli/parse-argv.js';
import { validateProjectName } from '../../domain/path-policy.js';
import { filterCommands, getCommandCatalog } from '../../domain/tui/command-catalog.js';
import { sanitizeTerminalText } from '../../domain/tui/ring-buffer.js';
import { ANSI_SEQUENCES, parseKeySequence } from '../../adapters/terminal/ansi-screen.js';
import { renderTuiHeader, renderTuiView } from '../../adapters/terminal/terminal-renderer.js';
import { translate } from '../../i18n/translator.js';

const LOG_FILTERS = Object.freeze(['all', 'serve', 'unit', 'coverage', 'error']);
const PAGE_SIZE = 10;
const LOG_REDRAW_DELAY_MS = 16;
const LOCAL_SERVER_OPTIONS = Object.freeze(['--host', '127.0.0.1', '--port', '8001', '--strictPort', '--no-open']);
const APP_SCAFFOLDS = Object.freeze(['academy-app', 'blank', 'web-app', 'web-mobile-app']);
const CREATE_COMMAND_REGISTRY = createCommandRegistry();
const COMMAND_TASK_TYPES = Object.freeze({
  'app:install': 'install',
  'component:install': 'install',
  'app:create': 'create',
  'component:create': 'create',
  'app:changelog': 'changelog',
  'component:changelog': 'changelog',
  'app:lint': 'lint',
  'component:lint': 'lint',
  'app:locales': 'locales',
  'component:locales': 'locales',
  'component:documentation': 'documentation',
  'component:sass': 'sass'
});

function isLocalHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createFormFields(kind) {
  return kind === 'app'
    ? ['name', 'profile', 'e2e', 'installDeps']
    : ['name', 'namespace', 'e2e', 'installDeps'];
}

function validComponentName(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value);
}

function validNamespace(value) {
  const normalized = typeof value === 'string' && value.startsWith('@') ? value : `@${value ?? ''}`;
  return /^@[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(normalized);
}

function toDisplayPath(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function isWorkspaceRelative(value) {
  return value.length > 0
    && value !== '..'
    && !value.startsWith(`..${path.sep}`)
    && !path.isAbsolute(value);
}

function displayHmrFile(file, workspaceRoot) {
  const safeFile = sanitizeTerminalText(String(file ?? ''));
  if (safeFile.length === 0) {
    return '';
  }

  // Vite's browser-facing paths are already workspace-root-relative even
  // though they begin with a slash.
  if (safeFile.startsWith('/src/')) {
    return safeFile.slice(1);
  }

  const root = path.resolve(sanitizeTerminalText(String(workspaceRoot || process.cwd())));
  if (path.isAbsolute(safeFile)) {
    const relative = path.relative(root, safeFile);
    return isWorkspaceRelative(relative)
      ? toDisplayPath(relative)
      : toDisplayPath(path.basename(safeFile));
  }

  const normalized = path.normalize(safeFile);
  return isWorkspaceRelative(normalized)
    ? toDisplayPath(normalized)
    : toDisplayPath(path.basename(normalized));
}

/**
 * Controller coordinating TUI user interaction, process supervision, and terminal rendering.
 */
export class TuiController {
  #state;
  #stdin;
  #stdout;
  #supervisor;
  #ringBuffer;
  #titleAnimator;
  #animationTimer;
  #animationIntervalMs;
  #isClosed;
  #onCloseResolver;
  #closedPromise;
  #dataListener;
  #resizeListener;
  #resizeTimer;
  #resizeDebounceMs;
  #logRedrawTimer;
  #logRedrawDelayMs;
  #cliEntrypoint;
  #signalSource;
  #signalListeners;
  #terminalEvents;
  #terminalEventListeners;
  #closePromise;
  #urlOpener;
  #colorEnabled;
  #createForm;

  constructor({
    workspace = { name: 'workspace', type: 'unknown', root: process.cwd() },
    language = 'en',
    stdin = process.stdin,
    stdout = process.stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    animationIntervalMs = 100,
    cliEntrypoint = path.resolve(process.cwd(), 'bin/cells.js'),
    signalSource = process,
    terminalEvents = stdout,
    resizeDebounceMs = 50,
    logRedrawDelayMs = LOG_REDRAW_DELAY_MS,
    urlOpener,
    colorEnabled = true
  } = {}) {
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#supervisor = supervisor;
    this.#ringBuffer = ringBuffer;
    this.#titleAnimator = titleAnimator;
    this.#animationIntervalMs = animationIntervalMs;
    this.#cliEntrypoint = path.resolve(cliEntrypoint);
    this.#signalSource = signalSource;
    this.#terminalEvents = terminalEvents;
    this.#resizeDebounceMs = resizeDebounceMs;
    this.#logRedrawDelayMs = Number.isSafeInteger(logRedrawDelayMs) && logRedrawDelayMs >= 0 ? logRedrawDelayMs : LOG_REDRAW_DELAY_MS;
    this.#urlOpener = urlOpener;
    this.#colorEnabled = Boolean(colorEnabled);
    this.#createForm = undefined;
    this.#signalListeners = [];
    this.#terminalEventListeners = [];
    this.#isClosed = false;

    this.#state = createSessionState({
      workspace,
      language
    });

    this.#closedPromise = new Promise(resolve => {
      this.#onCloseResolver = resolve;
    });
  }

  get state() {
    return this.#state;
  }

  get isClosed() {
    return this.#isClosed;
  }

  get closed() {
    return this.#closedPromise;
  }

  async start() {
    if (this.#isClosed) return;
    try {
      if (typeof this.#stdout.write === 'function') {
        this.#stdout.write(ANSI_SEQUENCES.enterAlternateScreen);
        this.#stdout.write(ANSI_SEQUENCES.hideCursor);
      }

      if (typeof this.#stdin.setRawMode === 'function') {
        this.#stdin.setRawMode(true);
      }
      if (typeof this.#stdin.resume === 'function') {
        this.#stdin.resume();
      }

      this.#dataListener = chunk => this.#handleInput(chunk);
      if (typeof this.#stdin.on === 'function') {
        this.#stdin.on('data', this.#dataListener);
      }

      this.#resizeListener = () => this.#scheduleResize();
      if (typeof this.#stdout.on === 'function') {
        this.#stdout.on('resize', this.#resizeListener);
      }

      if (typeof this.#terminalEvents?.on === 'function') {
        const blurListener = () => this.#titleAnimator?.suspend();
        const focusListener = () => this.#titleAnimator?.touch();
        this.#terminalEventListeners.push(['blur', blurListener], ['focus', focusListener]);
        this.#terminalEvents.on('blur', blurListener);
        this.#terminalEvents.on('focus', focusListener);
      }

      for (const [signalName, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
        const listener = () => {
          void this.close({ exitCode });
        };
        this.#signalListeners.push([signalName, listener]);
        this.#signalSource?.on?.(signalName, listener);
      }

      if (this.#titleAnimator?.isEnabled) {
        this.#animationTimer = setInterval(() => {
          if (!this.#isClosed && this.#titleAnimator.tick()) {
            this.redrawHeader();
          }
        }, this.#animationIntervalMs);
      }

      this.redraw();
    } catch (cause) {
      try {
        await this.close({ exitCode: 1 });
      } catch {
        // Preserve the setup failure after a best-effort terminal rollback.
      }
      throw cause;
    }
  }

  async close({ exitCode = 0 } = {}) {
    if (this.#closePromise !== undefined) {
      return this.#closePromise;
    }
    this.#closePromise = this.#close({ exitCode });
    return this.#closePromise;
  }

  async #close({ exitCode }) {
    this.#isClosed = true;

    if (this.#animationTimer) {
      clearInterval(this.#animationTimer);
      this.#animationTimer = undefined;
    }
    if (this.#resizeTimer) {
      clearTimeout(this.#resizeTimer);
      this.#resizeTimer = undefined;
    }
    if (this.#logRedrawTimer !== undefined) {
      clearTimeout(this.#logRedrawTimer);
      this.#logRedrawTimer = undefined;
    }

    if (this.#dataListener && typeof this.#stdin.removeListener === 'function') {
      this.#stdin.removeListener('data', this.#dataListener);
    }
    if (this.#resizeListener && typeof this.#stdout.removeListener === 'function') {
      this.#stdout.removeListener('resize', this.#resizeListener);
    }
    for (const [signalName, listener] of this.#signalListeners) {
      this.#signalSource?.removeListener?.(signalName, listener);
    }
    this.#signalListeners = [];
    for (const [eventName, listener] of this.#terminalEventListeners) {
      this.#terminalEvents?.removeListener?.(eventName, listener);
    }
    this.#terminalEventListeners = [];

    if (typeof this.#stdin.setRawMode === 'function') {
      try {
        this.#stdin.setRawMode(false);
      } catch {}
    }
    if (typeof this.#stdin.pause === 'function') {
      this.#stdin.pause();
    }

    if (typeof this.#stdout.write === 'function') {
      try {
        this.#stdout.write(ANSI_SEQUENCES.showCursor);
      } catch {}
      try {
        this.#stdout.write(ANSI_SEQUENCES.leaveAlternateScreen);
      } catch {}
    }

    try {
      if (this.#supervisor) {
        await this.#supervisor.stopAll();
      }
    } catch {
      // Terminal restoration and controller settlement must not depend on a child cleanup report.
    } finally {
      this.#onCloseResolver?.({ exitCode });
    }
  }

  #scheduleResize() {
    if (this.#isClosed) {
      return;
    }
    if (this.#resizeTimer) {
      clearTimeout(this.#resizeTimer);
    }
    this.#resizeTimer = setTimeout(() => {
      this.#resizeTimer = undefined;
      this.redraw();
    }, this.#resizeDebounceMs);
  }

  #scheduleLogRedraw() {
    if (this.#isClosed || this.#logRedrawTimer !== undefined) {
      return;
    }
    this.#logRedrawTimer = setTimeout(() => {
      this.#logRedrawTimer = undefined;
      this.redraw();
    }, this.#logRedrawDelayMs);
  }

  redraw() {
    if (this.#isClosed || typeof this.#stdout.write !== 'function') return;
    const columns = this.#stdout.columns || 80;
    const rows = this.#stdout.rows || 24;

    const frame = renderTuiView({
      state: this.#state,
      ringBuffer: this.#ringBuffer,
      titleAnimator: this.#titleAnimator,
      dimensions: { columns, rows },
      colorEnabled: this.#colorEnabled,
      createForm: this.#createForm
    });

    this.#stdout.write(frame);
  }

  redrawHeader() {
    if (this.#isClosed || typeof this.#stdout.write !== 'function') return;
    const columns = this.#stdout.columns || 80;
    const header = renderTuiHeader({
      state: this.#state,
      titleAnimator: this.#titleAnimator,
      width: columns,
      colorEnabled: this.#colorEnabled
    });
    this.#stdout.write(`${ANSI_SEQUENCES.saveCursor}${ANSI_SEQUENCES.cursorHome}${ANSI_SEQUENCES.eraseLine}${header}${ANSI_SEQUENCES.restoreCursor}`);
  }

  dispatch(action) {
    this.#state = sessionReducer(this.#state, action);
    this.redraw();
  }

  handleTaskUpdate(task) {
    this.dispatch({ type: 'TASK_UPSERT', task });
  }

  handleLog(log) {
    this.#ringBuffer.append(log);
    this.#state = sessionReducer(this.#state, { type: 'LOG_RECEIVED' });
    this.#titleAnimator?.touch();
    this.#scheduleLogRedraw();
  }

  handleHmrUpdate(file) {
    this.dispatch({
      type: 'UPDATE_HMR',
      file: displayHmrFile(file, this.#state.workspace?.root),
      timestamp: Date.now()
    });
  }

  handleTestMetrics(metrics) {
    this.dispatch({
      type: 'UPDATE_TEST_METRICS',
      testResult: metrics.passed !== undefined ? { passed: metrics.passed, failures: metrics.failures ?? 0 } : undefined,
      coverageResult: metrics.coveragePct !== undefined ? { linesPct: metrics.coveragePct } : undefined
    });
  }

  async #handleInput(chunk) {
    if (this.#isClosed) return;
    const input = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    const parsedKey = parseKeySequence(input);
    if (parsedKey.name === 'unknown' && !input.includes('\x1b')) {
      for (const character of input) {
        await this.#handleInput(character);
        if (this.#isClosed) {
          break;
        }
      }
      return;
    }

    this.#titleAnimator?.touch();
    const key = parsedKey;

    if (key.ctrl && key.name === 'c') {
      await this.close({ exitCode: 130 });
      return;
    }

    // Modal Handling
    if (this.#state.modal) {
      if (this.#state.modal === 'create') {
        await this.#handleCreateFormInput(key);
        return;
      }
      if (key.name === 'escape' || (key.name === 'question' && this.#state.modal === 'help')) {
        this.dispatch({ type: 'CLOSE_MODAL' });
        return;
      }

      if (this.#state.modal === 'confirm_quit') {
        if (key.name === 'y' || key.name === 'return') {
          await this.close({ exitCode: 0 });
        } else {
          this.dispatch({ type: 'CLOSE_MODAL' });
        }
        return;
      }

      if (this.#state.modal === 'confirm_stop') {
        if (key.name === 'y' || key.name === 'return') {
          const activeServer = this.#supervisor.getActiveServer();
          if (activeServer) {
            await this.#supervisor.cancelTask(activeServer.id);
          }
          this.dispatch({ type: 'CLOSE_MODAL' });
        } else {
          this.dispatch({ type: 'CLOSE_MODAL' });
        }
        return;
      }

      return;
    }

    if (this.#state.searchActive) {
      if (key.name === 'escape') {
        this.dispatch({ type: 'END_SEARCH', clear: true });
        return;
      }
      if (key.name === 'backspace') {
        this.dispatch({ type: 'SET_SEARCH_QUERY', query: this.#state.searchQuery.slice(0, -1) });
        return;
      }
      if (key.name === 'return') {
        this.dispatch({ type: 'END_SEARCH', clear: false });
        return;
      }
      if (typeof key.sequence === 'string' && /^[\x20-\x7e]$/.test(key.sequence)) {
        this.dispatch({ type: 'SET_SEARCH_QUERY', query: `${this.#state.searchQuery}${key.sequence}` });
      }
      return;
    }

    if (key.name === 'slash') {
      this.dispatch({ type: 'START_SEARCH' });
      return;
    }

    // Modal Triggers
    if (key.name === 'question' || key.sequence === '?') {
      this.dispatch({ type: 'OPEN_MODAL', modal: 'help' });
      return;
    }

    if (key.name === 'q') {
      const runningTasks = this.#state.tasks.filter(t => t.status === 'running' || t.status === 'starting');
      if (runningTasks.length > 0) {
        this.dispatch({ type: 'OPEN_MODAL', modal: 'confirm_quit' });
      } else {
        await this.close({ exitCode: 0 });
      }
      return;
    }

    // Panel Navigation
    if (key.name === 'tab') {
      const panels = ['commands', 'tasks', 'logs'];
      const currentIdx = panels.indexOf(this.#state.focusedPanel);
      const nextIdx = key.shift
        ? (currentIdx - 1 + panels.length) % panels.length
        : (currentIdx + 1) % panels.length;
      this.dispatch({ type: 'FOCUS_PANEL', panel: panels[nextIdx] });
      return;
    }

    // Up / Down / Selection
    if (key.name === 'up' || key.name === 'k') {
      if (this.#state.focusedPanel === 'logs') {
        this.dispatch({ type: 'SET_LOG_OFFSET', offset: this.#state.logOffset + 1 });
      } else {
        this.dispatch({ type: 'SELECT_COMMAND_INDEX', index: Math.max(0, this.#state.selectedCommandIndex - 1) });
      }
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      if (this.#state.focusedPanel === 'logs') {
        const offset = Math.max(0, this.#state.logOffset - 1);
        this.dispatch(offset === 0 ? { type: 'SET_AUTO_SCROLL', autoScroll: true } : { type: 'SET_LOG_OFFSET', offset });
      } else {
        const catalog = getCommandCatalog();
        const filtered = filterCommands(catalog, this.#state.searchQuery, this.#state.workspace.type);
        this.dispatch({
          type: 'SELECT_COMMAND_INDEX',
          index: Math.min(filtered.length - 1, this.#state.selectedCommandIndex + 1)
        });
      }
      return;
    }

    // Paging
    if (key.name === 'pageup') {
      this.dispatch({ type: 'SET_LOG_OFFSET', offset: this.#state.logOffset + PAGE_SIZE });
      return;
    }

    if (key.name === 'pagedown') {
      const offset = Math.max(0, this.#state.logOffset - PAGE_SIZE);
      this.dispatch(offset === 0 ? { type: 'SET_AUTO_SCROLL', autoScroll: true } : { type: 'SET_LOG_OFFSET', offset });
      return;
    }

    if (key.name === 'home') {
      this.dispatch({ type: 'SET_LOG_OFFSET', offset: Number.MAX_SAFE_INTEGER });
      return;
    }

    if (key.name === 'end') {
      this.dispatch({ type: 'SET_AUTO_SCROLL', autoScroll: true });
      return;
    }

    // Log Filter Cycling
    if (key.name === 'l') {
      const currentIdx = LOG_FILTERS.indexOf(this.#state.logFilter);
      const nextFilter = LOG_FILTERS[(currentIdx + 1) % LOG_FILTERS.length];
      this.dispatch({ type: 'SET_LOG_FILTER', filter: nextFilter });
      return;
    }

    // Shortcuts: Serve / Dev
    if (key.name === 's') {
      const activeServer = this.#supervisor.getActiveServer();
      if (activeServer) {
        this.dispatch({ type: 'OPEN_MODAL', modal: 'confirm_stop' });
      } else {
        await this.#runServe();
      }
      return;
    }

    // Shortcuts: Restart Server
    if (key.name === 'r') {
      const activeServer = this.#supervisor.getActiveServer();
      if (activeServer) {
        await this.#supervisor.restartTask(activeServer.id);
      }
      return;
    }

    // Shortcuts: Unit Tests
    if (key.name === 'u') {
      await this.#runUnitTests();
      return;
    }

    // Shortcuts: Coverage
    if (key.name === 'c') {
      await this.#runCoverage();
      return;
    }

    if (key.name === 'e') {
      await this.#runE2e();
      return;
    }

    if (key.name === 'p') {
      await this.#runPreview();
      return;
    }

    if (key.name === 'i') {
      await this.#runLocales();
      return;
    }

    if (key.name === 'd') {
      await this.#runDocumentation();
      return;
    }

    if (key.name === '+') {
      if (this.#state.workspace.type === 'app' || this.#state.workspace.type === 'component') {
        this.#openCreateForm(this.#state.workspace.type);
      }
      return;
    }

    if (key.name === 'o') {
      await this.#openActiveServer();
      return;
    }

    // Shortcuts: Build
    if (key.name === 'b') {
      await this.#runBuild();
      return;
    }

    // Execute Selected
    if (key.name === 'return') {
      const catalog = getCommandCatalog();
      const filtered = filterCommands(catalog, this.#state.searchQuery, this.#state.workspace.type);
      const selected = filtered[this.#state.selectedCommandIndex];
      if (selected) {
        await this.#executeCommand(selected.name);
      }
    }
  }

  async #runServe() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:dev' : 'component:dev';
    const config = isApp ? this.#configFor('dev') : undefined;
    if (isApp && config === undefined) {
      this.#reportError('tui_error_config_dev');
      return;
    }
    const args = isApp
      ? [this.#cliEntrypoint, 'app:dev', '-c', config, ...LOCAL_SERVER_OPTIONS]
      : [this.#cliEntrypoint, 'component:dev', ...LOCAL_SERVER_OPTIONS];

    try {
      await this.#supervisor.startTask({
        type: 'serve',
        logicalCommand: commandName,
        file: process.execPath,
        args,
        cwd: this.#state.workspace.root,
        isServer: true,
        port: 8001
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('serve') });
    }
  }

  async #runUnitTests() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:test' : 'component:test';
    const runnerArgs = this.#state.workspace.testRunner === 'wtr' ? ['--wtr'] : [];

    try {
      await this.#supervisor.startTask({
        type: 'unit',
        logicalCommand: [commandName, ...runnerArgs].join(' '),
        file: process.execPath,
        args: [this.#cliEntrypoint, commandName, ...runnerArgs],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('unit') });
    }
  }

  async #runCoverage() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:test' : 'component:test';
    const runnerArgs = this.#state.workspace.testRunner === 'wtr' ? ['--wtr'] : [];

    try {
      await this.#supervisor.startTask({
        type: 'coverage',
        logicalCommand: [commandName, ...runnerArgs, '--coverage'].join(' '),
        file: process.execPath,
        args: [this.#cliEntrypoint, commandName, ...runnerArgs, '--coverage'],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('coverage') });
    }
  }

  async #runE2e() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:test' : 'component:test';

    try {
      await this.#supervisor.startTask({
        type: 'e2e',
        logicalCommand: `${commandName} --wtr`,
        file: process.execPath,
        args: [this.#cliEntrypoint, commandName, '--wtr'],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('e2e') });
    }
  }

  async #runPreview() {
    if (this.#state.workspace.type !== 'app') {
      return;
    }
    const config = this.#configFor('build');
    if (config === undefined) {
      this.#reportError('tui_error_config_preview');
      return;
    }
    try {
      await this.#supervisor.startTask({
        type: 'serve',
        logicalCommand: 'app:preview',
        file: process.execPath,
        args: [this.#cliEntrypoint, 'app:preview', '-c', config, ...LOCAL_SERVER_OPTIONS],
        cwd: this.#state.workspace.root,
        isServer: true,
        port: 8001
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('preview') });
    }
  }

  async #runLocales() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:locales' : 'component:locales';
    const config = isApp ? this.#configFor('dev') : undefined;
    if (isApp && config === undefined) {
      this.#reportError('tui_error_config_locales');
      return;
    }
    try {
      await this.#supervisor.startTask({
        type: 'locales',
        logicalCommand: commandName,
        file: process.execPath,
        args: isApp ? [this.#cliEntrypoint, commandName, '-c', config] : [this.#cliEntrypoint, commandName],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('locales') });
    }
  }

  async #runDocumentation() {
    if (this.#state.workspace.type !== 'component') {
      return;
    }
    try {
      await this.#supervisor.startTask({
        type: 'documentation',
        logicalCommand: 'component:documentation',
        file: process.execPath,
        args: [this.#cliEntrypoint, 'component:documentation'],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('documentation') });
    }
  }

  async #runBuild() {
    const isApp = this.#state.workspace.type === 'app';
    const commandName = isApp ? 'app:build' : 'component:build:demo';
    const config = isApp ? this.#configFor('build') : undefined;
    if (isApp && config === undefined) {
      this.#reportError('tui_error_config_build');
      return;
    }
    const args = isApp
      ? [this.#cliEntrypoint, 'app:build', '-c', config]
      : [this.#cliEntrypoint, 'component:build:demo'];

    try {
      await this.#supervisor.startTask({
        type: 'build',
        logicalCommand: commandName,
        file: process.execPath,
        args,
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('build') });
    }
  }

  async #executeCommand(name) {
    if (name === 'app:create' || name === 'component:create') {
      this.#openCreateForm(name === 'app:create' ? 'app' : 'component');
      return;
    }
    if (name === 'app:dev' || name === 'component:dev' || name === 'lit-component:serve' || name === 'lit-components:serve') {
      return this.#runServe();
    }
    if (name === 'app:test' || name === 'component:test' || name === 'lit-component:test') {
      return this.#runUnitTests();
    }
    if (name === 'app:preview') {
      return this.#runPreview();
    }
    if (name === 'app:build' || name === 'component:build:demo' || name === 'lit-component:build:demo') {
      return this.#runBuild();
    }

    if (name === 'app:locales' || name === 'component:locales') {
      return this.#runLocales();
    }
    if (name === 'component:documentation') {
      return this.#runDocumentation();
    }
    try {
      await this.#supervisor.startTask({
        type: COMMAND_TASK_TYPES[name] ?? 'generic',
        logicalCommand: name,
        file: process.execPath,
        args: [this.#cliEntrypoint, name],
        cwd: this.#state.workspace.root
      });
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel(COMMAND_TASK_TYPES[name] ?? 'generic') });
    }
  }

  #openCreateForm(kind) {
    this.#createForm = {
      kind,
      name: '',
      namespace: '@academy',
      profile: 'academy-app',
      e2e: false,
      installDeps: false,
      activeIndex: 0
    };
    this.dispatch({ type: 'OPEN_MODAL', modal: 'create' });
  }

  #closeCreateForm() {
    this.#createForm = undefined;
    this.dispatch({ type: 'CLOSE_MODAL' });
  }

  #updateCreateForm(updates) {
    this.#createForm = { ...this.#createForm, ...updates };
    this.redraw();
  }

  async #handleCreateFormInput(key) {
    const form = this.#createForm;
    if (form === undefined) {
      this.dispatch({ type: 'CLOSE_MODAL' });
      return;
    }
    if (key.name === 'escape') {
      this.#closeCreateForm();
      return;
    }
    const fields = createFormFields(form.kind);
    const field = fields[form.activeIndex];
    if (key.name === 'tab') {
      this.#updateCreateForm({ activeIndex: (form.activeIndex + 1) % fields.length });
      return;
    }
    if (field === 'profile' && (key.name === 'up' || key.name === 'left' || key.name === 'down' || key.name === 'right')) {
      const direction = key.name === 'up' || key.name === 'left' ? -1 : 1;
      const current = APP_SCAFFOLDS.indexOf(form.profile);
      this.#updateCreateForm({ profile: APP_SCAFFOLDS[(current + direction + APP_SCAFFOLDS.length) % APP_SCAFFOLDS.length] });
      return;
    }
    if ((field === 'e2e' || field === 'installDeps') && (key.name === ' ' || key.name === 'left' || key.name === 'right')) {
      this.#updateCreateForm({ [field]: !form[field] });
      return;
    }
    if (key.name === 'return') {
      await this.#submitCreateForm();
      return;
    }
    if (field === 'name' || field === 'namespace') {
      if (key.name === 'backspace') {
        this.#updateCreateForm({ [field]: form[field].slice(0, -1) });
        return;
      }
      if (typeof key.sequence === 'string' && /^[\x20-\x7e]$/.test(key.sequence)) {
        this.#updateCreateForm({ [field]: `${form[field]}${key.sequence}` });
      }
    }
  }

  async #submitCreateForm() {
    const form = this.#createForm;
    if (form === undefined || !this.#validCreateForm(form)) {
      this.#reportError('tui_error_create_values');
      return;
    }
    const command = `${form.kind}:create`;
    const scaffold = form.kind === 'app'
      ? { name: form.name, scaffold: form.profile, e2e: form.e2e, installDeps: form.installDeps }
      : { name: form.name, namespace: form.namespace.startsWith('@') ? form.namespace : `@${form.namespace}` };
    const commandArgs = [command, '--scaffold', JSON.stringify(scaffold)];
    if (form.kind === 'component' && form.e2e) {
      commandArgs.push('--e2e');
    }
    if (form.kind === 'component' && form.installDeps) {
      commandArgs.push('--install-deps');
    }
    const parsed = parseArgv(commandArgs, CREATE_COMMAND_REGISTRY, { env: {} });
    if (!parsed.ok) {
      this.#reportError('tui_error_create_values');
      return;
    }
    try {
      await this.#supervisor.startTask({
        type: 'create',
        logicalCommand: command,
        file: process.execPath,
        args: [this.#cliEntrypoint, ...commandArgs],
        cwd: this.#state.workspace.root
      });
      this.#closeCreateForm();
    } catch {
      this.#reportError('tui_error_task_start', { task: this.#taskLabel('create') });
    }
  }

  #validCreateForm(form) {
    if (form.kind === 'app') {
      try {
        validateProjectName(form.name);
      } catch {
        return false;
      }
      return APP_SCAFFOLDS.includes(form.profile);
    }
    return validComponentName(form.name) && validNamespace(form.namespace);
  }

  #configFor(kind) {
    const configured = kind === 'build' ? this.#state.workspace.defaultBuildConfig : this.#state.workspace.defaultAppConfig;
    if (typeof configured !== 'string' || configured.length === 0) {
      return undefined;
    }
    const available = this.#state.workspace.appConfigs;
    if (Array.isArray(available) && !available.includes(configured)) {
      return undefined;
    }
    return configured;
  }

  async #openActiveServer() {
    const url = this.#state.serverStatus?.status === 'running' ? this.#state.serverStatus.url : undefined;
    if (!isLocalHttpUrl(url)) {
      this.#reportError('tui_error_server_not_ready');
      return;
    }
    if (typeof this.#urlOpener !== 'function') {
      this.#reportError('tui_error_url_unavailable');
      return;
    }
    try {
      await this.#urlOpener(url);
    } catch {
      this.#reportError('tui_error_url_open');
    }
  }

  #taskLabel(type) {
    return translate(this.#state.language, `tui_task_${type}`);
  }

  #reportError(key, params = {}) {
    this.#ringBuffer.append({
      taskId: 'system',
      type: 'error',
      message: translate(this.#state.language, key, params)
    });
    this.redraw();
  }
}
