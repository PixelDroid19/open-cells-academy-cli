import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { assertLegacyComponentProfile } from './legacy-component-profiles.js';
import { demoHelperSource } from './component-payload.js';

function className(name) {
  return name.split('-').map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join('');
}

function assertOptions(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    typeof options.name !== 'string' ||
    typeof options.e2e !== 'boolean' ||
    options.kind !== 'component'
  ) {
    throw typedError('INVALID_INPUT', { field: 'component' });
  }
  return Object.freeze({ ...assertLegacyComponentProfile(options), e2e: options.e2e, name: options.name });
}

function catalog(name, language) {
  const displayName = name.replace(/-/g, ' ');
  const prefix = `${name}.demo`;
  const spanish = language === 'es';
  return {
    [`${name}.label`]: `${displayName} ${spanish ? 'listo' : 'ready'}`,
    [`${prefix}.title`]: spanish ? `Demostración de ${displayName}` : `${displayName} demo`,
    [`${prefix}.status`]: spanish ? 'Ejemplo interactivo' : 'Interactive specimen',
    [`${prefix}.case.basic`]: spanish ? 'Básico' : 'Basic',
    [`${prefix}.case.basic.description`]: spanish ? 'Un primer caso Lit de Cells 4 con idioma y eventos.' : 'A first Cells 4 Lit case with locale and event controls.',
    [`${prefix}.live-preview`]: spanish ? 'Vista previa' : 'Live preview',
    [`${prefix}.event-intro`]: spanish ? 'Los eventos emitidos por el componente aparecen aquí como un flujo inspeccionable.' : 'Events emitted by the component appear here as an inspectable stream.',
    [`${prefix}.event`]: spanish ? 'Evento: {event}' : 'Event: {event}',
    [`${prefix}.event.empty`]: spanish ? 'Activa el componente para ver su evento.' : 'Activate the component to see its event.',
    [`${prefix}.interactive`]: spanish ? 'Demo interactiva' : 'Interactive demo',
    [`${prefix}.documentation`]: spanish ? 'Documentación' : 'Documentation',
    [`${prefix}.documentation.description`]: spanish ? 'Una referencia compacta del contrato del componente usado en esta demo.' : 'A compact reference for the component contract used in this demo.',
    [`${prefix}.visual`]: 'Visual',
    [`${prefix}.code`]: spanish ? 'Código' : 'Code',
    [`${prefix}.case`]: spanish ? 'Caso' : 'Case',
    [`${prefix}.language`]: spanish ? 'Idioma' : 'Language',
    [`${prefix}.language.en`]: spanish ? 'Inglés' : 'English',
    [`${prefix}.language.es`]: spanish ? 'Español' : 'Spanish',
    [`${prefix}.hide-ui`]: spanish ? 'Ocultar interfaz' : 'Hide UI',
    [`${prefix}.show-ui`]: spanish ? 'Mostrar interfaz' : 'Show UI',
    [`${prefix}.resolution`]: spanish ? 'Preajuste de viewport' : 'Viewport preset',
    [`${prefix}.viewport`]: spanish ? 'Viewport de demo' : 'Demo viewport',
    [`${prefix}.events`]: spanish ? 'Eventos' : 'Events',
    [`${prefix}.events.label`]: spanish ? 'Evento:' : 'Event:',
    [`${prefix}.events.latest`]: spanish ? 'Último evento' : 'Latest event',
    [`${prefix}.events.history`]: spanish ? 'Historial de eventos' : 'Event history',
    [`${prefix}.events.clear`]: spanish ? 'Limpiar' : 'Clear',
    [`${prefix}.events.export`]: spanish ? 'Exportar' : 'Export',
    [`${prefix}.events.filter`]: spanish ? 'Filtrar eventos…' : 'Filter events…',
    [`${prefix}.events.empty`]: spanish ? 'Aún no se han capturado eventos.' : 'No events captured yet.',
    [`${prefix}.custom.width`]: spanish ? 'Ancho' : 'Width',
    [`${prefix}.custom.height`]: spanish ? 'Alto' : 'Height',
    [`${prefix}.apply`]: spanish ? 'Aplicar' : 'Apply',
    [`${prefix}.responsive`]: spanish ? 'Adaptable' : 'Responsive',
    [`${prefix}.fluid`]: spanish ? 'Fluido' : 'Fluid',
    [`${prefix}.mobile`]: spanish ? 'Móvil' : 'Mobile',
    [`${prefix}.tablet`]: spanish ? 'Tableta' : 'Tablet',
    [`${prefix}.desktop`]: spanish ? 'Escritorio' : 'Desktop',
    [`${prefix}.large-desktop`]: spanish ? 'Escritorio grande' : 'Large Desktop',
    [`${prefix}.open`]: spanish ? 'Abrir en una pestaña nueva' : 'Open in new tab',
    [`${prefix}.pattern.label`]: spanish ? 'Fondo:' : 'Background:',
    [`${prefix}.pattern.dots`]: spanish ? 'Puntos' : 'Dots',
    [`${prefix}.pattern.grid`]: spanish ? 'Retícula' : 'Grid',
    [`${prefix}.pattern.clean`]: spanish ? 'Limpio' : 'Clean',
    [`${prefix}.brand-badge`]: 'SDK',
    [`${prefix}.copy`]: spanish ? 'Copiar' : 'Copy',
    [`${prefix}.copied`]: spanish ? 'Copiado' : 'Copied',
    [`${prefix}.scope`]: spanish ? 'Composición aislada' : 'Scoped composition',
    [`${prefix}.scope.description`]: spanish ? 'El componente registra sus controles secundarios en un registro local aislado.' : 'The component registers child controls in a local scoped registry.',
    [`${prefix}.api`]: spanish ? 'Contrato del componente' : 'Component contract',
    [`${prefix}.api.description`]: spanish ? 'Usa propiedades públicas, etiquetas traducidas y eventos emitidos.' : 'Use public properties, translated labels and emitted events.',
    [`${prefix}.api-column`]: 'API',
    [`${prefix}.contract-column`]: spanish ? 'Contrato Cells' : 'Cells contract',
    [`${prefix}.evidence-column`]: spanish ? 'Evidencia en la demo' : 'Demo evidence',
    [`${prefix}.html-snippet`]: spanish ? 'Uso en HTML' : 'HTML usage',
    [`${prefix}.js-snippet`]: spanish ? 'Uso en JavaScript' : 'JavaScript usage',
    [`${prefix}.no-case`]: spanish ? 'No hay casos de demo disponibles' : 'No demo case available'
  };
}

