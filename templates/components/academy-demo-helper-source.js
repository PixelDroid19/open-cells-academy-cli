export const ACADEMY_DEMO_HELPER_SOURCE = String.raw`const DEFAULT_LABELS = Object.freeze({
  brand: 'Open Cells / component studio',
  title: 'State card',
  intro: 'Explore the component in an isolated Cells demo case.',
  status: 'Interactive specimen',
  caseBasic: 'Basic',
  caseBasicDescription: 'A first case with language, event, and scoped component controls.',
  caseReady: 'Ready',
  caseReadyDescription: 'Default state, ready to continue.',
  caseProcessing: 'Processing',
  caseProcessingDescription: 'Busy state while the current information is checked.',
  caseSuccess: 'Completed',
  caseSuccessDescription: 'Successful completion state.',
  caseError: 'Error',
  caseErrorDescription: 'Recoverable state that offers another attempt.',
  caseDisabled: 'Disabled',
  caseDisabledDescription: 'Unavailable state with a disabled action.',
  interactive: 'Interactive Demo',
  documentation: 'Documentation',
  visual: 'Visual',
  code: 'Code',
  caseLabel: 'Case',
  languageLabel: 'Language',
  languageEn: 'English',
  languageEs: 'Spanish',
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
  events: 'Events',
  eventIntro: 'Events emitted by the component appear here as an inspectable stream.',
  eventsEmpty: 'No events captured yet.',
  copy: 'Copy',
  copied: 'Copied',
  documentationDescription: 'A compact reference for the component contract used in this demo.',
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
  responsive: Object.freeze({ width: '100%', height: '480px' }),
  mobile: Object.freeze({ width: '375px', height: '667px' }),
  tablet: Object.freeze({ width: '768px', height: '520px' }),
  desktop: Object.freeze({ width: '960px', height: '520px' }),
  'large-desktop': Object.freeze({ width: '1280px', height: '720px' }),
  fluid: Object.freeze({ width: '100%', height: '100%' })
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

function pixelDimension(value) {
  const numeric = String(value || '').trim();
  return /^\d+$/.test(numeric) ? numeric + 'px' : '';
}

function inputDimension(value) {
  return String(value || '').replace(/px$/, '');
}

class AcademyDemoCase extends HTMLElement {
  static get observedAttributes() {
    return ['heading', 'description', 'src', 'heading-key', 'description-key'];
  }
}

if (customElements.get('academy-demo-case') === undefined) {
  customElements.define('academy-demo-case', AcademyDemoCase);
}

class AcademyDemoHelper extends HTMLElement {
  constructor() {
    super();
    this.selected = 0;
    this.resolution = 'mobile';
    this.customViewportWidth = '';
    this.customViewportHeight = '';
    this.view = 'visual';
    this.mode = 'visual';
    this.panel = 'interactive';
    this.language = 'en';
    this.uiHidden = false;
    this.labels = safeLabels();
    this.cases = [];
    this.events = [];
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
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.onMessage);
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
    const preset = PRESETS[this.resolution] || PRESETS.responsive;
    return {
      width: this.customViewportWidth || preset.width,
      height: this.customViewportHeight || preset.height
    };
  }

  applyViewport() {
    const frame = this.querySelector('[data-demo-frame]');
    const device = this.querySelector('[data-device-frame]');
    if (frame === null || device === null) return;
    const viewport = this.viewport;
    device.style.width = viewport.width;
    device.style.height = viewport.height;
    frame.setAttribute('aria-label', this.labels.viewport + ': ' + viewport.width + ' x ' + viewport.height);
    const dimensions = this.querySelector('[data-demo-dimensions]');
    if (dimensions !== null) dimensions.textContent = viewport.width + ' × ' + viewport.height;
    const open = this.querySelector('[data-open]');
    if (open !== null) open.href = frame.src;
  }

  syncViewportControls() {
    const width = this.querySelector('[data-width]');
    const height = this.querySelector('[data-height]');
    if (width !== null) width.value = inputDimension(this.customViewportWidth);
    if (height !== null) height.value = inputDimension(this.customViewportHeight);
    for (const button of this.querySelectorAll('[data-preset]')) {
      button.setAttribute('aria-pressed', String(button.dataset.preset === this.resolution));
    }
  }

  syncLanguageControls() {
    for (const button of this.querySelectorAll('[data-language]')) {
      button.setAttribute('aria-pressed', String(button.dataset.language === this.language));
    }
  }

  sendLanguage() {
    const frame = this.querySelector('[data-demo-frame]');
    if (frame?.contentWindow === undefined || frame.contentWindow === null) return;
    frame.contentWindow.postMessage({
      source: 'academy-demo-host',
      kind: 'language',
      language: this.language
    }, window.location.origin);
  }

  setLanguage(language) {
    this.language = language === 'es' ? 'es' : 'en';
    document.documentElement.lang = this.language;
    this.syncLanguageControls();
    this.sendLanguage();
  }

  selectCase(index) {
    this.selected = Math.max(0, Math.min(index, Math.max(0, this.cases.length - 1)));
    this.events = [];
    this.render();
  }

  setView(view) {
    this.view = ['visual', 'code', 'documentation'].includes(view) ? view : 'visual';
    this.mode = this.view === 'code' ? 'code' : 'visual';
    this.panel = this.view === 'documentation' ? 'documentation' : 'interactive';
    for (const surface of this.querySelectorAll('[data-view-surface]')) {
      surface.hidden = surface.dataset.viewSurface !== this.view;
    }
    for (const button of this.querySelectorAll('[data-view]')) {
      const active = button.dataset.view === this.view;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    this.syncUiState();
  }

  setMode(mode) {
    this.setView(mode === 'code' ? 'code' : 'visual');
  }

  setPanel(panel) {
    this.setView(panel === 'documentation' ? 'documentation' : 'visual');
  }

  syncUiState() {
    const header = this.querySelector('[data-workbench-header]');
    const toolbar = this.querySelector('[data-viewport-toolbar]');
    const restore = this.querySelector('[data-show-ui]');
    if (header !== null) header.hidden = this.uiHidden;
    if (toolbar !== null) toolbar.hidden = this.uiHidden || this.view !== 'visual';
    if (restore !== null) restore.hidden = !this.uiHidden;
    this.setAttribute('data-ui-hidden', String(this.uiHidden));
    const hideLabel = this.querySelector('[data-hide-ui-label]');
    if (hideLabel !== null) hideLabel.textContent = this.labels.hideUi;
    const hideButton = this.querySelector('[data-hide-ui]');
    if (hideButton !== null) hideButton.setAttribute('aria-pressed', String(this.uiHidden));
  }

  toggleUi() {
    this.uiHidden = !this.uiHidden;
    this.syncUiState();
  }

  copyCode(button) {
    const source = this.querySelector('[data-code-block="' + button.dataset.copy + '"]');
    const label = button.querySelector('[data-copy-label]');
    const finish = () => {
      if (label === null) return;
      label.textContent = this.labels.copied;
      window.setTimeout(() => {
        if (button.isConnected) label.textContent = this.labels.copy;
      }, 1200);
    };
    if (source === null || !navigator.clipboard?.writeText) {
      finish();
      return;
    }
    navigator.clipboard.writeText(source.textContent).then(finish, finish);
  }

  renderEvents() {
    const list = this.querySelector('[data-demo-events]');
    const count = this.querySelector('[data-event-count]');
    const latest = this.querySelector('[data-event-latest]');
    const latestName = this.querySelector('[data-event-latest-name]');
    const latestDetail = this.querySelector('[data-event-latest-detail]');
    if (list === null) return;
    list.replaceChildren();
    if (count !== null) count.textContent = String(this.events.length).padStart(2, '0');
    if (!this.events.length) {
      if (latest !== null) latest.hidden = true;
      const empty = document.createElement('li');
      empty.className = 'event-empty';
      empty.textContent = this.labels.eventsEmpty;
      list.append(empty);
      return;
    }
    if (latest !== null) latest.hidden = false;
    if (latestName !== null) latestName.textContent = this.events[0].type;
    if (latestDetail !== null) latestDetail.textContent = detailText(this.events[0].detail);
    for (const [index, event] of this.events.slice(0, 8).entries()) {
      const item = document.createElement('li');
      item.className = 'event-entry';
      const marker = document.createElement('span');
      marker.className = 'event-index';
      marker.textContent = String(index + 1).padStart(2, '0');
      const details = document.createElement('details');
      details.className = 'event-details';
      if (index === 0) details.open = true;
      const summary = document.createElement('summary');
      const name = document.createElement('strong');
      name.className = 'event-name';
      name.textContent = event.type;
      const preview = document.createElement('span');
      preview.className = 'event-preview';
      const detail = detailText(event.detail);
      preview.textContent = detail.length > 72 ? detail.slice(0, 69) + '…' : detail;
      const toggle = document.createElement('span');
      toggle.className = 'event-toggle';
      toggle.setAttribute('aria-hidden', 'true');
      toggle.textContent = '+';
      summary.append(name, preview, toggle);
      const detailBlock = document.createElement('pre');
      detailBlock.textContent = detail;
      details.append(summary, detailBlock);
      item.append(marker, details);
      list.append(item);
    }
  }

  updateLabels() {
    for (const node of this.querySelectorAll('[data-label]')) {
      const value = this.labels[node.dataset.label];
      if (value !== undefined) node.textContent = value;
    }
    const main = this.querySelector('main.studio-main');
    if (main !== null) main.setAttribute('aria-label', this.labels.interactive);
    const tablist = this.querySelector('[role="tablist"]');
    if (tablist !== null) tablist.setAttribute('aria-label', this.labels.title);
    const languageGroup = this.querySelector('[data-language-controls]');
    if (languageGroup !== null) languageGroup.setAttribute('aria-label', this.labels.languageLabel);
    const presetGroup = this.querySelector('[data-preset-list]');
    if (presetGroup !== null) presetGroup.setAttribute('aria-label', this.labels.viewport);
    const latestEvent = this.querySelector('[data-event-latest]');
    if (latestEvent !== null) latestEvent.setAttribute('aria-label', this.labels.events);
    const canvas = this.querySelector('[data-preview-scroll]');
    if (canvas !== null) canvas.setAttribute('aria-label', this.labels.livePreview);
    const showLabel = this.querySelector('[data-show-ui-label]');
    if (showLabel !== null) showLabel.textContent = this.labels.showUi;
    const showButton = this.querySelector('[data-show-ui]');
    if (showButton !== null) showButton.setAttribute('aria-label', this.labels.showUi);
    const hideButton = this.querySelector('[data-hide-ui]');
    if (hideButton !== null) hideButton.setAttribute('aria-label', this.labels.hideUi);
    for (const copyLabel of this.querySelectorAll('[data-copy-label]')) copyLabel.textContent = this.labels.copy;
    const caseSelect = this.querySelector('[data-case-select]');
    if (caseSelect !== null) {
      caseSelect.setAttribute('aria-label', this.labels.caseLabel);
      for (const [index, option] of [...caseSelect.options].entries()) {
        option.textContent = this.cases[index]?.heading || this.labels.noCase;
      }
    }
    const widthInput = this.querySelector('[data-width]');
    if (widthInput !== null) widthInput.setAttribute('aria-label', this.labels.customWidth);
    const heightInput = this.querySelector('[data-height]');
    if (heightInput !== null) heightInput.setAttribute('aria-label', this.labels.customHeight);
    const frame = this.querySelector('[data-demo-frame]');
    if (frame !== null) frame.title = this.selectedCase.heading;
    const caseStatus = this.querySelector('[data-case-status]');
    if (caseStatus !== null) caseStatus.textContent = this.selectedCase.heading;
    const caseMarker = this.querySelector('[data-case-marker]');
    if (caseMarker !== null) caseMarker.textContent = '#' + String(this.selected + 1).padStart(2, '0');
    const open = this.querySelector('[data-open]');
    if (open !== null) {
      open.title = this.labels.open;
      open.setAttribute('aria-label', this.labels.open);
    }
    this.syncUiState();
    this.applyViewport();
    this.renderEvents();
  }

  render() {
    const labels = this.labels;
    const selectedCase = this.selectedCase;
    const tag = this.componentTag();
    const htmlSnippet = '<' + tag + '></' + tag + '>';
    const jsSnippet = [
      "const element = document.querySelector('" + tag + "');",
      "element.addEventListener('" + tag + "-continue', event => {",
      '  console.log(event.type, event.detail);',
      '});'
    ].join(String.fromCharCode(10));
    const options = this.cases.length
      ? this.cases.map((candidate, index) => '<option value="' + index + '">' + escapeHtml(candidate.heading) + '</option>').join('')
      : '<option value="0">' + escapeHtml(labels.noCase) + '</option>';
    const style = document.createElement('style');
    style.textContent = [
      ':host { display: block; min-height: 100vh; color: #1c2733; background: #edf1f4; }',
      '.studio, .studio * { box-sizing: border-box; }',
      '.studio { --ink: #1c2733; --muted: #657383; --paper: #ffffff; --canvas: #e8eef2; --line: #d4dde4; --soft: #f4f7f9; --accent: #0b668a; --accent-strong: #084c69; --success: #1d8a66; min-height: 100vh; background: #edf1f4; font-family: "Trebuchet MS", "Avenir Next", sans-serif; }',
      '[hidden] { display: none !important; }',
      'button, select, input { font: inherit; }',
      'button, select, input, a { -webkit-tap-highlight-color: transparent; }',
      'button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible, [tabindex]:focus-visible { outline: 3px solid #55bce6; outline-offset: 2px; }',
      '.app-header { display: grid; grid-template-columns: minmax(18rem, 1fr) auto minmax(18rem, 1fr); align-items: center; gap: 1.5rem; min-height: 5.25rem; padding: .8rem clamp(1rem, 2vw, 2rem); border-bottom: 1px solid var(--line); background: rgb(255 255 255 / 96%); box-shadow: 0 4px 18px rgb(30 50 65 / 5%); }',
      '.header-start, .header-end { display: flex; align-items: center; gap: 1.25rem; min-width: 0; }',
      '.header-end { justify-content: flex-end; }',
      '.identity { min-width: 0; }',
      '.identity h1 { overflow: hidden; margin: 0; color: var(--ink); font-size: 1rem; font-weight: 800; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }',
      '.identity p { margin: .18rem 0 0; color: var(--muted); font-size: .7rem; font-weight: 700; }',
      '.case-control { display: flex; align-items: center; gap: .5rem; min-width: 0; padding-left: 1.25rem; border-left: 1px solid var(--line); }',
      '.case-control label { color: var(--muted); font-size: .7rem; font-weight: 700; }',
      '.case-control select { min-width: 8.5rem; max-width: 13rem; min-height: 2.25rem; border: 1px solid var(--line); border-radius: 9px; padding: 0 2rem 0 .7rem; background: var(--soft); color: var(--ink); cursor: pointer; font-size: .72rem; font-weight: 800; }',
      '.view-tabs { display: inline-flex; gap: .22rem; padding: .23rem; border: 1px solid var(--line); border-radius: 12px; background: #f0f3f5; }',
      '.view-tabs button { min-height: 2.2rem; border: 0; border-radius: 9px; padding: 0 1.1rem; background: transparent; color: #5a6977; cursor: pointer; font-size: .72rem; font-weight: 800; }',
      '.view-tabs button[aria-selected="true"] { background: var(--paper); color: var(--ink); box-shadow: 0 2px 8px rgb(28 39 51 / 10%); }',
      '.language-switch { display: inline-flex; gap: .15rem; padding: .2rem; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); }',
      '.language-switch button { min-width: 3rem; min-height: 2rem; border: 0; border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; font-size: .68rem; font-weight: 800; }',
      '.language-switch button[aria-pressed="true"] { background: var(--accent-strong); color: #fff; }',
      '.hide-ui-button, .show-ui-button { display: inline-flex; align-items: center; gap: .45rem; min-height: 2.2rem; border: 0; border-radius: 9px; padding: 0 .8rem; background: transparent; color: var(--muted); cursor: pointer; font-size: .7rem; font-weight: 800; }',
      '.hide-ui-button:hover { background: var(--soft); color: var(--ink); }',
      '.eye-icon { width: .9rem; height: .9rem; border: 2px solid currentColor; border-radius: 60% 40% / 50%; transform: rotate(45deg); }',
      '.viewport-toolbar { display: flex; align-items: center; justify-content: center; gap: .75rem; min-height: 3.45rem; overflow-x: auto; padding: .5rem clamp(.75rem, 2vw, 1.5rem); border-bottom: 1px solid var(--line); background: rgb(255 255 255 / 88%); scrollbar-width: thin; }',
      '.preset-list { display: inline-flex; flex: 0 0 auto; gap: .16rem; padding: .18rem; border: 1px solid var(--line); border-radius: 9px; background: var(--soft); }',
      '.preset-button { min-height: 1.9rem; border: 0; border-radius: 7px; padding: 0 .72rem; background: transparent; color: #5b6976; cursor: pointer; font-size: .66rem; font-weight: 800; white-space: nowrap; }',
      '.preset-button[aria-pressed="true"] { background: var(--paper); color: var(--ink); box-shadow: 0 1px 5px rgb(28 39 51 / 10%); }',
      '.toolbar-divider { flex: 0 0 1px; align-self: stretch; min-height: 1.7rem; background: var(--line); }',
      '.dimension-readout { flex: 0 0 auto; min-width: 7rem; border: 1px solid var(--line); border-radius: 8px; padding: .48rem .65rem; background: var(--soft); color: var(--muted); font: 600 .64rem ui-monospace, SFMono-Regular, monospace; text-align: center; }',
      '.custom-size { display: inline-flex; flex: 0 0 auto; align-items: end; gap: .35rem; }',
      '.size-field { display: grid; gap: .15rem; }',
      '.size-field span { color: var(--muted); font-size: .52rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }',
      '.size-field input { width: 4.6rem; min-height: 2rem; border: 1px solid var(--line); border-radius: 8px; padding: 0 .55rem; background: var(--paper); color: var(--ink); font-size: .68rem; }',
      '.dimension-cross { padding-bottom: .55rem; color: #64727e; font-size: .7rem; }',
      '.apply-button, .open-button { display: inline-grid; min-height: 2rem; place-items: center; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; font-size: .68rem; font-weight: 800; text-decoration: none; }',
      '.apply-button { padding: 0 .8rem; }',
      '.open-button { width: 2rem; background: var(--accent-strong); font-size: 1rem; }',
      '.toolbar-actions { display: inline-flex; flex: 0 0 auto; gap: .35rem; }',
      '.show-ui-button { position: fixed; z-index: 50; top: .9rem; right: .9rem; min-height: 2.45rem; border-radius: 999px; background: #17232d; color: #fff; box-shadow: 0 12px 32px rgb(20 36 48 / 24%); }',
      '.studio-main { min-height: calc(100vh - 8.7rem); }',
      '.visual-view { height: calc(100vh - 8.7rem); padding: 1rem; }',
      '.visual-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(17rem, 20rem); gap: 1rem; height: 100%; }',
      '.preview-canvas { min-width: 0; min-height: 34rem; overflow: auto; border: 1px solid var(--line); border-radius: 16px; padding: 1.2rem; background-color: var(--canvas); background-image: radial-gradient(rgb(118 139 154 / 28%) 1px, transparent 1px); background-size: 20px 20px; }',
      '.canvas-center { display: grid; min-width: min-content; min-height: 100%; place-items: center; }',
      '.device-frame { display: flex; flex-direction: column; max-width: 100%; max-height: 100%; overflow: hidden; border: 1px solid #b8c4cc; border-radius: 15px; background: var(--paper); box-shadow: 0 18px 42px rgb(37 58 73 / 17%); transition: width 180ms ease, height 180ms ease; }',
      '.device-status { display: flex; flex: 0 0 2.6rem; align-items: center; justify-content: space-between; gap: 1rem; padding: 0 .8rem; border-bottom: 1px solid #e2e8ec; background: #f8fafb; color: #586775; font-size: .66rem; }',
      '.status-copy { display: inline-flex; align-items: center; gap: .45rem; min-width: 0; }',
      '.status-dot { width: .48rem; height: .48rem; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px rgb(29 138 102 / 12%); }',
      '.status-copy strong { overflow: hidden; color: #33424e; text-overflow: ellipsis; white-space: nowrap; }',
      '.case-marker { color: #596873; font: 700 .58rem ui-monospace, SFMono-Regular, monospace; letter-spacing: .08em; }',
      '.frame-body { flex: 1; min-height: 0; }',
      '.frame-body iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }',
      '.events-panel { display: flex; min-width: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); box-shadow: 0 10px 30px rgb(37 58 73 / 8%); }',
      '.events-heading { display: flex; align-items: baseline; justify-content: space-between; gap: .6rem; padding: 1rem 1rem .75rem; border-bottom: 1px solid #e5ebef; }',
      '.events-heading h2 { margin: 0; color: var(--ink); font-size: .9rem; }',
      '.event-count { color: var(--accent); font: 800 .8rem ui-monospace, SFMono-Regular, monospace; }',
      '.event-intro { margin: 0; padding: .75rem 1rem; color: var(--muted); font-size: .68rem; line-height: 1.5; }',
      '.event-latest { margin: 0 1rem .8rem; border: 1px solid #d8e1e6; border-radius: 11px; padding: .8rem; background: #f6f9fa; }',
      '.event-latest[hidden] { display: none; }',
      '.event-latest-label { display: flex; align-items: center; gap: .4rem; color: #566674; font-size: .55rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }',
      '.event-latest-label::before { width: .42rem; height: .42rem; border-radius: 50%; background: var(--success); content: ""; }',
      '.event-latest-name { display: block; margin-top: .5rem; color: var(--accent-strong); font: 800 .7rem/1.3 ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }',
      '.event-latest-detail { display: block; margin-top: .3rem; color: #637380; font: .62rem/1.4 ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }',
      '.event-list { display: grid; gap: .42rem; overflow: auto; margin: 0; padding: 0 1rem 1rem; list-style: none; scrollbar-width: thin; }',
      '.event-entry { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); gap: .5rem; border: 1px solid #dbe3e8; border-radius: 9px; padding: .55rem; background: #fbfcfd; }',
      '.event-index { color: #5b6973; font: 700 .58rem ui-monospace, SFMono-Regular, monospace; }',
      '.event-details { min-width: 0; }',
      '.event-details summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .4rem; cursor: pointer; list-style: none; }',
      '.event-details summary::-webkit-details-marker { display: none; }',
      '.event-name { min-width: 0; color: var(--accent-strong); font: 700 .62rem ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }',
      '.event-preview { display: none; }',
      '.event-toggle { color: var(--accent); font-weight: 900; }',
      '.event-details[open] .event-toggle { transform: rotate(45deg); }',
      '.event-details pre { max-height: 6rem; overflow: auto; margin: .5rem 0 0; border-top: 1px solid #e1e7eb; padding-top: .5rem; color: #60707d; font: .61rem/1.45 ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.event-empty { margin-top: auto; border: 1px dashed #ccd7de; border-radius: 9px; padding: .75rem; color: #5d6b76; font-size: .68rem; font-style: italic; }',
      '.code-view { min-height: calc(100vh - 5.25rem); padding: clamp(1rem, 3vw, 2rem); background: #17212a; }',
      '.code-heading, .documentation-heading { margin: 0 0 1rem; font-size: 1.3rem; letter-spacing: -.02em; }',
      '.code-heading { color: #e8f1f6; }',
      '.code-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; max-width: 78rem; margin: 0 auto; }',
      '.code-card { min-width: 0; overflow: hidden; border: 1px solid #34434f; border-radius: 14px; background: #101820; }',
      '.code-card-header { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-bottom: 1px solid #34434f; color: #9eb0bd; font-size: .68rem; font-weight: 800; }',
      '.copy-button { border: 0; background: transparent; color: #65c7ec; cursor: pointer; font-size: .68rem; font-weight: 800; }',
      '.code-card pre { min-height: 16rem; overflow: auto; margin: 0; padding: 1.2rem; color: #9bdcf2; font: .72rem/1.65 ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; }',
      '.documentation-view { min-height: calc(100vh - 5.25rem); padding: clamp(1.2rem, 4vw, 3rem); background: #f3f6f8; }',
      '.documentation-shell { max-width: 68rem; margin: 0 auto; }',
      '.documentation-heading { color: var(--ink); }',
      '.documentation-intro { max-width: 64ch; margin: 0 0 1.4rem; color: var(--muted); font-size: .78rem; line-height: 1.6; }',
      '.documentation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }',
      '.documentation-card { border: 1px solid var(--line); border-radius: 13px; background: var(--paper); padding: 1rem; box-shadow: 0 6px 18px rgb(37 58 73 / 5%); }',
      '.documentation-card h3 { margin: 0 0 .45rem; color: var(--ink); font-size: .9rem; }',
      '.documentation-card p { margin: 0; color: var(--muted); font-size: .72rem; line-height: 1.55; }',
      '.documentation-card code { display: inline-block; margin-top: .75rem; border-radius: 6px; padding: .32rem .45rem; background: #eaf0f3; color: var(--accent-strong); font: .65rem ui-monospace, SFMono-Regular, monospace; }',
      '.contract-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 13px; background: var(--paper); }',
      '.contract-table { width: 100%; border-collapse: collapse; font-size: .72rem; text-align: left; }',
      '.contract-table th, .contract-table td { border-bottom: 1px solid #e8edf0; padding: .8rem 1rem; }',
      '.contract-table th { background: #f7f9fa; color: #455562; font-weight: 800; }',
      '.contract-table td { color: var(--muted); }',
      '.contract-table code { color: var(--accent-strong); font: 700 .66rem ui-monospace, SFMono-Regular, monospace; }',
      '@media (max-width: 1080px) { .app-header { grid-template-columns: 1fr auto; } .view-tabs { grid-column: 1 / -1; grid-row: 2; justify-self: center; } .visual-layout { grid-template-columns: 1fr; height: auto; } .visual-view { height: auto; } .preview-canvas { height: 44rem; } .events-panel { min-height: 18rem; } }',
      '@media (max-width: 720px) { .app-header { grid-template-columns: 1fr; gap: .75rem; } .header-start, .header-end { justify-content: space-between; width: 100%; } .header-end { flex-wrap: wrap; } .case-control { padding-left: .75rem; } .view-tabs { grid-column: auto; grid-row: auto; width: 100%; } .view-tabs button { flex: 1; padding: 0 .5rem; } .viewport-toolbar { flex-wrap: wrap; justify-content: flex-start; overflow-x: visible; } .preset-list { width: 100%; overflow-x: auto; } .preset-button { flex: 1 0 auto; } .toolbar-divider { display: none; } .visual-view { padding: .65rem; } .preview-canvas { height: 40rem; min-height: 30rem; padding: .7rem; } .code-grid, .documentation-grid { grid-template-columns: 1fr; } }',
      '@media (max-width: 470px) { .identity p { display: none; } .header-start { display: grid; align-items: start; } .identity h1 { white-space: normal; } .case-control { display: grid; gap: .2rem; padding: 0; border-left: 0; } .case-control select { width: 100%; min-width: 0; max-width: none; } .language-switch button { min-width: 2.65rem; } .dimension-readout { order: 2; } .custom-size { order: 3; } .toolbar-actions { order: 4; } .visual-layout { gap: .65rem; } .events-panel { border-radius: 12px; } }'
    ].join(String.fromCharCode(10));
    const content = document.createElement('div');
    content.className = 'studio';
    content.setAttribute('data-demo-region', '');
    content.innerHTML =
      '<header class="app-header" data-workbench-header><div class="header-start"><div class="identity"><h1 data-label="title">' + escapeHtml(labels.title) + '</h1><p data-label="status">' + escapeHtml(labels.status) + '</p></div><div class="case-control"><label for="academy-demo-case" data-label="caseLabel">' + escapeHtml(labels.caseLabel) + '</label><select id="academy-demo-case" data-case="0" data-case-select>' + options + '</select></div></div>' +
      '<nav class="view-tabs" role="tablist" aria-label="' + escapeHtml(labels.title) + '"><button type="button" role="tab" data-view="visual" aria-controls="demo-view-visual" aria-selected="true" data-label="visual">' + escapeHtml(labels.visual) + '</button><button type="button" role="tab" data-view="code" aria-controls="demo-view-code" aria-selected="false" data-label="code">' + escapeHtml(labels.code) + '</button><button type="button" role="tab" data-view="documentation" aria-controls="demo-view-documentation" aria-selected="false" data-label="documentation">' + escapeHtml(labels.documentation) + '</button></nav>' +
      '<div class="header-end"><div class="language-switch" data-language-controls role="group" aria-label="' + escapeHtml(labels.languageLabel) + '"><button type="button" data-language="en" aria-pressed="true" data-label="languageEn">' + escapeHtml(labels.languageEn) + '</button><button type="button" data-language="es" aria-pressed="false" data-label="languageEs">' + escapeHtml(labels.languageEs) + '</button></div><button type="button" class="hide-ui-button" data-hide-ui aria-pressed="false"><span class="eye-icon" aria-hidden="true"></span><span data-hide-ui-label data-label="hideUi">' + escapeHtml(labels.hideUi) + '</span></button></div></header>' +
      '<nav class="viewport-toolbar" data-viewport-toolbar aria-label="' + escapeHtml(labels.viewport) + '"><div class="preset-list" data-preset-list role="group" aria-label="' + escapeHtml(labels.viewport) + '"><button class="preset-button" type="button" data-preset="mobile" aria-pressed="true" data-label="mobile">' + escapeHtml(labels.mobile) + '</button><button class="preset-button" type="button" data-preset="tablet" aria-pressed="false" data-label="tablet">' + escapeHtml(labels.tablet) + '</button><button class="preset-button" type="button" data-preset="desktop" aria-pressed="false" data-label="desktop">' + escapeHtml(labels.desktop) + '</button><button class="preset-button" type="button" data-preset="large-desktop" aria-pressed="false" data-label="largeDesktop">' + escapeHtml(labels.largeDesktop) + '</button><button class="preset-button" type="button" data-preset="fluid" aria-pressed="false" data-label="fluid">' + escapeHtml(labels.fluid) + '</button></div><span class="toolbar-divider" aria-hidden="true"></span><output class="dimension-readout" data-demo-dimensions>375px × 667px</output><div class="custom-size"><label class="size-field"><span data-label="customWidth">' + escapeHtml(labels.customWidth) + '</span><input data-width type="number" min="240" max="1920" placeholder="auto"></label><span class="dimension-cross">×</span><label class="size-field"><span data-label="customHeight">' + escapeHtml(labels.customHeight) + '</span><input data-height type="number" min="240" max="1400" placeholder="auto"></label></div><div class="toolbar-actions"><button class="apply-button" type="button" data-apply data-label="apply">' + escapeHtml(labels.apply) + '</button><a class="open-button" data-open href="' + escapeHtml(selectedCase.src) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(labels.open) + '" title="' + escapeHtml(labels.open) + '">↗</a></div></nav>' +
      '<button type="button" class="show-ui-button" data-show-ui hidden><span class="eye-icon" aria-hidden="true"></span><span data-show-ui-label>' + escapeHtml(labels.showUi) + '</span></button>' +
      '<main class="studio-main" aria-label="' + escapeHtml(labels.interactive) + '"><section id="demo-view-visual" class="visual-view" data-view-surface="visual" data-visual-view><div class="visual-layout"><div class="preview-canvas" data-preview-scroll role="region" tabindex="0" aria-label="' + escapeHtml(labels.livePreview) + '"><div class="canvas-center"><div class="device-frame" data-device-frame><div class="device-status"><span class="status-copy"><span class="status-dot" aria-hidden="true"></span><strong data-case-status>' + escapeHtml(selectedCase.heading) + '</strong></span><span class="case-marker" data-case-marker>#01</span></div><div class="frame-body"><iframe data-demo-frame title="' + escapeHtml(selectedCase.heading) + '" src="' + escapeHtml(selectedCase.src) + '"></iframe></div></div></div></div>' +
      '<aside class="events-panel" aria-live="polite"><div class="events-heading"><h2 data-label="events">' + escapeHtml(labels.events) + '</h2><span class="event-count" data-event-count>00</span></div><p class="event-intro" data-label="eventIntro">' + escapeHtml(labels.eventIntro) + '</p><div class="event-latest" data-event-latest role="group" aria-label="' + escapeHtml(labels.events) + '"><div class="event-latest-label"><span data-label="events">' + escapeHtml(labels.events) + '</span></div><strong class="event-latest-name" data-event-latest-name></strong><code class="event-latest-detail" data-event-latest-detail></code></div><ol class="event-list" data-demo-events></ol></aside></div></section>' +
      '<section id="demo-view-code" class="code-view" data-view-surface="code" data-code-view hidden><h2 class="code-heading" data-label="code">' + escapeHtml(labels.code) + '</h2><div class="code-grid"><article class="code-card"><header class="code-card-header"><span data-label="htmlSnippet">' + escapeHtml(labels.htmlSnippet) + '</span><button class="copy-button" type="button" data-copy="html"><span data-copy-label>' + escapeHtml(labels.copy) + '</span></button></header><pre data-code-block="html">' + escapeHtml(htmlSnippet) + '</pre></article><article class="code-card"><header class="code-card-header"><span data-label="jsSnippet">' + escapeHtml(labels.jsSnippet) + '</span><button class="copy-button" type="button" data-copy="js"><span data-copy-label>' + escapeHtml(labels.copy) + '</span></button></header><pre data-code-block="js">' + escapeHtml(jsSnippet) + '</pre></article></div></section>' +
      '<section id="demo-view-documentation" class="documentation-view" data-view-surface="documentation" data-documentation-view hidden><div class="documentation-shell"><h2 class="documentation-heading" data-label="documentation">' + escapeHtml(labels.documentation) + '</h2><p class="documentation-intro" data-label="documentationDescription">' + escapeHtml(labels.documentationDescription) + '</p><div class="documentation-grid"><article class="documentation-card"><h3 data-label="scope">' + escapeHtml(labels.scope) + '</h3><p data-label="scopeDescription">' + escapeHtml(labels.scopeDescription) + '</p><code>' + escapeHtml(tag) + ' → scoped registry</code></article><article class="documentation-card"><h3 data-label="api">' + escapeHtml(labels.api) + '</h3><p data-label="apiDescription">' + escapeHtml(labels.apiDescription) + '</p><code>this.t(key) · emitEvent(type, detail)</code></article></div><div class="contract-table-wrap"><table class="contract-table"><thead><tr><th data-label="apiColumn">' + escapeHtml(labels.apiColumn) + '</th><th data-label="contractColumn">' + escapeHtml(labels.contractColumn) + '</th><th data-label="evidenceColumn">' + escapeHtml(labels.evidenceColumn) + '</th></tr></thead><tbody><tr><td><code>scopedElements</code></td><td data-label="scope">' + escapeHtml(labels.scope) + '</td><td><code>' + escapeHtml(tag) + '</code></td></tr><tr><td><code>this.t(key)</code></td><td data-label="languageLabel">' + escapeHtml(labels.languageLabel) + '</td><td><code>en · es</code></td></tr><tr><td><code>emitEvent()</code></td><td data-label="events">' + escapeHtml(labels.events) + '</td><td><code>' + escapeHtml(tag) + '-continue</code></td></tr></tbody></table></div></div></section></main>';
    this.replaceChildren(style, content);
    const caseSelect = this.querySelector('[data-case-select]');
    if (caseSelect !== null) {
      caseSelect.value = String(this.selected);
      caseSelect.addEventListener('change', event => this.selectCase(Number(event.currentTarget.value)));
    }
    for (const button of this.querySelectorAll('[data-view]')) button.addEventListener('click', () => this.setView(button.dataset.view));
    for (const button of this.querySelectorAll('[data-language]')) button.addEventListener('click', () => this.setLanguage(button.dataset.language));
    const frame = this.querySelector('[data-demo-frame]');
    if (frame !== null) frame.addEventListener('load', () => this.sendLanguage());
    const hideButton = this.querySelector('[data-hide-ui]');
    if (hideButton !== null) hideButton.addEventListener('click', () => this.toggleUi());
    const showButton = this.querySelector('[data-show-ui]');
    if (showButton !== null) showButton.addEventListener('click', () => this.toggleUi());
    for (const button of this.querySelectorAll('[data-preset]')) {
      button.addEventListener('click', () => {
        this.resolution = button.dataset.preset;
        this.customViewportWidth = '';
        this.customViewportHeight = '';
        this.syncViewportControls();
        this.applyViewport();
      });
    }
    const apply = this.querySelector('[data-apply]');
    if (apply !== null) {
      apply.addEventListener('click', () => {
        this.customViewportWidth = pixelDimension(this.querySelector('[data-width]')?.value);
        this.customViewportHeight = pixelDimension(this.querySelector('[data-height]')?.value);
        this.resolution = 'responsive';
        this.syncViewportControls();
        this.applyViewport();
      });
    }
    for (const button of this.querySelectorAll('[data-copy]')) button.addEventListener('click', () => this.copyCode(button));
    this.setView(this.view);
    this.syncViewportControls();
    this.syncLanguageControls();
    this.updateLabels();
  }
}

if (customElements.get('academy-demo-helper') === undefined) {
  customElements.define('academy-demo-helper', AcademyDemoHelper);
}
`;
