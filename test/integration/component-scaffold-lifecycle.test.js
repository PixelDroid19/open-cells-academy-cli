import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

function metadata(files) {
  return JSON.parse(files.get('package.json'));
}

function localeCatalogs(files) {
  return [
    'locales/locales.json',
    'demo/locales/locales.json',
    'test/unit/locales/locales.json'
  ].map(path => JSON.parse(files.get(path)));
}

async function writeProjectFile(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function materializeEntrypoint(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'academy-component-entrypoint-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  for (const [filePath, content] of files) {
    if (typeof content === 'string') {
      await writeProjectFile(root, filePath, content);
    }
  }
  await writeProjectFile(root, 'node_modules/lit/package.json', '{"name":"lit","type":"module","exports":"./index.js"}\n');
  await writeProjectFile(root, 'node_modules/lit/index.js', 'export class LitElement {}\nexport function html(strings, ...values) { return { strings, values }; }\nexport function css(strings, ...values) { return { strings, values }; }\n');
  await writeProjectFile(root, 'node_modules/@open-wc/scoped-elements/package.json', '{"name":"@open-wc/scoped-elements","type":"module","exports":{"./lit-element.js":"./lit-element.js"}}\n');
  await writeProjectFile(root, 'node_modules/@open-wc/scoped-elements/lit-element.js', 'export const ScopedElementsMixin = Base => Base;\n');
  await writeProjectFile(root, 'node_modules/@webcomponents/scoped-custom-element-registry/package.json', '{"name":"@webcomponents/scoped-custom-element-registry","type":"module","exports":"./index.js"}\n');
  await writeProjectFile(root, 'node_modules/@webcomponents/scoped-custom-element-registry/index.js', "globalThis.__academyEntrypointTrace.push('polyfill');\n");
  return root;
}

async function materializeViteConfigFromSpacePath(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'academy component vite-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeProjectFile(root, 'package.json', '{"type":"module"}\n');
  await writeProjectFile(root, 'vite.config.js', files.get('vite.config.js'));
  await writeProjectFile(root, 'test/unit/scoped-registry-polyfill.js', files.get('test/unit/scoped-registry-polyfill.js'));
  await writeProjectFile(root, 'node_modules/vite/package.json', '{"name":"vite","type":"module","exports":"./index.js"}\n');
  await writeProjectFile(root, 'node_modules/vite/index.js', 'export const defineConfig = config => config;\n');
  return root;
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  });
}

test('component entrypoint loads the scoped-registry polyfill before defining its host', async t => {
  const files = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  }));
  const root = await materializeEntrypoint(t, files);
  const trace = [];
  const registered = new Map();
  replaceGlobal(t, '__academyEntrypointTrace', trace);
  replaceGlobal(t, 'customElements', {
    get(name) {
      return registered.get(name);
    },
    define(name, constructor) {
      registered.set(name, constructor);
      trace.push(`define:${name}`);
    }
  });

  await import(`${pathToFileURL(path.join(root, 'academy-card.js')).href}?entrypoint`);

  assert.deepEqual(trace, ['polyfill', 'define:academy-card']);
  assert.ok(registered.has('academy-card'));
});

test('component generated Vite config resolves its scoped-registry alias from a space path', async t => {
  const files = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  }));
  const root = await materializeViteConfigFromSpacePath(t, files);
  const config = (await import(`${pathToFileURL(path.join(root, 'vite.config.js')).href}?space-path`)).default;
  const alias = config.test.alias['@webcomponents/scoped-custom-element-registry'];

  assert.match(root, / /);
  await access(alias);
  assert.equal(alias, path.join(root, 'test/unit/scoped-registry-polyfill.js'));
});

test('component Vitest keeps the real scoped-registry import behind a Happy DOM-only shim', () => {
  const files = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  }));

  assert.match(files.get('academy-card.js'), /^import '@webcomponents\/scoped-custom-element-registry';/);
  assert.match(files.get('vite.config.js'), /alias: \{/);
  assert.match(files.get('vite.config.js'), /import \{ fileURLToPath \} from 'node:url';/);
  assert.match(files.get('vite.config.js'), /'@webcomponents\/scoped-custom-element-registry': fileURLToPath\(new URL\('\.\/test\/unit\/scoped-registry-polyfill\.js', import\.meta\.url\)\)/);
  assert.doesNotMatch(files.get('vite.config.js'), /scoped-registry-polyfill\.js', import\.meta\.url\)\.pathname/);
  assert.match(files.get('test/unit/scoped-registry-polyfill.js'), /Happy DOM/);
});