function catalogs(name) {
  return { en: catalog(name, 'en'), es: catalog(name, 'es') };
}

function litSource(name, base) {
  const klass = className(name);
  const moduleName = base === 'lit1' ? 'lit-element' : 'lit';
  return `import { LitElement, html, css } from '${moduleName}';

export class ${klass} extends LitElement {
  static get properties() {
    return { label: { type: String } };
  }

  static get styles() {
    return css\`
      :host { display: block; }
      button { width: 100%; min-height: 3rem; border: 0; border-radius: .9rem; padding: .75rem 1.25rem; background: #0f172a; color: #fff; font: 700 .9rem/1 system-ui, sans-serif; cursor: pointer; }
      button:hover { background: #1e293b; }
      button:focus-visible { outline: 3px solid #7dd3fc; outline-offset: 3px; }
    \`;
  }

  constructor() {
    super();
    this.label = '${name.replace(/-/g, ' ')}';
  }

  render() {
    return html\`<button type="button" @click=\${this.notifyContinue}>\${this.label}</button>\`;
  }

  notifyContinue() {
    this.dispatchEvent(new CustomEvent('${name}-continue', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { component: '${name}' }
    }));
  }
}

if (customElements.get('${name}') === undefined) customElements.define('${name}', ${klass});
`;
}

function demoIndexSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${name} demo</title>
  </head>
  <body>
    <academy-demo-helper component-tag="${name}" events="${name}-continue">
      <academy-demo-case heading="Basic" description="A first Cells 4 Lit case with locale and event controls." heading-key="caseBasic" description-key="caseBasicDescription" src="./basic.html"></academy-demo-case>
    </academy-demo-helper>
    <script type="module" src="./demo-build.js"></script>
  </body>
</html>
`;
}

function rootIndexSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${name}</title>
    <meta http-equiv="refresh" content="0; url=demo/index.html">
  </head>
  <body></body>
</html>
`;
}

function basicDemoSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${name} basic demo</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; min-width: 280px; min-height: 100%; background: transparent; }
      body { color: #0f172a; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
      main[data-demo-root] { min-height: 100vh; padding: clamp(1rem, 5vw, 3rem); display: grid; place-items: center; box-sizing: border-box; }
      .inner-demo { display: grid; gap: 1.75rem; width: min(100%, 35rem); border: 1px solid #e2e8f0; border-radius: 1.25rem; padding: 2rem; background: #fff; box-shadow: 0 10px 25px -12px rgb(15 23 42 / 22%); box-sizing: border-box; }
      .inner-demo-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
      .inner-demo-status, .inner-demo-id { display: inline-flex; align-items: center; border-radius: 999px; padding: .28rem .65rem; font-size: .72rem; font-weight: 700; }
      .inner-demo-status { border: 1px solid #a7f3d0; background: #ecfdf5; color: #047857; }
      .inner-demo-id { background: #f1f5f9; color: #475569; font-family: ui-monospace, monospace; }
      .inner-demo-title { margin: 0; font-size: clamp(1.55rem, 4vw, 2rem); line-height: 1.2; letter-spacing: -.035em; }
      .inner-demo-event { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      ${name} { display: block; width: 100%; }
    </style>
    <script>
      window.IntlMsg = window.IntlMsg || {};
      window.IntlMsg.lang = document.documentElement.lang;
      window.IntlMsg.localesHost = '.';
    </script>
  </head>
  <body>
    <main data-demo-root></main>
    <script type="module" src="./demo.js"></script>
  </body>
</html>
`;
}

function demoSource(name) {
  return `import '../src/${name}.js';
import catalogs from './locales/locales.json' with { type: 'json' };

const root = document.querySelector('[data-demo-root]');
const component = document.createElement('${name}');
const eventOutput = document.createElement('output');
const shell = document.createElement('section');
const shellHeader = document.createElement('header');
const shellStatus = document.createElement('span');
const shellId = document.createElement('span');
const shellTitle = document.createElement('h2');
const labelKey = '${name}.label';
const prefix = '${name}.demo';

shell.className = 'inner-demo';
shellHeader.className = 'inner-demo-header';
shellStatus.className = 'inner-demo-status';
shellId.className = 'inner-demo-id';
shellTitle.className = 'inner-demo-title';
shellId.textContent = '#01';
eventOutput.className = 'inner-demo-event';
eventOutput.dataset.event = '';
eventOutput.setAttribute('aria-live', 'polite');
shellHeader.append(shellStatus, shellId);
shell.append(shellHeader, shellTitle, component, eventOutput);

function t(language, suffix) {
  const key = prefix + '.' + suffix;
  return catalogs[language]?.[key] ?? catalogs.en[key];
}

function labels(language) {
  return {
    title: t(language, 'title'),
    status: t(language, 'status'),
    caseBasic: t(language, 'case.basic'),
    caseBasicDescription: t(language, 'case.basic.description'),
    livePreview: t(language, 'live-preview'),
    eventIntro: t(language, 'event-intro'),
    interactive: t(language, 'interactive'),
    documentation: t(language, 'documentation'),
    documentationDescription: t(language, 'documentation.description'),
    visual: t(language, 'visual'),
    code: t(language, 'code'),
    caseLabel: t(language, 'case'),
    languageLabel: t(language, 'language'),
    languageEn: t(language, 'language.en'),
    languageEs: t(language, 'language.es'),
    hideUi: t(language, 'hide-ui'),
    showUi: t(language, 'show-ui'),
    resolution: t(language, 'resolution'),
    viewport: t(language, 'viewport'),
    events: t(language, 'events'),
    eventLabel: t(language, 'events.label'),
    eventLatest: t(language, 'events.latest'),
    eventHistory: t(language, 'events.history'),
    clearEvents: t(language, 'events.clear'),
    exportEvents: t(language, 'events.export'),
    eventFilter: t(language, 'events.filter'),
    eventsEmpty: t(language, 'events.empty'),
    customWidth: t(language, 'custom.width'),
    customHeight: t(language, 'custom.height'),
    apply: t(language, 'apply'),
    responsive: t(language, 'responsive'),
    fluid: t(language, 'fluid'),
    mobile: t(language, 'mobile'),
    tablet: t(language, 'tablet'),
    desktop: t(language, 'desktop'),
    largeDesktop: t(language, 'large-desktop'),
    open: t(language, 'open'),
    patternLabel: t(language, 'pattern.label'),
    patternDots: t(language, 'pattern.dots'),
    patternGrid: t(language, 'pattern.grid'),
    patternClean: t(language, 'pattern.clean'),
    brandBadge: t(language, 'brand-badge'),
    copy: t(language, 'copy'),
    copied: t(language, 'copied'),
    scope: t(language, 'scope'),
    scopeDescription: t(language, 'scope.description'),
    api: t(language, 'api'),
    apiDescription: t(language, 'api.description'),
    apiColumn: t(language, 'api-column'),
    contractColumn: t(language, 'contract-column'),
    evidenceColumn: t(language, 'evidence-column'),
    htmlSnippet: t(language, 'html-snippet'),
    jsSnippet: t(language, 'js-snippet'),
    noCase: t(language, 'no-case')
  };
}

function publishLabels(language) {
  window.parent.postMessage({
    source: 'academy-demo',
    kind: 'labels',
    language,
    labels: labels(language)
  }, window.location.origin);
}

function setLanguage(language) {
  const selectedLanguage = language === 'es' ? 'es' : 'en';
  document.documentElement.lang = selectedLanguage;
  component.label = catalogs[selectedLanguage]?.[labelKey] ?? catalogs.en[labelKey];
  shellStatus.textContent = '● ' + t(selectedLanguage, 'case.basic');
  shellTitle.textContent = component.label;
  eventOutput.textContent = t(selectedLanguage, 'event.empty');
  root.replaceChildren(shell);
  document.title = t(selectedLanguage, 'title');
  publishLabels(selectedLanguage);
}

component.addEventListener('${name}-continue', event => {
  const language = document.documentElement.lang;
  eventOutput.textContent = t(language, 'event').replace('{event}', event.type);
  window.parent.postMessage({ source: 'academy-demo', kind: 'event', eventType: event.type, detail: event.detail }, window.location.origin);
});

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'academy-demo-host' || message.kind !== 'language') return;
  if (message.language !== 'en' && message.language !== 'es') return;
  setLanguage(message.language);
});

setLanguage('en');
`;
}


function litStylesSource(base) {
  const moduleName = base === 'lit1' ? 'lit-element' : 'lit';
  return `import { css } from '${moduleName}';\nexport default css\`:host { display: block; }\`;\n`;
}

function viteConfigSource() {
  return `import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2019' },
  server: { host: '127.0.0.1' }
});
`;
}

function vitestConfigSource() {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['test/unit/**/*.test.js']
  }
});
`;
}

function playwrightConfigSource(command) {
  return `import { defineConfig } from '@playwright/test';

