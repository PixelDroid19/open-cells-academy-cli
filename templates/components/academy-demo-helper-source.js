export const ACADEMY_DEMO_HELPER_SOURCE = String.raw`const DEFAULT_LABELS = Object.freeze({
  brandBadge: 'SDK',
  title: 'State card',
  status: 'Interactive component demo',
  caseBasic: 'Basic',
  caseBasicDescription: 'A first case with language, event, and scoped component controls.',
  interactive: 'Interactive Demo',
  documentation: 'Documentation',
  documentationDescription: 'A compact reference for the component contract used in this demo.',
  visual: 'Visual',
  code: 'Code',
  caseLabel: 'Case',
  languageLabel: 'Language',
  languageEn: 'EN',
  languageEs: 'ES',
  hideUi: 'Hide UI',
  showUi: 'Show UI',
  livePreview: 'Live preview',
  viewport: 'Viewport preset',
  customWidth: 'Width',
  customHeight: 'Height',
  apply: 'Apply',
  responsive: 'Responsive',
  fluid: 'Fluid',
  mobile: 'Mobile',
  tablet: 'Tablet',
  desktop: 'Desktop',
  largeDesktop: 'Large Desktop',
  open: 'Open in new tab',
  patternLabel: 'Background:',
  patternDots: 'Dots',
  patternGrid: 'Grid',
  patternClean: 'Clean',
  events: 'Events',
  eventLabel: 'Event:',
  eventLatest: 'Latest event',
  eventHistory: 'History',
  clearEvents: 'Clear',
  exportEvents: 'Export',
  eventFilter: 'Filter events…',
  eventsEmpty: 'No events captured yet.',
  copy: 'Copy',
  copied: 'Copied',
  htmlSnippet: 'HTML usage',
  jsSnippet: 'JavaScript usage',
  scope: 'Scoped composition',
  scopeDescription: 'The demo registers its child controls in a local scoped registry.',
  api: 'Component contract',
  apiDescription: 'Use public properties, translated labels and emitted events.',
  apiColumn: 'API',
  contractColumn: 'Cells contract',
  evidenceColumn: 'Demo evidence',
  noCase: 'No demo case available'
});

const PRESETS = Object.freeze({
  mobile: Object.freeze({ width: '375px', height: '520px' }),
  tablet: Object.freeze({ width: '640px', height: '500px' }),
  desktop: Object.freeze({ width: '768px', height: '480px' }),
  'large-desktop': Object.freeze({ width: '1080px', height: '620px' }),
  fluid: Object.freeze({ width: '100%', height: '100%' }),
  responsive: Object.freeze({ width: '100%', height: '480px' })
});

function safeLabels(value) {
  return value && typeof value === 'object' ? { ...DEFAULT_LABELS, ...value } : { ...DEFAULT_LABELS };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function detailText(value) {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable detail]';
  }
}

class AcademyDemoCase extends HTMLElement {}

if (customElements.get('academy-demo-case') === undefined) {
  customElements.define('academy-demo-case', AcademyDemoCase);
}

class AcademyDemoHelper extends HTMLElement {
  constructor() {
    super();
    this.selected = 0;
    this.resolution = 'desktop';
    this.view = 'visual';
    this.mode = 'visual';
    this.panel = 'interactive';
    this.language = 'en';
    this.uiHidden = false;
    this.darkMode = false;
    this.pattern = 'dots';
    this.labels = safeLabels();
    this.cases = [];
    this.events = [];
    this.eventFilter = '';
    this.onMessage = event => {
      const frame = this.querySelector('[data-demo-frame]');
      if (frame === null || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.source !== 'academy-demo') return;
      if (message.kind === 'labels') {
        if (message.language !== this.language) {
          this.sendLanguage();
          return;
        }
        this.labels = safeLabels(message.labels);
        for (const demoCase of this.cases) {
          if (demoCase.headingKey && this.labels[demoCase.headingKey]) demoCase.heading = this.labels[demoCase.headingKey];
          if (demoCase.descriptionKey && this.labels[demoCase.descriptionKey]) demoCase.description = this.labels[demoCase.descriptionKey];
        }
        this.updateLabels();
        return;
      }
      if (message.kind !== 'event' || typeof message.eventType !== 'string') return;
      const allowed = (this.getAttribute('events') || '').split(',').map(value => value.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(message.eventType)) return;
      this.events = [{ type: message.eventType, detail: message.detail }, ...this.events].slice(0, 20);
      this.renderEvents();
      this.pulseEventBadge();
    };
    this.onKeyDown = event => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'v') this.setView('visual');
      if (key === 'c') this.setView('code');
      if (key === 'd') this.setView('documentation');
      if (key === 'h') this.toggleUi();
      if (event.key === 'Escape') {
        const popover = this.querySelector('[data-event-popover]');
        if (popover !== null && !popover.hidden) this.toggleEventPopover(false);
        else if (this.uiHidden) this.toggleUi();
      }
    };
  }

  connectedCallback() {
    this.cases = [...this.querySelectorAll('academy-demo-case')].map((candidate, index) => ({
      heading: candidate.getAttribute('heading') || this.labels.caseBasic,
      description: candidate.getAttribute('description') || this.labels.caseBasicDescription,
      src: candidate.getAttribute('src') || './basic.html',
      headingKey: candidate.getAttribute('heading-key') || (index === 0 ? 'caseBasic' : ''),
      descriptionKey: candidate.getAttribute('description-key') || (index === 0 ? 'caseBasicDescription' : '')
    }));
    window.addEventListener('message', this.onMessage);
    window.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  componentTag() {
    return this.getAttribute('component-tag') || 'academy-component';
  }

  get selectedCase() {
    return this.cases[this.selected] || {
      heading: this.labels.noCase,
      description: this.labels.caseBasicDescription,
      src: './basic.html'
    };
  }

  get viewport() {
    return PRESETS[this.resolution] || PRESETS.desktop;
  }

  setLanguage(language) {
    this.language = language === 'es' ? 'es' : 'en';
    document.documentElement.lang = this.language;
    this.syncLanguageControls();
    this.sendLanguage();
  }

  sendLanguage() {
    const frame = this.querySelector('[data-demo-frame]');
    if (frame?.contentWindow === undefined || frame.contentWindow === null) return;
    frame.contentWindow.postMessage({ source: 'academy-demo-host', kind: 'language', language: this.language }, window.location.origin);
  }

  setView(view) {
    this.view = ['visual', 'code', 'documentation'].includes(view) ? view : 'visual';
    this.mode = this.view === 'code' ? 'code' : 'visual';
    this.panel = this.view === 'documentation' ? 'documentation' : 'interactive';
    for (const surface of this.querySelectorAll('[data-view-surface]')) surface.hidden = surface.dataset.viewSurface !== this.view;
    for (const button of this.querySelectorAll('[data-view]')) {
      const active = button.dataset.view === this.view;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  setMode(mode) {
    this.setView(mode === 'code' ? 'code' : 'visual');
  }

  setPanel(panel) {
    this.setView(panel === 'documentation' ? 'documentation' : 'visual');
  }

  selectCase(index) {
    this.selected = Math.max(0, Math.min(index, Math.max(0, this.cases.length - 1)));
    this.events = [];
    this.eventFilter = '';
    this.render();
  }

  setPreset(preset) {
    this.resolution = PRESETS[preset] ? preset : 'desktop';
    this.applyViewport();
    this.syncViewportControls();
  }

  applyViewport() {
    const stage = this.querySelector('[data-device-frame]');
    const frame = this.querySelector('[data-demo-frame]');
    const dimensions = this.querySelector('[data-demo-dimensions]');
    if (stage === null || frame === null) return;
    stage.style.width = this.viewport.width;
    stage.style.height = this.viewport.height;
    frame.setAttribute('aria-label', this.labels.viewport + ': ' + this.viewport.width + ' x ' + this.viewport.height);
    if (dimensions !== null) dimensions.textContent = this.viewport.width.replace('px', '') + '×' + this.viewport.height.replace('px', '');
    const open = this.querySelector('[data-open]');
    if (open !== null) open.href = frame.src;
  }

  syncViewportControls() {
    for (const button of this.querySelectorAll('[data-preset]')) button.setAttribute('aria-pressed', String(button.dataset.preset === this.resolution));
  }

  syncLanguageControls() {
    for (const button of this.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === this.language));
  }

  setPattern(pattern) {
    this.pattern = ['dots', 'grid', 'clean'].includes(pattern) ? pattern : 'dots';
    const visual = this.querySelector('[data-visual-view]');
    if (visual !== null) {
      visual.classList.remove('pattern-dots', 'pattern-grid', 'pattern-clean');
      visual.classList.add('pattern-' + this.pattern);
    }
    for (const button of this.querySelectorAll('[data-pattern]')) button.setAttribute('aria-pressed', String(button.dataset.pattern === this.pattern));
  }

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    const studio = this.querySelector('[data-demo-region]');
    if (studio !== null) studio.classList.toggle('dark', this.darkMode);
    const button = this.querySelector('[data-theme-toggle]');
    if (button !== null) button.setAttribute('aria-pressed', String(this.darkMode));
  }

  toggleUi() {
    this.uiHidden = !this.uiHidden;
    const header = this.querySelector('[data-workbench-header]');
    const restore = this.querySelector('[data-show-ui]');
    if (header !== null) header.hidden = this.uiHidden;
    if (restore !== null) restore.hidden = !this.uiHidden;
    this.setAttribute('data-ui-hidden', String(this.uiHidden));
  }

  startResize(event) {
    event.preventDefault();
    const stage = this.querySelector('[data-device-frame]');
    if (stage === null) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = stage.offsetWidth;
    const startHeight = stage.offsetHeight;
    const move = current => {
      const width = Math.max(320, Math.min(1400, startWidth + current.clientX - startX));
      const height = Math.max(260, Math.min(1000, startHeight + current.clientY - startY));
      stage.style.width = width + 'px';
      stage.style.height = height + 'px';
      this.resolution = 'responsive';
      const dimensions = this.querySelector('[data-demo-dimensions]');
      if (dimensions !== null) dimensions.textContent = width + '×' + height;
      this.syncViewportControls();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  toggleEventPopover(force) {
    const popover = this.querySelector('[data-event-popover]');
    const button = this.querySelector('[data-event-toggle]');
    if (popover === null || button === null) return;
    const open = typeof force === 'boolean' ? force : popover.hidden;
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  pulseEventBadge() {
    const badge = this.querySelector('[data-event-badge]');
    if (badge === null) return;
    badge.classList.remove('event-badge-pulse');
    void badge.offsetWidth;
    badge.classList.add('event-badge-pulse');
  }

  clearEvents() {
    this.events = [];
    this.eventFilter = '';
    const filter = this.querySelector('[data-event-filter]');
    if (filter !== null) filter.value = '';
    this.renderEvents();
  }

  filterEvents(value) {
    this.eventFilter = String(value || '').trim().toLowerCase();
    this.renderEvents();
  }

  copyEvent(button) {
    const event = this.events[Number(button.dataset.eventCopy)];
    if (!event || !navigator.clipboard?.writeText) return;
    const label = button.querySelector('[data-event-copy-label]');
    const finish = () => {
      if (label === null) return;
      label.textContent = this.labels.copied;
      window.setTimeout(() => {
        if (button.isConnected) label.textContent = this.labels.copy;
      }, 1000);
    };
    navigator.clipboard.writeText(detailText(event.detail)).then(finish, finish);
  }

  exportEvents() {
    if (!this.events.length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.events, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'events.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  renderEvents() {
    const list = this.querySelector('[data-demo-events]');
    const count = this.querySelector('[data-event-count]');
    const latest = this.querySelector('[data-event-latest]');
    const latestName = this.querySelector('[data-event-latest-name]');
    const latestDetail = this.querySelector('[data-event-latest-detail]');
    if (list === null) return;
    list.replaceChildren();
    if (count !== null) count.textContent = String(this.events.length);
    if (latest !== null) latest.hidden = false;
    if (latestName !== null) latestName.textContent = this.events[0]?.type || this.labels.eventsEmpty;
    if (latestDetail !== null) latestDetail.textContent = this.events[0] ? detailText(this.events[0].detail) : '';
    const visible = this.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => !this.eventFilter || event.type.toLowerCase().includes(this.eventFilter) || detailText(event.detail).toLowerCase().includes(this.eventFilter))
      .slice(0, 10);
    if (!visible.length) {
      const empty = document.createElement('li');
      empty.className = 'event-empty';
      empty.textContent = this.labels.eventsEmpty;
      list.append(empty);
      return;
    }
    for (const { event, index } of visible) {
      const item = document.createElement('li');
      item.className = 'log-item';
      const header = document.createElement('div');
      header.className = 'log-item-header';
      const name = document.createElement('strong');
      name.textContent = event.type;
      const marker = document.createElement('span');
      marker.className = 'log-index';
      marker.textContent = '#' + String(this.events.length - index).padStart(2, '0');
      header.append(name, marker);
      const detail = document.createElement('code');
      detail.textContent = detailText(event.detail) || '{}';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.eventCopy = String(index);
      copy.setAttribute('aria-label', this.labels.copy);
      const copyLabel = document.createElement('span');
      copyLabel.dataset.eventCopyLabel = '';
      copyLabel.textContent = this.labels.copy;
      copy.append(copyLabel);
      copy.addEventListener('click', () => this.copyEvent(copy));
      item.append(header, detail, copy);
      list.append(item);
    }
  }

  copyCode(button) {
    const source = this.querySelector('[data-code-block="' + button.dataset.copy + '"]');
    if (source === null || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(source.textContent);
  }

  updateLabels() {
    for (const node of this.querySelectorAll('[data-label]')) {
      const value = this.labels[node.dataset.label];
      if (value !== undefined) node.textContent = value;
    }
    const filter = this.querySelector('[data-event-filter]');
    if (filter !== null) filter.placeholder = this.labels.eventFilter;
    const frame = this.querySelector('[data-demo-frame]');
    if (frame !== null) frame.title = this.selectedCase.heading;
    const marker = this.querySelector('[data-case-marker]');
    if (marker !== null) marker.textContent = '#' + String(this.selected + 1).padStart(2, '0');
    const select = this.querySelector('[data-case-select]');
    if (select !== null) {
      select.setAttribute('aria-label', this.labels.caseLabel);
      for (const [index, option] of [...select.options].entries()) option.textContent = String(index + 1) + '. ' + (this.cases[index]?.heading || this.labels.noCase);
    }
    this.applyViewport();
    this.syncViewportControls();
    this.syncLanguageControls();
    this.setPattern(this.pattern);
    this.renderEvents();
  }

  render() {
    const labels = this.labels;
    const selectedCase = this.selectedCase;
    const tag = this.componentTag();
    const options = this.cases.length
      ? this.cases.map((candidate, index) => '<option value="' + index + '">' + String(index + 1) + '. ' + escapeHtml(candidate.heading) + '</option>').join('')
      : '<option value="0">' + escapeHtml(labels.noCase) + '</option>';
    const htmlSnippet = '<' + tag + '></' + tag + '>';
    const jsSnippet = [
      "const element = document.querySelector('" + tag + "');",
      "element.addEventListener('" + tag + "-continue', event => {",
      '  console.log(event.type, event.detail);',
      '});'
    ].join(String.fromCharCode(10));
    const style = document.createElement('style');
    style.textContent = [
      ':host { display: block; min-height: 100vh; }',
      '.studio, .studio * { box-sizing: border-box; }',
      '.studio { --bg: #f8fafc; --surface: #fff; --soft: #f1f5f9; --hover: #e2e8f0; --line: #e2e8f0; --ink: #0f172a; --muted: #334155; --light: #475569; --accent: #0369a1; --accent-soft: #e0f2fe; min-height: 100vh; overflow: hidden; background: var(--bg); color: var(--ink); font-family: "Plus Jakarta Sans", "Avenir Next", sans-serif; }',
      '.studio.dark { --bg: #020617; --surface: #0f172a; --soft: #1e293b; --hover: #334155; --line: #1e293b; --ink: #f8fafc; --muted: #94a3b8; --light: #64748b; --accent: #38bdf8; --accent-soft: rgb(56 189 248 / 15%); }',
      '[hidden] { display: none !important; }',
      'button, select, input { font: inherit; }',
      'button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
      '.main-header { display: flex; align-items: center; justify-content: space-between; gap: .65rem; min-height: 4rem; padding: .5rem 1rem; border-bottom: 1px solid var(--line); background: var(--surface); box-shadow: 0 1px 2px rgb(15 23 42 / 5%); }',
      '.header-section { display: flex; align-items: center; gap: .7rem; min-width: 0; }',
      '.brand-badge { border-radius: 6px; padding: .28rem .42rem; background: #2563eb; color: #fff; font: 800 .58rem/1 ui-monospace, monospace; letter-spacing: .08em; }',
      '.identity { min-width: 0; }',
      '.identity h1 { overflow: hidden; margin: 0; color: var(--ink); font-size: .82rem; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }',
      '.identity p { margin: .12rem 0 0; color: var(--light); font-size: .62rem; font-weight: 600; }',
      '.divider { width: 1px; height: 1.35rem; background: var(--line); }',
      '.case-control { display: flex; align-items: center; gap: .35rem; }',
      '.case-control label { color: var(--muted); font-size: .7rem; font-weight: 700; }',
      '.case-control select { min-width: 9.5rem; min-height: 2rem; border: 1px solid var(--line); border-radius: 8px; padding: 0 1.8rem 0 .6rem; background: var(--soft); color: var(--ink); font-size: .7rem; font-weight: 700; }',
      '.pill-group { display: inline-flex; align-items: center; gap: .08rem; padding: .14rem; border: 1px solid var(--line); border-radius: 9px; background: var(--soft); }',
      '.pill { min-height: 1.75rem; border: 0; border-radius: 7px; padding: 0 .65rem; background: transparent; color: var(--muted); cursor: pointer; font-size: .68rem; font-weight: 800; white-space: nowrap; }',
      '.pill[aria-selected="true"], .pill[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgb(15 23 42 / 9%); }',
      '.dimension { color: var(--light); font: 600 .64rem ui-monospace, monospace; white-space: nowrap; }',
      '.icon-button, .outline-button { min-height: 2rem; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); color: var(--muted); cursor: pointer; font-size: .67rem; font-weight: 800; }',
      '.icon-button { width: 2rem; }',
      '.outline-button { padding: 0 .7rem; }',
      '.open-button { display: inline-grid; width: 2rem; height: 2rem; place-items: center; border-radius: 8px; background: var(--soft); color: var(--muted); text-decoration: none; }',
      '.show-ui { position: fixed; z-index: 50; top: .75rem; right: .75rem; min-height: 2.2rem; border: 0; border-radius: 999px; padding: 0 .85rem; background: #0f172a; color: #fff; cursor: pointer; font-size: .68rem; font-weight: 800; }',
      '.main-content { position: relative; height: calc(100vh - 4rem); overflow: hidden; }',
      '.tab-view { width: 100%; height: 100%; }',
      '.visual-view { position: relative; display: grid; place-items: center; overflow: auto; padding: 4.5rem 1.5rem 4.8rem; background-color: var(--bg); }',
      '.visual-view.pattern-dots { background-image: radial-gradient(rgb(148 163 184 / 30%) 1px, transparent 1px); background-size: 16px 16px; }',
      '.visual-view.pattern-grid { background-image: linear-gradient(to right, rgb(148 163 184 / 22%) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 22%) 1px, transparent 1px); background-size: 20px 20px; }',
      '.visual-view.pattern-clean { background-image: none; }',
      '.canvas-toolbar { position: absolute; z-index: 10; top: 1rem; left: 50%; display: inline-flex; align-items: center; gap: .28rem; max-width: calc(100% - 2rem); overflow-x: auto; transform: translateX(-50%); border: 1px solid var(--line); border-radius: 999px; padding: .25rem .55rem; background: var(--surface); box-shadow: 0 2px 8px rgb(15 23 42 / 8%); }',
      '.canvas-toolbar-label { color: var(--light); font-size: .62rem; font-weight: 700; white-space: nowrap; }',
      '.pattern-button { border: 0; border-radius: 7px; padding: .24rem .45rem; background: transparent; color: var(--muted); cursor: pointer; font-size: .62rem; font-weight: 800; white-space: nowrap; }',
      '.pattern-button[aria-pressed="true"] { background: var(--soft); color: var(--ink); }',
      '.case-id { margin-left: .35rem; border-left: 1px solid var(--line); padding-left: .55rem; color: var(--light); font: 700 .6rem ui-monospace, monospace; }',
      '.resizable-stage { position: relative; display: flex; width: 768px; height: 480px; max-width: 100%; max-height: 100%; align-items: center; justify-content: center; overflow: visible; background: transparent; transition: width 180ms ease, height 180ms ease; }',
      '.resizable-stage iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }',
      '.resize-handle { position: absolute; z-index: 12; right: -.72rem; bottom: -.72rem; display: grid; width: 1.7rem; height: 1.7rem; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--muted); cursor: se-resize; box-shadow: 0 4px 10px rgb(15 23 42 / 12%); }',
      '.events-panel { position: absolute; z-index: 20; bottom: 1rem; left: 50%; width: max-content; max-width: calc(100% - 1.5rem); transform: translateX(-50%); }',
      '.event-badge { position: relative; display: flex; align-items: center; gap: .55rem; min-height: 2.45rem; max-width: min(92vw, 38rem); border: 1px solid var(--line); border-radius: 999px; padding: .45rem .55rem .45rem .8rem; background: var(--surface); box-shadow: 0 10px 25px rgb(15 23 42 / 14%); white-space: nowrap; }',
      '.event-dot { width: .48rem; height: .48rem; flex: 0 0 auto; border-radius: 50%; background: var(--accent); }',
      '.event-label { color: var(--light); font: .62rem ui-monospace, monospace; }',
      '.event-latest-name { max-width: 19rem; overflow: hidden; color: var(--ink); font: 700 .66rem ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }',
      '.event-history-button { display: inline-flex; align-items: center; gap: .25rem; border: 1px solid var(--line); border-radius: 999px; padding: .26rem .48rem; background: var(--soft); color: var(--muted); cursor: pointer; font-size: .62rem; font-weight: 800; }',
      '.event-popover { position: absolute; right: 0; bottom: calc(100% + .7rem); width: min(27rem, 92vw); border: 1px solid var(--line); border-radius: 14px; padding: .85rem; background: var(--surface); box-shadow: 0 25px 50px rgb(15 23 42 / 20%); white-space: normal; }',
      '.event-popover-header { display: flex; align-items: center; justify-content: space-between; gap: .7rem; padding-bottom: .6rem; border-bottom: 1px solid var(--line); }',
      '.event-popover-title, .event-popover-actions { display: flex; align-items: center; gap: .45rem; }',
      '.event-popover-title strong { font-size: .72rem; }',
      '.json-badge { border-radius: 5px; padding: .16rem .35rem; background: var(--soft); color: var(--muted); font: .55rem ui-monospace, monospace; }',
      '.event-popover-actions button { border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: .62rem; font-weight: 800; }',
      '.event-filter { display: block; margin: .65rem 0; }',
      '.event-filter input { width: 100%; min-height: 2rem; border: 1px solid var(--line); border-radius: 8px; padding: 0 .55rem; background: var(--soft); color: var(--ink); font-size: .65rem; }',
      '.event-latest-detail { max-height: 3rem; overflow: auto; margin: 0 0 .55rem; border-left: 2px solid var(--accent); padding: .25rem .5rem; color: var(--muted); font: .58rem/1.4 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.event-list { display: grid; gap: .45rem; max-height: 14rem; overflow: auto; margin: 0; padding: 0 .15rem .15rem 0; list-style: none; }',
      '.log-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem .55rem; border: 1px solid var(--line); border-radius: 10px; padding: .6rem; background: var(--soft); }',
      '.log-item-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .5rem; }',
      '.log-item-header strong { overflow: hidden; color: var(--ink); font: 700 .62rem ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }',
      '.log-index { color: var(--light); font: .56rem ui-monospace, monospace; }',
      '.log-item code { grid-column: 1 / -1; color: var(--muted); font: .58rem/1.4 ui-monospace, monospace; overflow-wrap: anywhere; }',
      '.log-item button { grid-column: 2; grid-row: 1; border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: .58rem; font-weight: 800; }',
      '.event-empty { border: 1px dashed var(--line); border-radius: 10px; padding: .9rem; color: var(--muted); font-size: .65rem; text-align: center; }',
      '.event-badge-pulse { animation: event-pulse 480ms ease-out; }',
      '@keyframes event-pulse { 0% { box-shadow: 0 0 0 0 rgb(2 132 199 / 35%); } 100% { box-shadow: 0 0 0 10px transparent; } }',
      '.code-view { min-height: 100%; overflow: auto; padding: clamp(1rem, 3vw, 2rem); background: #0f172a; }',
      '.code-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; max-width: 76rem; margin: 0 auto; }',
      '.code-card { overflow: hidden; border: 1px solid #334155; border-radius: 14px; background: #020617; }',
      '.code-card header { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-bottom: 1px solid #334155; color: #94a3b8; font-size: .68rem; font-weight: 800; }',
      '.code-card button { border: 0; background: transparent; color: #38bdf8; cursor: pointer; font-size: .65rem; font-weight: 800; }',
      '.code-card pre { min-height: 14rem; overflow: auto; margin: 0; padding: 1rem; color: #7dd3fc; font: .7rem/1.6 ui-monospace, monospace; white-space: pre-wrap; }',
      '.documentation-view { min-height: 100%; overflow: auto; padding: clamp(1.25rem, 4vw, 3rem); background: var(--bg); }',
      '.documentation-shell { max-width: 68rem; margin: 0 auto; }',
      '.documentation-shell h2 { margin: 0 0 .5rem; font-size: 1.35rem; }',
      '.documentation-intro { max-width: 65ch; margin: 0 0 1.25rem; color: var(--muted); font-size: .78rem; line-height: 1.6; }',
      '.documentation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }',
      '.documentation-card { border: 1px solid var(--line); border-radius: 13px; padding: 1rem; background: var(--surface); }',
      '.documentation-card h3 { margin: 0 0 .4rem; font-size: .9rem; }',
      '.documentation-card p { margin: 0; color: var(--muted); font-size: .72rem; line-height: 1.55; }',
      '.documentation-card code { display: inline-block; margin-top: .7rem; border-radius: 6px; padding: .3rem .45rem; background: var(--soft); color: var(--accent); font: .64rem ui-monospace, monospace; }',
      '.contract-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); }',
      '.contract-table { width: 100%; border-collapse: collapse; font-size: .72rem; text-align: left; }',
      '.contract-table th, .contract-table td { border-bottom: 1px solid var(--line); padding: .8rem 1rem; }',
      '.contract-table th { background: var(--soft); }',
      '.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }',
      '@media (max-width: 1120px) { .main-header { flex-wrap: wrap; } .header-section.viewport-controls { order: 5; width: 100%; justify-content: center; } .main-content { height: calc(100vh - 6.7rem); } }',
      '@media (max-width: 720px) { .main-header { align-items: flex-start; padding: .5rem .65rem; } .header-section.brand { width: 100%; } .view-tabs { order: 3; flex: 1 1 100%; } .view-tabs .pill { flex: 1; } .settings { order: 4; width: 100%; justify-content: flex-start; } .header-section.viewport-controls { overflow-x: auto; justify-content: flex-start; } .identity p { display: none; } .case-control { margin-left: auto; } .case-control select { min-width: 7.5rem; } .main-content { height: calc(100vh - 9rem); } .visual-view { padding: 4rem .65rem 4.6rem; } .resizable-stage { max-width: calc(100vw - 1.3rem); } .event-latest-name { max-width: 8rem; } .code-grid, .documentation-grid { grid-template-columns: 1fr; } }'
    ].join(String.fromCharCode(10));

    const content = document.createElement('div');
    content.className = 'studio';
    content.setAttribute('data-demo-region', '');
    content.innerHTML =
      '<header class="main-header" data-workbench-header>' +
        '<div class="header-section brand"><span class="brand-badge" data-label="brandBadge">' + escapeHtml(labels.brandBadge) + '</span><div class="identity"><h1 data-label="title">' + escapeHtml(labels.title) + '</h1><p data-label="status">' + escapeHtml(labels.status) + '</p></div><span class="divider" aria-hidden="true"></span><div class="case-control"><label for="academy-demo-case" data-label="caseLabel">' + escapeHtml(labels.caseLabel) + '</label><select id="academy-demo-case" data-case-select>' + options + '</select></div></div>' +
        '<nav class="pill-group view-tabs" role="tablist" aria-label="' + escapeHtml(labels.title) + '"><button class="pill" type="button" role="tab" data-view="visual" aria-selected="true" data-label="visual">' + escapeHtml(labels.visual) + '</button><button class="pill" type="button" role="tab" data-view="code" aria-selected="false" data-label="code">' + escapeHtml(labels.code) + '</button><button class="pill" type="button" role="tab" data-view="documentation" aria-selected="false" data-label="documentation">' + escapeHtml(labels.documentation) + '</button></nav>' +
        '<div class="header-section viewport-controls"><div class="pill-group" data-preset-list role="group" aria-label="' + escapeHtml(labels.viewport) + '"><button class="pill" type="button" data-preset="mobile" aria-pressed="false" data-label="mobile">' + escapeHtml(labels.mobile) + '</button><button class="pill" type="button" data-preset="tablet" aria-pressed="false" data-label="tablet">' + escapeHtml(labels.tablet) + '</button><button class="pill" type="button" data-preset="desktop" aria-pressed="true" data-label="desktop">' + escapeHtml(labels.desktop) + '</button><button class="pill" type="button" data-preset="fluid" aria-pressed="false" data-label="fluid">' + escapeHtml(labels.fluid) + '</button></div><output class="dimension" data-demo-dimensions>768×480</output><a class="open-button" data-open href="' + escapeHtml(selectedCase.src) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(labels.open) + '">↗</a></div>' +
        '<div class="header-section settings"><button class="icon-button" type="button" data-theme-toggle aria-pressed="false" aria-label="Theme">◐</button><div class="pill-group" data-language-controls role="group" aria-label="' + escapeHtml(labels.languageLabel) + '"><button class="pill" type="button" data-language="en" aria-pressed="true" data-label="languageEn">' + escapeHtml(labels.languageEn) + '</button><button class="pill" type="button" data-language="es" aria-pressed="false" data-label="languageEs">' + escapeHtml(labels.languageEs) + '</button></div><button class="outline-button" type="button" data-hide-ui data-label="hideUi">' + escapeHtml(labels.hideUi) + '</button></div>' +
      '</header>' +
      '<button class="show-ui" type="button" data-show-ui hidden data-label="showUi">' + escapeHtml(labels.showUi) + '</button>' +
      '<main class="main-content" aria-label="' + escapeHtml(labels.interactive) + '">' +
        '<section class="tab-view visual-view pattern-dots" data-view-surface="visual" data-visual-view>' +
          '<div class="canvas-toolbar" data-canvas-toolbar><span class="canvas-toolbar-label" data-label="patternLabel">' + escapeHtml(labels.patternLabel) + '</span><button class="pattern-button" type="button" data-pattern="dots" aria-pressed="true" data-label="patternDots">' + escapeHtml(labels.patternDots) + '</button><button class="pattern-button" type="button" data-pattern="grid" aria-pressed="false" data-label="patternGrid">' + escapeHtml(labels.patternGrid) + '</button><button class="pattern-button" type="button" data-pattern="clean" aria-pressed="false" data-label="patternClean">' + escapeHtml(labels.patternClean) + '</button><span class="case-id" data-case-marker>#01</span></div>' +
          '<div class="resizable-stage" data-device-frame><iframe data-demo-frame title="' + escapeHtml(selectedCase.heading) + '" src="' + escapeHtml(selectedCase.src) + '"></iframe><button class="resize-handle" type="button" data-resize aria-label="Resize">⌟</button></div>' +
          '<aside class="events-panel" data-event-activity aria-label="' + escapeHtml(labels.events) + '"><div class="event-badge" data-event-badge data-event-latest><span class="event-dot" aria-hidden="true"></span><span class="event-label" data-label="eventLabel">' + escapeHtml(labels.eventLabel) + '</span><strong class="event-latest-name" data-event-latest-name>' + escapeHtml(labels.eventsEmpty) + '</strong><button class="event-history-button" type="button" data-event-toggle aria-expanded="false"><span data-event-history-label data-label="eventHistory">' + escapeHtml(labels.eventHistory) + '</span><span>(</span><span data-event-count>0</span><span>)</span><span aria-hidden="true">⌄</span></button><div class="event-popover" data-event-popover hidden><div class="event-popover-header"><div class="event-popover-title"><strong data-label="eventHistory">' + escapeHtml(labels.eventHistory) + '</strong><span class="json-badge">JSON</span></div><div class="event-popover-actions"><button type="button" data-event-export data-label="exportEvents">' + escapeHtml(labels.exportEvents) + '</button><button type="button" data-event-clear data-label="clearEvents">' + escapeHtml(labels.clearEvents) + '</button></div></div><label class="event-filter"><span class="sr-only" data-label="eventFilter">' + escapeHtml(labels.eventFilter) + '</span><input type="search" data-event-filter placeholder="' + escapeHtml(labels.eventFilter) + '"></label><span class="sr-only" data-event-latest-label data-label="eventLatest">' + escapeHtml(labels.eventLatest) + '</span><div class="event-latest-detail" data-event-latest-detail></div><ol class="event-list" data-demo-events></ol></div></div></aside>' +
        '</section>' +
        '<section class="tab-view code-view" data-view-surface="code" data-code-view hidden><div class="code-grid"><article class="code-card"><header><span data-label="htmlSnippet">' + escapeHtml(labels.htmlSnippet) + '</span><button type="button" data-copy="html" data-label="copy">' + escapeHtml(labels.copy) + '</button></header><pre data-code-block="html">' + escapeHtml(htmlSnippet) + '</pre></article><article class="code-card"><header><span data-label="jsSnippet">' + escapeHtml(labels.jsSnippet) + '</span><button type="button" data-copy="js" data-label="copy">' + escapeHtml(labels.copy) + '</button></header><pre data-code-block="js">' + escapeHtml(jsSnippet) + '</pre></article></div></section>' +
        '<section class="tab-view documentation-view" data-view-surface="documentation" data-documentation-view hidden><div class="documentation-shell"><h2 data-label="documentation">' + escapeHtml(labels.documentation) + '</h2><p class="documentation-intro" data-label="documentationDescription">' + escapeHtml(labels.documentationDescription) + '</p><div class="documentation-grid"><article class="documentation-card"><h3 data-label="scope">' + escapeHtml(labels.scope) + '</h3><p data-label="scopeDescription">' + escapeHtml(labels.scopeDescription) + '</p><code>' + escapeHtml(tag) + ' → scoped registry</code></article><article class="documentation-card"><h3 data-label="api">' + escapeHtml(labels.api) + '</h3><p data-label="apiDescription">' + escapeHtml(labels.apiDescription) + '</p><code>this.t(key) · emitEvent(type, detail)</code></article></div><div class="contract-wrap"><table class="contract-table"><thead><tr><th data-label="apiColumn">' + escapeHtml(labels.apiColumn) + '</th><th data-label="contractColumn">' + escapeHtml(labels.contractColumn) + '</th><th data-label="evidenceColumn">' + escapeHtml(labels.evidenceColumn) + '</th></tr></thead><tbody><tr><td><code>scopedElements</code></td><td data-label="scope">' + escapeHtml(labels.scope) + '</td><td><code>' + escapeHtml(tag) + '</code></td></tr><tr><td><code>this.t(key)</code></td><td data-label="languageLabel">' + escapeHtml(labels.languageLabel) + '</td><td><code>en · es</code></td></tr><tr><td><code>emitEvent()</code></td><td data-label="events">' + escapeHtml(labels.events) + '</td><td><code>' + escapeHtml(tag) + '-continue</code></td></tr></tbody></table></div></div></section>' +
      '</main>';

    this.replaceChildren(style, content);
    const select = this.querySelector('[data-case-select]');
    if (select !== null) {
      select.value = String(this.selected);
      select.addEventListener('change', event => this.selectCase(Number(event.currentTarget.value)));
    }
    for (const button of this.querySelectorAll('[data-view]')) button.addEventListener('click', () => this.setView(button.dataset.view));
    for (const button of this.querySelectorAll('[data-language]')) button.addEventListener('click', () => this.setLanguage(button.dataset.language));
    for (const button of this.querySelectorAll('[data-preset]')) button.addEventListener('click', () => this.setPreset(button.dataset.preset));
    for (const button of this.querySelectorAll('[data-pattern]')) button.addEventListener('click', () => this.setPattern(button.dataset.pattern));
    for (const button of this.querySelectorAll('[data-copy]')) button.addEventListener('click', () => this.copyCode(button));
    for (const button of this.querySelectorAll('[data-event-clear]')) button.addEventListener('click', () => this.clearEvents());
    this.querySelector('[data-event-toggle]')?.addEventListener('click', () => this.toggleEventPopover());
    this.querySelector('[data-event-export]')?.addEventListener('click', () => this.exportEvents());
    this.querySelector('[data-event-filter]')?.addEventListener('input', event => this.filterEvents(event.currentTarget.value));
    this.querySelector('[data-theme-toggle]')?.addEventListener('click', () => this.toggleDarkMode());
    this.querySelector('[data-hide-ui]')?.addEventListener('click', () => this.toggleUi());
    this.querySelector('[data-show-ui]')?.addEventListener('click', () => this.toggleUi());
    this.querySelector('[data-resize]')?.addEventListener('pointerdown', event => this.startResize(event));
    this.querySelector('[data-resize]')?.addEventListener('dblclick', () => this.setPreset('desktop'));
    this.querySelector('[data-demo-frame]')?.addEventListener('load', () => this.sendLanguage());
    this.setView(this.view);
    this.updateLabels();
  }
}

if (customElements.get('academy-demo-helper') === undefined) {
  customElements.define('academy-demo-helper', AcademyDemoHelper);
}
`;
