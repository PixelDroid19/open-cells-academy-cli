import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertComponentOptions(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    typeof options.name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(options.name) ||
    typeof options.e2e !== 'boolean'
  ) {
    throw typedError('INVALID_INPUT', { field: 'component' });
  }
  return Object.freeze({ name: options.name, e2e: options.e2e });
}

function componentClassName(name) {
  const candidate = name
    .split('-')
    .map(segment => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join('');
  return /^\d/.test(candidate) ? `Component${candidate}` : candidate;
}

function messageKeys(name) {
  return Object.freeze({
    heading: `${name}.heading`,
    continue: `${name}.continue`,
    demoTitle: `${name}.demo.title`,
    demoLanguageEn: `${name}.demo.language.en`,
    demoLanguageEs: `${name}.demo.language.es`,
    demoEvent: `${name}.demo.event`,
    demoEventEmpty: `${name}.demo.event.empty`
  });
}

function componentCatalogs(name, keys) {
  const displayName = name.replace(/-/g, ' ');
  return Object.freeze({
    en: Object.freeze({
      [keys.heading]: `${displayName} ready`,
      [keys.continue]: 'Continue',
      [keys.demoTitle]: `${displayName} demo`,
      [keys.demoLanguageEn]: 'English',
      [keys.demoLanguageEs]: 'Spanish',
      [keys.demoEvent]: 'Event: {event}',
      [keys.demoEventEmpty]: 'Activate the component to see its event.'
    }),
    es: Object.freeze({
      [keys.heading]: `${displayName} listo`,
      [keys.continue]: 'Continuar',
      [keys.demoTitle]: `Demostración de ${displayName}`,
      [keys.demoLanguageEn]: 'Inglés',
      [keys.demoLanguageEs]: 'Español',
      [keys.demoEvent]: 'Evento: {event}',
      [keys.demoEventEmpty]: 'Activa el componente para ver su evento.'
    })
  });
}

function entrypointSource(name, className) {
  return `import '@webcomponents/scoped-custom-element-registry';
import { ${className} } from './src/${className}.js';

if (customElements.get('${name}') === undefined) {
  customElements.define('${name}', ${className});
}

export { ${className} };
`;
}

function componentSource(name, className, keys) {
  return `import { LitElement, html } from 'lit';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { WidgetMixin as widgetMixin } from './mixins/WidgetMixin.js';
import { AcademyTypeText } from './components/AcademyTypeText.js';
import { AcademyButtonDefault } from './components/AcademyButtonDefault.js';
import componentStyles from './${name}.css.js';

/**
 * Academy teaching adapter for independent Cells-style component composition.
 * @fires ${name}-continue - Emitted when the learner activates the continuation control.
 */
export class ${className} extends widgetMixin(ScopedElementsMixin(LitElement)) {
  static get scopedElements() {
    return {
      ...super.scopedElements,
      'academy-type-text': AcademyTypeText,
      'academy-button-default': AcademyButtonDefault
    };
  }

  static styles = componentStyles;

  /**
   * Emits the public continuation event for this teaching component.
   * @returns {void}
   */
  notifyContinue() {
    this.emitEvent('continue', { component: ${JSON.stringify(name)} });
  }

  render() {
    return html\`<article>
      <academy-type-text .text=\${this.t(${JSON.stringify(keys.heading)})}></academy-type-text>
      <slot></slot>
      <academy-button-default .text=\${this.t(${JSON.stringify(keys.continue)})} @click=\${this.notifyContinue}></academy-button-default>
    </article>\`;
  }
}
`;
}

const COMPONENT_STYLE_RULES = `  :host { display: block; max-width: 32rem; color: #072146; font: 16px/1.5 system-ui, sans-serif; }
  article { display: grid; gap: 1rem; border: 1px solid #d4edfc; border-radius: .5rem; padding: 1rem; background: white; }
  academy-type-text { display: block; font-size: 1.5rem; font-weight: 600; }
  academy-button-default { justify-self: start; }`;

function scssSource() {
  return `${COMPONENT_STYLE_RULES}\n`;
}

function stylesSource() {
  return `import { css } from 'lit';

export default css\`
${COMPONENT_STYLE_RULES}
\`;
`;
}

function rootIndexSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="0; url=demo/">
    <title></title>
  </head>
  <body></body>
</html>
`;
}

function demoIndexSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
  </head>
  <body>
    <main data-demo-root></main>
    <script type="module" src="./demo-build.js"></script>
  </body>
</html>
`;
}

function basicDemoSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
  </head>
  <body>
    <main data-demo-root></main>
    <script type="module" src="./demo.js"></script>
  </body>
</html>
`;
}

function demoBuildSource() {
  return `import './demo.js';
`;
}

function demoSource(name, keys) {
  return `import '@webcomponents/scoped-custom-element-registry';
import { installIntlMsg } from '../src/runtime/academy-intl-msg.js';

const intlMsg = installIntlMsg({ forTesting: false });
intlMsg.lang = 'en';
document.documentElement.lang = 'en';
intlMsg.localesHost = new URL('./locales/locales.json', import.meta.url).href;
await intlMsg.loadUrlResourcesComplete;
await import('../${name}.js');

const root = document.querySelector('[data-demo-root]');

function textElement(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

async function setLanguage(language) {
  intlMsg.lang = language;
  document.documentElement.lang = language;
  await intlMsg.loadUrlResourcesComplete;
  renderDemo();
}

function renderDemo() {
  const title = textElement('h1', intlMsg.t(${JSON.stringify(keys.demoTitle)}));
  const controls = document.createElement('div');
  const english = textElement('button', intlMsg.t(${JSON.stringify(keys.demoLanguageEn)}));
  const spanish = textElement('button', intlMsg.t(${JSON.stringify(keys.demoLanguageEs)}));
  const component = document.createElement('${name}');
  const eventOutput = document.createElement('output');

  english.type = 'button';
  spanish.type = 'button';
  eventOutput.dataset.event = '';
  eventOutput.setAttribute('aria-live', 'polite');
  eventOutput.textContent = intlMsg.t(${JSON.stringify(keys.demoEventEmpty)});
  english.addEventListener('click', () => {
    void setLanguage('en');
  });
  spanish.addEventListener('click', () => {
    void setLanguage('es');
  });
  component.addEventListener('${name}-continue', event => {
    eventOutput.textContent = intlMsg.t(${JSON.stringify(keys.demoEvent)}, { event: event.type });
  });
  controls.append(english, spanish);
  root.replaceChildren(title, controls, component, eventOutput);
  document.title = intlMsg.t(${JSON.stringify(keys.demoTitle)});
}

renderDemo();
`;
}

function unitTestSource(name, className) {
  return `import catalogs from './locales/locales.json' with { type: 'json' };
import { AcademyButtonDefault } from '../../src/components/AcademyButtonDefault.js';
import { AcademyTypeText } from '../../src/components/AcademyTypeText.js';
import { installIntlMsg } from '../../src/runtime/academy-intl-msg.js';
import { ${className} } from '../../${name}.js';

const beforeEachTest = globalThis.beforeEach ?? globalThis.setup;
const afterEachTest = globalThis.afterEach ?? globalThis.teardown;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message + '. Expected ' + String(expected) + ', received ' + String(actual) + '.');
}

function assertDeepEqual(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message + '.');
}

function assertIncludes(actual, expected, message) {
  assert(typeof actual === 'string' && actual.includes(expected), message + '.');
}

function assertInstanceOf(actual, constructor, message) {
  assert(actual instanceof constructor, message + '.');
}

async function renderComponent() {
  const component = document.createElement('${name}');
  document.body.replaceChildren(component);
  await component.updateComplete;
  return component;
}

async function scopedChildren(component) {
  const typeText = component.shadowRoot.querySelector('academy-type-text');
  const button = component.shadowRoot.querySelector('academy-button-default');
  await typeText.updateComplete;
  await button.updateComplete;
  return { typeText, button };
}