test('component recipe publishes component-only guidance and a source-specific coverage policy', () => {
  const component = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  }));
  const app = fileMap(composeRecipe('blank', { kind: 'app', name: 'academy-app', cellsVersion: '4' }));
  const manifest = metadata(component);
  const readme = component.get('README.md');
  const config = component.get('vite.config.js');

  assert.match(readme, /WidgetMixin\(ScopedElementsMixin\(LitElement\)\)/);
  assert.match(readme, /static get scopedElements\(\)/);
  assert.match(readme, /this\.t\(/);
  assert.match(readme, /this\.emitEvent\(/);
  assert.match(readme, /locales\/locales\.json/);
  assert.match(readme, /demo\/locales\/locales\.json/);
  assert.match(readme, /test\/unit\/locales\/locales\.json/);
  assert.match(readme, /cells component:test --coverage/);
  assert.doesNotMatch(readme, /@open-cells\/core|Academy channels|browser facade/i);
  assert.match(app.get('README.md'), /@open-cells\/core@1\.2\.1/);
  assert.equal(manifest.devDependencies['@vitest/coverage-v8'], '3.2.4');
  assert.match(config, /coverage: \{/);
  assert.match(config, /provider: 'v8'/);
  assert.match(config, /reporter: \['text', 'lcov'\]/);
  assert.match(config, /reportsDirectory: 'test\/coverage'/);
  assert.match(config, /include: \['src\/AcademyCard\.js'\]/);
  assert.match(config, /'src\/AcademyCard\.js': \{/);
  assert.match(config, /statements: 100/);
  assert.match(config, /branches: 100/);
  assert.match(config, /functions: 100/);
  assert.match(config, /lines: 100/);
});

test('component demo publishes the selected document language and E2E asserts Spanish document state', () => {
  const files = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy',
    e2e: true
  }));
  const demo = files.get('demo/demo.js');
  const e2e = files.get('e2e/academy-card.spec.js');

  assert.match(demo, /document\.documentElement\.lang = 'en';/);
  assert.match(demo, /async function setLanguage\(language\) \{[\s\S]*document\.documentElement\.lang = language;/);
  assert.match(e2e, /html\[lang="es"\]/);
});

