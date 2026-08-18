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

function catalogs(name) {
  const key = `${name}.label`;
  return {
    en: { [key]: `${name.replace(/-/g, ' ')} ready` },
    es: { [key]: `${name.replace(/-/g, ' ')} listo` }
  };
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
    return css\` :host { display: block; } \`;
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
    <academy-demo-helper events="${name}-continue">
      <academy-demo-case heading="Basic" description="A first Cells 4 Lit case with locale and event controls." src="./basic.html"></academy-demo-case>
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
const controls = document.createElement('div');
const english = document.createElement('button');
const spanish = document.createElement('button');
const key = '${name}.label';

english.type = 'button';
english.textContent = 'English';
spanish.type = 'button';
spanish.textContent = 'Spanish';
controls.append(english, spanish);

function labels(language) {
  return {
    caseBasic: language === 'es' ? 'Básico' : 'Basic',
    caseBasicDescription: language === 'es' ? 'Un primer caso Lit de Cells 4 con idioma y eventos.' : 'A first Cells 4 Lit case with locale and event controls.',
    resolution: language === 'es' ? 'Preajuste de viewport' : 'Viewport preset',
    viewport: language === 'es' ? 'Viewport de demo' : 'Demo viewport',
    events: language === 'es' ? 'Eventos' : 'Events',
    eventsEmpty: language === 'es' ? 'Aún no se han capturado eventos.' : 'No events captured yet.',
    customWidth: language === 'es' ? 'Ancho' : 'Width',
    customHeight: language === 'es' ? 'Alto' : 'Height',
    apply: language === 'es' ? 'Aplicar' : 'Apply'
  };
}

function publishLabels(language) {
  window.parent.postMessage({ source: 'academy-demo', kind: 'labels', labels: labels(language) }, window.location.origin);
}

function render(language) {
  document.documentElement.lang = language;
  component.label = catalogs[language]?.[key] ?? catalogs.en[key];
  eventOutput.textContent = language === 'es' ? 'Activa el componente para ver su evento.' : 'Activate the component to see its event.';
  root.replaceChildren(controls, component, eventOutput);
  publishLabels(language);
}

component.addEventListener('${name}-continue', event => {
  const language = document.documentElement.lang;
  eventOutput.textContent = (language === 'es' ? 'Evento: ' : 'Event: ') + event.type;
  window.parent.postMessage({ source: 'academy-demo', kind: 'event', eventType: event.type, detail: event.detail }, window.location.origin);
});

english.addEventListener('click', () => render('en'));
spanish.addEventListener('click', () => render('es'));
render('en');
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
  if (normalized.e2e) plan = plan.addFile('e2e/smoke.spec.js', `import { test, expect } from '@playwright/test';\ntest('${normalized.name}', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./u); });\n`).addDependency('@playwright/test', '^1.50.0', 'dev');
  return plan;
}