const address = 'http://127.0.0.1:4173';
const channel = process.env.OPEN_CELLS_PLAYWRIGHT_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: address, channel },
  webServer: {
    command: '${command} --host 127.0.0.1 --port 4173 --strictPort --no-open',
    url: address,
    reuseExistingServer: false
  }
});
`;
}

function e2eSource(name, workbench) {
  const workbenchAssertions = workbench
    ? `  const helper = page.locator('academy-demo-helper');
  await expect(helper).toBeVisible();
  const demo = page.frameLocator('iframe[data-demo-frame]');
  await expect(demo.locator('${name}')).toBeVisible();
  await demo.getByRole('button').click();
  await expect(helper.locator('[data-event-latest-name]')).toHaveText('${name}-continue');
`
    : `  await expect(page.locator('body')).toBeVisible();
`;
  return `import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('runs the generated Cells 4 component demo', async ({ page }) => {
  await page.goto('/demo/');
${workbenchAssertions}  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});
`;
}

function polymerSource(name, profile) {
  const klass = className(name);
  if (profile === 'component') {
    return `import { PolymerElement, html } from '@polymer/polymer/polymer-element.js';

export class ${klass} extends PolymerElement {
  static get is() { return '${name}'; }
  static get properties() { return { label: { type: String } }; }
  static get template() { return html\`<button type="button">\${this.label}\</button>\`; }
}

customElements.define(${klass}.is, ${klass});
`;
  }
  if (profile === 'behavior') {
    return `export const ${klass}Behavior = Object.freeze({
  properties: { active: { type: Boolean, value: false } },
  activate(host) { host.active = true; }
});
`;
  }
  if (profile === 'data-manager') {
    return `export class ${klass}DataManager extends EventTarget {
  async load(value = {}) {
    this.dispatchEvent(new CustomEvent('${name}-loading', { detail: value }));
    this.dispatchEvent(new CustomEvent('${name}-success', { detail: value }));
    return value;
  }
}
`;
  }
  return `export const ${klass}Theme = Object.freeze({
  host: ':host { display: block; }',
  surface: 'var(--academy-surface, white)'
});
`;
}