test('component recipe generates an independent scoped educational component with deterministic localizations', () => {
  const files = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  }));
  const manifest = metadata(files);
  const component = files.get('src/AcademyCard.js');
  const demo = files.get('demo/demo.js');
  const unitTest = files.get('test/unit/academy-card.test.js');

  for (const required of [
    'academy-card.js',
    'index.js',
    'src/AcademyCard.js',
    'src/academy-card.styles.js',
    'demo/index.html',
    'demo/demo.js',
    'demo/locales/locales.json',
    'test/unit/academy-card.test.js',
    'test/unit/academy-card-accessibility.test.js',
    'test/unit/locales/locales.json',
    'test/unit/setup.js',
    'vite.config.js',
    'locales/locales.json'
  ]) {
    assert.equal(files.has(required), true, `${required} is missing`);
  }

  assert.equal(manifest.name, 'academy-card');
  assert.equal(manifest.scripts.dev, 'vite');
  assert.equal(manifest.scripts.build, 'vite build');
  assert.equal(manifest.scripts.test, 'vitest run test/unit');
  assert.equal(manifest.scripts['test:a11y'], 'vitest run test/unit/academy-card-accessibility.test.js');
  assert.equal(manifest.scripts.e2e, undefined);
  assert.equal(manifest.dependencies.lit, '3.3.3');
  assert.equal(manifest.dependencies['@open-wc/scoped-elements'], '3.0.10');
  assert.equal(manifest.devDependencies['happy-dom'], '20.11.2');
  assert.equal(manifest.devDependencies.vite, '7.3.6');

  assert.match(component, /import \{ ScopedElementsMixin \} from '@open-wc\/scoped-elements\/lit-element\.js';/);
  assert.match(component, /import \{ WidgetMixin as widgetMixin \} from '\.\/mixins\/WidgetMixin\.js';/);
  assert.match(component, /import \{ AcademyTypeText \} from '\.\/components\/AcademyTypeText\.js';/);
  assert.match(component, /import \{ AcademyButtonDefault \} from '\.\/components\/AcademyButtonDefault\.js';/);
  assert.match(component, /extends widgetMixin\(ScopedElementsMixin\(LitElement\)\)/);
  assert.match(component, /static get scopedElements\(\)/);
  assert.match(component, /\.\.\.super\.scopedElements/);
  assert.match(component, /'academy-type-text': AcademyTypeText/);
  assert.match(component, /'academy-button-default': AcademyButtonDefault/);
  assert.match(component, /this\.t\(["']academy-card\.heading["']\)/);
  assert.match(component, /this\.t\(["']academy-card\.continue["']\)/);
  assert.match(component, /this\.emitEvent\('continue', \{ component: "academy-card" \}\)/);
  assert.match(component, /<academy-type-text/);
  assert.match(component, /<academy-button-default/);
  assert.doesNotMatch(component, /<h[1-6]\b/);
  assert.doesNotMatch(component, /<button\b/);
  assert.doesNotMatch(files.get('academy-card.js'), /customElements\.define\('academy-(?:type-text|button-default)'/);

  const [rootCatalog, demoCatalog, testCatalog] = localeCatalogs(files);
  assert.deepEqual(demoCatalog, rootCatalog);
  assert.deepEqual(testCatalog, rootCatalog);
  assert.deepEqual(Object.keys(rootCatalog.en), Object.keys(rootCatalog.es));
  for (const catalog of Object.values(rootCatalog)) {
    for (const translation of Object.values(catalog)) {
      assert.equal(typeof translation, 'string');
      assert.notEqual(translation.length, 0);
    }
  }

  assert.match(demo, /installIntlMsg/);
  assert.match(demo, /intlMsg\.lang = 'en';/);
  assert.match(demo, /intlMsg\.localesHost = new URL\('\.\/locales\/locales\.json', import\.meta\.url\)\.href;/);
  assert.match(demo, /await intlMsg\.loadUrlResourcesComplete;/);
  assert.match(demo, /await import\('\.\.\/academy-card\.js'\);/);
  assert.match(demo, /intlMsg\.t\(["']academy-card\.demo\.title["']\)/);
  assert.match(demo, /academy-card-continue/);
  assert.match(unitTest, /forTesting: true/);
  assert.match(unitTest, /await intlMsg\.loadUrlResourcesComplete;/);
  assert.match(unitTest, /intlMsg\.lang = 'es';/);
  assert.match(unitTest, /AcademyTypeText/);
  assert.match(unitTest, /AcademyButtonDefault/);
  assert.match(unitTest, /academy-card-continue/);
  assert.match(files.get('test/unit/academy-card-accessibility.test.js'), /document\.createElement\('main'\)/);
  assert.match(files.get('test/unit/setup.js'), /globalThis\.CustomElementRegistry/);
  assert.match(files.get('test/unit/setup.js'), /academy-test-scoped-/);
  assert.match(files.get('vite.config.js'), /setupFiles: \['test\/unit\/setup\.js'\]/);
  assert.match(files.get('vite.config.js'), /include: \['test\/unit\/\*\*\/\*\.test\.js'\]/);

  for (const source of files.values()) {
    if (typeof source === 'string') {
      assert.doesNotMatch(source, /https?:\/\/[^\s/@:]+:[^\s/@]+@/i);
    }
  }
});

test('component E2E is conditional and exercises localized component events', () => {
  const plain = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy',
    e2e: false
  }));
  const e2e = fileMap(composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy',
    e2e: true
  }));
  const plainMetadata = metadata(plain);
  const e2eMetadata = metadata(e2e);

  assert.equal(plain.has('playwright.config.js'), false);
  assert.equal(plain.has('e2e/academy-card.spec.js'), false);
  assert.equal(plainMetadata.devDependencies['@playwright/test'], undefined);
  assert.equal(e2e.has('playwright.config.js'), true);
  assert.equal(e2e.has('e2e/academy-card.spec.js'), true);
  assert.equal(e2eMetadata.scripts.e2e, 'playwright test');
  assert.equal(e2eMetadata.devDependencies['@playwright/test'], '^1.50.0');
  assert.equal(e2eMetadata.devDependencies['@axe-core/playwright'], '^4.10.0');
  assert.match(e2e.get('playwright.config.js'), /npm run dev -- --host 127\.0\.0\.1 --port 4173 --strictPort/);
  assert.match(e2e.get('e2e/academy-card.spec.js'), /page\.goto\('\/'\)/);
  assert.match(e2e.get('e2e/academy-card.spec.js'), /academy-card-continue/);
  assert.match(e2e.get('e2e/academy-card.spec.js'), /Spanish/);
  assert.match(e2e.get('e2e/academy-card.spec.js'), /academy card listo/);
});
