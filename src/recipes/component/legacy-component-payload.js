import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { assertLegacyComponentProfile } from './legacy-component-profiles.js';

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
    return html\`<button type="button">\${this.label}</button>\`;
  }
}

if (customElements.get('${name}') === undefined) customElements.define('${name}', ${klass});
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
    .addFile('index.html', '<!doctype html><html lang="en"><body><main></main><script type="module" src="./demo/demo.js"></script></body></html>\n')
    .addFile('demo/index.html', '<!doctype html><html lang="en"><body><main></main><script type="module" src="./demo.js"></script></body></html>\n')
    .addFile('demo/demo.js', `import '../src/${normalized.name}.js';\n`)
    .addFile('vite.config.js', viteConfigSource())
    .addFile('vitest.config.js', vitestConfigSource())
    .addFile('locales/locales.json', JSON.stringify(locale, null, 2) + '\n')
    .addFile('test/unit/locales/locales.json', JSON.stringify(locale, null, 2) + '\n')
    .addFile(`src/${normalized.name}.js`, source)
    .addFile(`test/unit/${normalized.name}.test.js`, `import '../../src/${normalized.name}.js';\n\ntest('${normalized.name} source loads', () => {});\n`)
  if (base !== undefined) {
    plan = plan
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