export function createLegacyComponentPayload(options) {
  const normalized = assertOptions(options);
  const klass = className(normalized.name);
  const base = normalized.componentBase;
  const profile = normalized.componentProfile;
  const source = base === undefined ? polymerSource(normalized.name, profile) : litSource(normalized.name, base);
  const locale = catalogs(normalized.name);
  let plan = ScaffoldPlan.empty()
    .addDirectory('test/coverage')
    .addFile('index.html', base === undefined ? '<!doctype html><html lang="en"><body><main></main><script type="module" src="./demo/demo.js"></script></body></html>\n' : rootIndexSource(normalized.name))
    .addFile('demo/index.html', base === undefined ? '<!doctype html><html lang="en"><body><main></main><script type="module" src="./demo.js"></script></body></html>\n' : demoIndexSource(normalized.name))
    .addFile('demo/demo.js', base === undefined ? `import '../src/${normalized.name}.js';\n` : demoSource(normalized.name))
    .addFile('vite.config.js', viteConfigSource())
    .addFile('vitest.config.js', vitestConfigSource())
    .addFile('locales/locales.json', JSON.stringify(locale, null, 2) + '\n')
    .addFile('test/unit/locales/locales.json', JSON.stringify(locale, null, 2) + '\n')
    .addFile(`src/${normalized.name}.js`, source)
    .addFile(`test/unit/${normalized.name}.test.js`, `import '../../src/${normalized.name}.js';\n\ntest('${normalized.name} source loads', () => {});\n`)
    .addDependency('@web/test-runner', '0.19.0', 'dev')
    .addDependency('@web/test-runner-playwright', '0.11.0', 'dev')
    .addDependency('@web/test-runner-junit-reporter', '0.8.0', 'dev');
  plan = plan.addDependency('@vitest/coverage-v8', '3.2.4', 'dev');
  if (base !== undefined) {
    plan = plan
      .addFile('demo/basic.html', basicDemoSource(normalized.name))
      .addFile('demo/demo-build.js', "import './academy-demo-helper.js';\n")
      .addFile('demo/academy-demo-helper.js', demoHelperSource())
      .addFile('demo/locales/locales.json', JSON.stringify(locale, null, 2) + '\n')
      .addFile(`src/${normalized.name}.scss`, `:host { display: block; }\n`)
      .addFile(`src/${normalized.name}.css.js`, litStylesSource(base))
      .addDependency(base === 'lit1' ? 'lit-element' : 'lit', base === 'lit1' ? '^2.5.1' : '^3.3.3', 'runtime')
      .addDependency('@open-wc/scoped-elements', base === 'lit1' ? '^1.0.0' : '^3.0.10', 'runtime')
      .addDependency('sass', '^1.80.0', 'dev')
      .addDependency('vite', '7.3.6', 'dev')
      .addDependency('vitest', '^3.2.4', 'dev')
      .addDependency('happy-dom', '^20.11.2', 'dev')
      .addDependency('eslint', '^9.0.0', 'dev')
      .addDependency('@custom-elements-manifest/analyzer', '^0.10.0', 'dev');
  } else {
    plan = plan
      .addDependency('@polymer/polymer', '^3.5.0', 'runtime')
      .addDependency('@webcomponents/webcomponentsjs', '^2.8.0', 'dev')
      .addDependency('vite', '7.3.6', 'dev')
      .addDependency('vitest', '^3.2.4', 'dev')
      .addDependency('happy-dom', '^20.11.2', 'dev')
      .addDependency('eslint', '^9.0.0', 'dev')
      .addDependency('@custom-elements-manifest/analyzer', '^0.10.0', 'dev');
  }
  if (normalized.e2e) {
    const serveCommand = base === undefined ? 'cells component:serve' : 'cells lit-component:serve';
    plan = plan
      .addFile('playwright.config.js', playwrightConfigSource(serveCommand))
      .addFile('e2e/smoke.spec.js', e2eSource(normalized.name, base !== undefined))
      .addDependency('@axe-core/playwright', '^4.10.0', 'dev')
      .addDependency('@playwright/test', '^1.50.0', 'dev');
  }
  return plan;
}