suite('${name}', () => {
  beforeEachTest(async () => {
    const intlMsg = installIntlMsg({ catalogs, language: 'en', forTesting: true });
    await intlMsg.loadUrlResourcesComplete;
  });

  afterEachTest(() => {
    document.body.replaceChildren();
  });

  test('renders English through locally scoped Academy elements', async () => {
    const component = await renderComponent();
    const { typeText, button } = await scopedChildren(component);

    assertInstanceOf(component, ${className}, 'The component is registered with its public class');
    assertInstanceOf(typeText, AcademyTypeText, 'The text control uses its local scoped definition');
    assertInstanceOf(button, AcademyButtonDefault, 'The button control uses its local scoped definition');
    assertIncludes(typeText.shadowRoot.textContent, '${name.replace(/-/g, ' ')} ready', 'The English heading renders');
    assertEqual(button.shadowRoot.querySelector('button').textContent, 'Continue', 'The English continuation label renders');
    assertEqual(customElements.get('academy-type-text'), undefined, 'The text control does not leak to the global registry');
    assertEqual(customElements.get('academy-button-default'), undefined, 'The button control does not leak to the global registry');
  });

  test('renders Spanish after the installed IntlMsg language switch', async () => {
    const component = await renderComponent();
    const intlMsg = globalThis.IntlMsg;

    intlMsg.lang = 'es';
    await intlMsg.loadUrlResourcesComplete;
    await component.updateComplete;
    const { typeText, button } = await scopedChildren(component);

    assertIncludes(typeText.shadowRoot.textContent, '${name.replace(/-/g, ' ')} listo', 'The Spanish heading renders');
    assertEqual(button.shadowRoot.querySelector('button').textContent, 'Continuar', 'The Spanish continuation label renders');
  });

  test('emits a prefixed continuation event with default delivery options', async () => {
    const component = await renderComponent();
    const { button } = await scopedChildren(component);
    const continued = new Promise(resolve => {
      component.addEventListener('${name}-continue', resolve, { once: true });
    });

    button.shadowRoot.querySelector('button').click();
    const event = await continued;

    assertEqual(event.type, '${name}-continue', 'The event has the component prefix');
    assertDeepEqual(event.detail, { component: '${name}' }, 'The event publishes its public detail');
    assertEqual(event.bubbles, true, 'The event bubbles');
    assertEqual(event.composed, true, 'The event is composed');
    assertEqual(event.cancelable, true, 'The event is cancelable');
  });
});
`;
}

function accessibilityTestSource(name) {
  return `import catalogs from './locales/locales.json' with { type: 'json' };
import { installIntlMsg } from '../../src/runtime/academy-intl-msg.js';
import '../../${name}.js';

const beforeEachTest = globalThis.beforeEach ?? globalThis.setup;
const afterEachTest = globalThis.afterEach ?? globalThis.teardown;

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

async function resolveAxe() {
  const axeModule = await import('axe-core');
  const axe = axeModule.default ?? globalThis.axe;
  if (typeof axe?.run !== 'function') {
    throw new Error('Axe did not load a run function.');
  }
  return axe;
}

suite('${name} accessibility', () => {
  beforeEachTest(async () => {
    const intlMsg = installIntlMsg({ catalogs, language: 'en', forTesting: true });
    await intlMsg.loadUrlResourcesComplete;
  });

  afterEachTest(() => {
    document.body.replaceChildren();
  });

  test('has no automatically detectable violations inside a landmark', async () => {
    const component = document.createElement('${name}');
    const main = document.createElement('main');
    main.append(component);
    document.body.replaceChildren(main);
    await component.updateComplete;

    const axe = await resolveAxe();
    const results = await axe.run(main);
    assertDeepEqual(results.violations.map(violation => violation.id), [], 'The component has no automatically detectable accessibility violations');
  });
});
`;
}

function testSetupSource() {
  return `import * as PropertySymbol from 'happy-dom/lib/PropertySymbol.js';

const scopedRegistry = Symbol('academyScopedRegistry');
const aliases = new WeakMap();
let aliasNumber = 0;

function aliasFor(constructor) {
  let alias = aliases.get(constructor);
  if (alias === undefined) {
    alias = 'academy-test-scoped-' + aliasNumber;
    aliasNumber += 1;
    customElements.define(alias, constructor);
    aliases.set(constructor, alias);
  }
  return alias;
}

function upgradeScopedChildren(root, fragment) {
  const registry = root[scopedRegistry];
  for (const [tagName, definition] of registry.entries()) {
    for (const placeholder of fragment.querySelectorAll(tagName)) {
      const element = document.createElement(definition.alias);
      for (const attribute of placeholder.attributes) {
        element.setAttribute(attribute.name, attribute.value);
      }
      element.append(...placeholder.childNodes);
      element[PropertySymbol.tagName] = tagName.toUpperCase();
      element[PropertySymbol.localName] = tagName;
      placeholder.replaceWith(element);
      element.connectedCallback();
    }
  }
  return fragment;
}

class TestScopedRegistry {
  constructor() {
    this.definitions = new Map();
  }

  define(tagName, constructor) {
    if (this.definitions.has(tagName)) {
      throw new Error('Duplicate scoped element: ' + tagName);
    }
    this.definitions.set(tagName, { constructor, alias: aliasFor(constructor) });
  }

  get(tagName) {
    return this.definitions.get(tagName)?.constructor;
  }

  entries() {
    return this.definitions.entries();
  }
}

globalThis.CustomElementRegistry = TestScopedRegistry;

const attachShadow = HTMLElement.prototype.attachShadow;

HTMLElement.prototype.attachShadow = function(options) {
  const root = attachShadow.call(this, options);
  const registry = options.registry ?? options.customElements;
  if (registry instanceof TestScopedRegistry) {
    root[scopedRegistry] = registry;
    const importScope = root.importNode === undefined ? root.ownerDocument : root;
    const importNode = importScope.importNode;
    root.importNode = function(node, deep) {
      return upgradeScopedChildren(root, importNode.call(importScope, node, deep));
    };
  }
  return root;
};
`;
}

function viteConfigSource(className) {
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['test/unit/**/*.test.js'],
    setupFiles: ['test/unit/setup.js'],
    alias: { '@webcomponents/scoped-custom-element-registry': fileURLToPath(new URL('./test/unit/scoped-registry-polyfill.js', import.meta.url)) },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'test/coverage',
      include: ['src/${className}.js'],
      thresholds: {
        'src/${className}.js': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100
        }
      }
    }
  }
});
`;
}

function e2ePlan(name) {
  return ScaffoldPlan.empty()
    .addFile('playwright.config.js', `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: process.env.ACADEMY_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.ACADEMY_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}
  },
  webServer: { command: 'cells component:dev --host 127.0.0.1 --port 4173 --strictPort --no-open', url: 'http://127.0.0.1:4173', reuseExistingServer: false }
});
`)
    .addFile('e2e/' + name + '.spec.js', `import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('runs the generated localized component demo', async ({ page }) => {
  await page.goto('/');
  const component = page.locator('${name}');
  await expect(component).toBeVisible();
  await expect(component.getByText('${name.replace(/-/g, ' ')} ready')).toBeVisible();
  await page.getByRole('button', { name: 'Spanish' }).click();
  await expect(page.locator('html[lang="es"]')).toBeVisible();
  await expect(component.getByText('${name.replace(/-/g, ' ')} listo')).toBeVisible();
  await component.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('[data-event]')).toHaveText('Evento: ${name}-continue');

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});
`);
}

function customElementsManifestSource(name, className) {
  return stableJson({
    schemaVersion: '1.0.0',
    readme: 'README.md',
    modules: [{
      kind: 'javascript-module',
      path: `src/${className}.js`,
      declarations: [{
        kind: 'class',
        name: className,
        description: 'Academy teaching adapter for independent Cells-style component composition.',
        customElement: true,
        tagName: name,
        events: [{
          name: `${name}-continue`,
          type: { text: 'CustomEvent<{ component: string }>' },
          description: 'Emitted when the learner activates the continuation control.'
        }]
      }],
      exports: [{
        kind: 'js',
        name: className,
        declaration: { name: className, module: `src/${className}.js` }
      }]
    }]
  });
}

export function createComponentPayload(input = {}) {
  const { name, e2e } = assertComponentOptions(input);
  const className = componentClassName(name);
  const keys = messageKeys(name);
  const locales = componentCatalogs(name, keys);
  let plan = ScaffoldPlan.empty()
    .addDirectory('test/coverage')
    .addDependency('eslint', '9.39.4', 'dev')
    .addFile('index.html', rootIndexSource())
    .addFile('index.js', `export { ${className} } from './src/${className}.js';\n`)
    .addFile(`${name}.js`, entrypointSource(name, className))
    .addFile(`src/${className}.js`, componentSource(name, className, keys))
    .addFile(`src/${name}.scss`, scssSource())
    .addFile(`src/${name}.css.js`, stylesSource())
    .addFile('custom-elements.json', customElementsManifestSource(name, className))
    .addFile('demo/basic.html', basicDemoSource())
    .addFile('demo/demo-build.js', demoBuildSource())
    .addFile('demo/index.html', demoIndexSource())
    .addFile('demo/demo.js', demoSource(name, keys))
    .addFile(`demo/locales/locales.json`, stableJson(locales))
    .addFile(`test/unit/${name}.test.js`, unitTestSource(name, className))
    .addFile(`test/unit/${name}-accessibility.test.js`, accessibilityTestSource(name))
    .addFile('test/unit/locales/locales.json', stableJson(locales))
    .addFile('test/unit/scoped-registry-polyfill.js', '// Happy DOM uses the scoped-element bridge from setup.js instead of the browser polyfill.\nexport {};\n')
    .addFile('test/unit/setup.js', testSetupSource())
    .addFile('vite.config.js', viteConfigSource(className))
    .addFile('locales/locales.json', stableJson(locales));
  if (e2e) {
    plan = plan.merge(e2ePlan(name));
  }
  return plan;
}
