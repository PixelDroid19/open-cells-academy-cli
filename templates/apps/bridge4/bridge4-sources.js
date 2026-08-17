const PROFILE_TITLES = Object.freeze({
  blank: Object.freeze({ en: 'Open Cells learning starter', es: 'Inicio de aprendizaje Open Cells' }),
  'web-app': Object.freeze({ en: 'Open Cells learning catalog', es: 'Catálogo de aprendizaje Open Cells' }),
  'web-mobile-app': Object.freeze({ en: 'Open Cells mobile learning', es: 'Aprendizaje móvil Open Cells' }),
  'academy-app': Object.freeze({ en: 'Open Cells learning studio', es: 'Estudio de aprendizaje Open Cells' })
});

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function profileTitle(profile) {
  return PROFILE_TITLES[profile];
}

function configSource(profile, name, production) {
  const title = profileTitle(profile);
  return `const appConfig = ${JSON.stringify({
    cells_properties: {
      initialTemplate: 'catalog'
    },
    app_properties: {
      app: {
        name,
        title: title.en,
        description: 'A local Open Cells learning application.',
        version: '0.0.0'
      }
    },
    server: {
      host: '127.0.0.1',
      port: 8001,
      strictPort: false,
      open: false
    },
    build: {
      target: 'es2022',
      sourcemap: !production
    },
    locales: {
      source: 'app/locales-app/locales.json'
    }
  }, null, 2)};

export default appConfig;
`;
}

function localeCatalogSource(profile) {
  const title = profileTitle(profile);
  return stableJson({
    en: {
      'app.title': title.en,
      'catalog.title': 'Learning catalog',
      'catalog.description': 'Choose a local lesson to practice named routes, channels, and data states.',
      'catalog.lesson.title': 'Bridge fundamentals',
      'catalog.lesson.description': 'Open the lesson with a named route and an object parameter.',
      'catalog.openLesson': 'Open lesson',
      'catalog.progress': 'Catalog progress published for {lessonId}.',
      'lesson.title': 'Lesson: {lessonId}',
      'lesson.description': 'The lesson receives route parameters and the latest catalog progress.',
      'lesson.progress': 'Latest progress: {lessonId}.',
      'lesson.state.loading': 'Loading local lesson data.',
      'lesson.state.success': 'Local lesson data is ready.',
      'lesson.state.error': 'Local lesson data is unavailable.',
      'lesson.state.cancelled': 'Local lesson request was cancelled.',
      'fixture.lesson.introduction': 'This local fixture explains Bridge routes and page lifecycle hooks.',
      'fixture.lesson.notFound': 'This local fixture keeps the requested lesson available for practice.',
      'language.en': 'English',
      'language.es': 'Spanish'
    },
    es: {
      'app.title': title.es,
      'catalog.title': 'Catálogo de aprendizaje',
      'catalog.description': 'Elige una lección local para practicar rutas con nombre, canales y estados de datos.',
      'catalog.lesson.title': 'Fundamentos de Bridge',
      'catalog.lesson.description': 'Abre la lección con una ruta con nombre y un parámetro de objeto.',
      'catalog.openLesson': 'Abrir lección',
      'catalog.progress': 'Progreso del catálogo publicado para {lessonId}.',
      'lesson.title': 'Lección: {lessonId}',
      'lesson.description': 'La lección recibe parámetros de ruta y el progreso más reciente del catálogo.',
      'lesson.progress': 'Progreso más reciente: {lessonId}.',
      'lesson.state.loading': 'Cargando datos locales de la lección.',
      'lesson.state.success': 'Los datos locales de la lección están listos.',
      'lesson.state.error': 'Los datos locales de la lección no están disponibles.',
      'lesson.state.cancelled': 'La solicitud local de la lección fue cancelada.',
      'fixture.lesson.introduction': 'Este fixture local explica las rutas de Bridge y los hooks del ciclo de vida de página.',
      'fixture.lesson.notFound': 'Este fixture local mantiene disponible la lección solicitada para practicar.',
      'language.en': 'Inglés',
      'language.es': 'Español'
    }
  });
}

function localizationSource() {
  return `import catalogs from '../locales-app/locales.json';

export const languages = Object.freeze(['en', 'es']);
let activeLanguage = 'en';

export function currentLanguage() {
  return activeLanguage;
}

export function setLanguage(language) {
  if (!languages.includes(language)) throw new TypeError('Unsupported language');
  activeLanguage = language;
  document.documentElement.lang = language;
  document.title = t('app.title');
  window.dispatchEvent(new CustomEvent('academy-language-change', { detail: { language } }));
}

export function t(key, language = activeLanguage, params = {}) {
  const message = catalogs[language]?.[key];
  if (typeof message !== 'string') throw new TypeError('Missing locale message');
  return message.replace(/\\{([A-Za-z0-9_]+)\\}/g, (_, name) => String(params[name] ?? '{' + name + '}'));
}
`;
}

function channelContractSource() {
  return `export const ACADEMY_PROGRESS_CHANNEL = 'academy-progress';

export function createProgress(lessonId) {
  if (typeof lessonId !== 'string' || lessonId.length === 0) throw new TypeError('lessonId must be a non-empty string');
  return Object.freeze({ lessonId, status: 'opened' });
}
`;
}

function appRoutesSource() {
  return `const routes = Object.freeze([
  Object.freeze({
    path: '/',
    name: 'catalog',
    component: 'catalog-page',
    async action() {
      await import('../pages/catalog-page/catalog-page.js');
    }
  }),
  Object.freeze({
    path: '/lesson/:lessonId',
    name: 'lesson',
    component: 'lesson-page',
    async action() {
      await import('../pages/lesson-page/lesson-page.js');
    }
  })
]);

export { routes };
`;
}

function appSource() {
  return `import { startBridge } from '@cells/cells-bridge';
import appConfig from '../config/dev.js';
import { routes } from './app-routes.js';
import './lit-initial-components.js';

startBridge({
  routes,
  mainNode: 'app__content',
  ...appConfig.cells_properties,
  appConfig: appConfig.app_properties
});
`;
}

function appModuleSource() {
  return `import '../styles/main.scss';
import './lit-components.js';
import './app.js';
`;
}

function initialComponentsSource() {
  return `import './lit-components.js';
`;
}

function litComponentsSource() {
  return `import '../tpls/catalog-page-template.js';
import '../tpls/lesson-page-template.js';
import '../data-managers/lesson-data-manager.js';
`;
}

function catalogTemplateSource() {
  return `import { LitElement, html } from 'lit';
import { t } from '../scripts/localization.js';

export class CatalogPageTemplate extends LitElement {
  static properties = {
    language: { type: String },
    lessonId: { type: String }
  };

  constructor() {
    super();
    this.language = 'en';
    this.lessonId = 'introduction';
  }

  selectLesson() {
    this.dispatchEvent(new CustomEvent('academy-catalog-select', {
      bubbles: true,
      composed: true,
      detail: { lessonId: this.lessonId }
    }));
  }

  render() {
    return html\`<section aria-labelledby="catalog-title">
      <h1 id="catalog-title">\${t('catalog.title', this.language)}</h1>
      <p>\${t('catalog.description', this.language)}</p>
      <article>
        <h2>\${t('catalog.lesson.title', this.language)}</h2>
        <p>\${t('catalog.lesson.description', this.language)}</p>
        <button type="button" @click=\${this.selectLesson}>\${t('catalog.openLesson', this.language)}</button>
      </article>
    </section>\`;
  }
}

if (customElements.get('catalog-page-template') === undefined) {
  customElements.define('catalog-page-template', CatalogPageTemplate);
}
`;
}

function lessonTemplateSource() {
  return `import { LitElement, html } from 'lit';
import { t } from '../scripts/localization.js';

export class LessonPageTemplate extends LitElement {
  static properties = {
    dataState: { type: Object },
    language: { type: String },
    lessonId: { type: String },
    progress: { type: Object }
  };

  constructor() {
    super();
    this.dataState = Object.freeze({ status: 'loading' });
    this.language = 'en';
    this.lessonId = 'introduction';
    this.progress = undefined;
  }

  render() {
    const status = this.dataState?.status ?? 'loading';
    const progressId = this.progress?.lessonId ?? this.lessonId;
    const messageKey = this.dataState?.data?.messageKey;
    return html\`<section aria-labelledby="lesson-title">
      <h1 id="lesson-title">\${t('lesson.title', this.language, { lessonId: this.lessonId })}</h1>
      <p>\${t('lesson.description', this.language)}</p>
      <output aria-live="polite">\${t('lesson.progress', this.language, { lessonId: progressId })}</output>
      <p data-state=\${status}>\${t('lesson.state.' + status, this.language)}</p>
      \${messageKey === undefined ? '' : html\`<p>\${t(messageKey, this.language)}</p>\`}
      <slot name="data-manager"></slot>
    </section>\`;
  }
}

if (customElements.get('lesson-page-template') === undefined) {
  customElements.define('lesson-page-template', LessonPageTemplate);
}
`;
}

function catalogPageSource() {
  return `import { CellsPageMixin } from '@cells/cells-page-mixin';
import { LitElement, html } from 'lit';
import { ACADEMY_PROGRESS_CHANNEL, createProgress } from '../../scripts/channels.js';
import { currentLanguage } from '../../scripts/localization.js';
import '../../tpls/catalog-page-template.js';

export class CatalogPage extends CellsPageMixin(LitElement) {
  static get is() {
    return 'catalog-page';
  }

  static properties = {
    language: { state: true },
    lessonId: { state: true }
  };

  constructor() {
    super();
    this.language = currentLanguage();
    this.lessonId = 'introduction';
    this.onLanguageChange = event => {
      this.language = event.detail.language;
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('academy-language-change', this.onLanguageChange);
  }

  disconnectedCallback() {
    window.removeEventListener('academy-language-change', this.onLanguageChange);
    super.disconnectedCallback();
  }

  onPageEnter() {
    this.publish(ACADEMY_PROGRESS_CHANNEL, createProgress(this.lessonId));
  }

  selectLesson(event) {
    const lessonId = event.detail?.lessonId;
    const progress = createProgress(lessonId);
    this.lessonId = lessonId;
    this.publish(ACADEMY_PROGRESS_CHANNEL, progress);
    this.navigate('lesson', { lessonId });
  }

  render() {
    return html\`<catalog-page-template
      .language=\${this.language}
      .lessonId=\${this.lessonId}
      @academy-catalog-select=\${this.selectLesson}
    ></catalog-page-template>\`;
  }
}

if (customElements.get(CatalogPage.is) === undefined) {
  customElements.define(CatalogPage.is, CatalogPage);
}
`;
}

function lessonDataManagerSource() {
  return `import { LitElement, html } from 'lit';

const lessonFixtures = Object.freeze({
  introduction: Object.freeze({
    lessonId: 'introduction',
    messageKey: 'fixture.lesson.introduction'
  })
});

export class LessonDataManager extends LitElement {
  static get is() {
    return 'lesson-data-manager';
  }

  static properties = {
    state: { type: Object }
  };

  constructor() {
    super();
    this.state = Object.freeze({ status: 'idle' });
    this.activeRequest = undefined;
  }

  render() {
    return html\`\`;
  }

  transition(status, detail) {
    this.state = Object.freeze({ status, ...detail });
    this.dispatchEvent(new CustomEvent('lesson-data-' + status, {
      bubbles: true,
      composed: true,
      detail: this.state
    }));
    return this.state;
  }

  cancel(reason = 'cancelled') {
    const request = this.activeRequest;
    if (request === undefined || request.settled) return false;
    request.settled = true;
    request.controller.abort();
    this.activeRequest = undefined;
    this.transition('cancelled', { reason });
    return true;
  }

  async load({ lessonId = 'introduction', mode = 'success' } = {}) {
    this.cancel('superseded');
    const request = { controller: new AbortController(), settled: false };
    this.activeRequest = request;
    this.transition('loading', { lessonId });
    await Promise.resolve();
    if (request.settled || request.controller.signal.aborted || this.activeRequest !== request) {
      return Object.freeze({ status: 'cancelled', lessonId });
    }
    request.settled = true;
    this.activeRequest = undefined;
    if (mode === 'error') {
      return this.transition('error', { code: 'LOCAL_FIXTURE_UNAVAILABLE', lessonId });
    }
    if (mode !== 'success') throw new TypeError('Unsupported local fixture mode');
    const data = lessonFixtures[lessonId] ?? Object.freeze({ lessonId, messageKey: 'fixture.lesson.notFound' });
    return this.transition('success', { data, lessonId });
  }
}

if (customElements.get(LessonDataManager.is) === undefined) {
  customElements.define(LessonDataManager.is, LessonDataManager);
}
`;
}

function lessonPageSource() {
  return `import { CellsPageMixin } from '@cells/cells-page-mixin';
import { LitElement, html } from 'lit';
import { ACADEMY_PROGRESS_CHANNEL } from '../../scripts/channels.js';
import { currentLanguage } from '../../scripts/localization.js';
import '../../data-managers/lesson-data-manager.js';
import '../../tpls/lesson-page-template.js';

export class LessonPage extends CellsPageMixin(LitElement) {
  static get is() {
    return 'lesson-page';
  }

  static properties = {
    dataState: { state: true },
    language: { state: true },
    lessonId: { state: true },
    progress: { state: true }
  };

  constructor() {
    super();
    this.dataState = Object.freeze({ status: 'loading' });
    this.language = currentLanguage();
    this.lessonId = 'introduction';
    this.progress = undefined;
    this.receiveProgress = progress => {
      this.progress = progress;
    };
    this.onLanguageChange = event => {
      this.language = event.detail.language;
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('academy-language-change', this.onLanguageChange);
  }

  disconnectedCallback() {
    window.removeEventListener('academy-language-change', this.onLanguageChange);
    super.disconnectedCallback();
  }

  async onPageEnter() {
    this.lessonId = this.params?.lessonId ?? 'introduction';
    this.subscribe(ACADEMY_PROGRESS_CHANNEL, this.receiveProgress);
    await this.updateComplete;
    this.dataManager()?.load({ lessonId: this.lessonId });
  }

  onPageLeave() {
    this.unsubscribe(ACADEMY_PROGRESS_CHANNEL);
    this.dataManager()?.cancel('page-left');
  }

  dataManager() {
    return this.renderRoot?.querySelector('lesson-data-manager');
  }

  updateDataState(event) {
    this.dataState = event.detail;
  }

  render() {
    return html\`<lesson-page-template
      .dataState=\${this.dataState}
      .language=\${this.language}
      .lessonId=\${this.lessonId}
      .progress=\${this.progress}
    >
      <lesson-data-manager
        slot="data-manager"
        @lesson-data-loading=\${this.updateDataState}
        @lesson-data-success=\${this.updateDataState}
        @lesson-data-error=\${this.updateDataState}
        @lesson-data-cancelled=\${this.updateDataState}
      ></lesson-data-manager>
    </lesson-page-template>\`;
  }
}

if (customElements.get(LessonPage.is) === undefined) {
  customElements.define(LessonPage.is, LessonPage);
}
`;
}

function indexTemplateSource() {
  return `<main id="app__content" aria-live="polite"></main>
<script type="module" src="scripts/app-module.js"></script>
`;
}

function indexSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Open Cells learning app</title>
  </head>
  <body>
    <main id="app__content" aria-live="polite"></main>
    <script type="module" src="/app/scripts/app-module.js"></script>
  </body>
</html>
`;
}

function stylesSource() {
  return `:root {
  color: #172554;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
  background: #f8fafc;
}

catalog-page-template,
lesson-page-template {
  display: block;
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem;
}

article {
  border: 1px solid #cbd5e1;
  border-radius: .5rem;
  padding: 1rem;
  background: white;
}

button {
  border: 0;
  border-radius: .25rem;
  padding: .65rem 1rem;
  color: white;
  background: #1d4ed8;
  cursor: pointer;
}
`;
}

function viteConfigSource() {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.js']
  }
});
`;
}

function playwrightConfigSource() {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4173'
  }
});
`;
}

function e2eSpecSource() {
  return `import { expect, test } from '@playwright/test';

test('opens a lesson through the generated named route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Learning catalog' })).toBeVisible();
  await page.getByRole('button', { name: 'Open lesson' }).click();
  await expect(page).toHaveURL(/lesson\\/introduction/);
});
`;
}

function sourceValidationSource() {
  return `import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(candidate));
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(candidate);
  }
  return files;
}

const files = await sourceFiles(fileURLToPath(new URL('../app/', import.meta.url)));
for (const file of files) await readFile(file, 'utf8');
if (files.length === 0) throw new Error('Expected Bridge 4 application sources.');
`;
}

function localeValidationSource() {
  return `import { readFile } from 'node:fs/promises';

const catalogs = JSON.parse(await readFile(new URL('../app/locales-app/locales.json', import.meta.url), 'utf8'));
const languages = Object.keys(catalogs).sort();
if (languages.join(',') !== 'en,es') throw new Error('Expected English and Spanish catalogs.');
const keys = Object.keys(catalogs.en).sort();
if (keys.length === 0 || JSON.stringify(keys) !== JSON.stringify(Object.keys(catalogs.es).sort())) {
  throw new Error('Locale keys are not in parity.');
}
for (const language of languages) {
  for (const value of Object.values(catalogs[language])) {
    if (typeof value !== 'string' || value.length === 0) throw new Error('Locale message is empty.');
  }
}
`;
}

function readmeSource() {
  return `# Open Cells Bridge 4 learning app

This generated application uses Bridge 4, Lit 3, named routes, and page lifecycle hooks. Start it with \`cells app:dev -c dev.js\`, build it with \`cells app:build -c prod.js\`, and preview it with \`cells app:preview -c prod.js\`.

The catalog publishes the public \`academy-progress\` channel. The lesson consumes its latest value when it enters and unsubscribes when it leaves. Route parameters carry the selected lesson identifier, while the nonvisual data manager serves local fixture data only.

Run \`cells app:test\` for generated unit tests and \`cells app:locales\` to validate English and Spanish catalog parity.
`;
}

function routesTestSource() {
  return `import { describe, expect, it } from 'vitest';
import { routes } from '../../app/scripts/app-routes.js';

describe('Bridge 4 routes', () => {
  it('declares named catalog and lesson routes with a lesson parameter', () => {
    expect(routes.map(route => ({ name: route.name, path: route.path }))).toEqual([
      { name: 'catalog', path: '/' },
      { name: 'lesson', path: '/lesson/:lessonId' }
    ]);
    expect(Object.isFrozen(routes)).toBe(true);
    expect(routes.every(Object.isFrozen)).toBe(true);
  });

  it('imports the declared page implementation for every route', async () => {
    await Promise.all(routes.map(route => route.action()));
    expect(customElements.get('catalog-page')).toBeDefined();
    expect(customElements.get('lesson-page')).toBeDefined();
  });
});
`;
}

function channelsTestSource() {
  return `import { afterEach, describe, expect, it } from 'vitest';
import { CatalogPage } from '../../app/pages/catalog-page/catalog-page.js';
import { LessonPage } from '../../app/pages/lesson-page/lesson-page.js';
import { ACADEMY_PROGRESS_CHANNEL } from '../../app/scripts/channels.js';

class RetainedProgressChannel {
  constructor() {
    this.callback = undefined;
    this.value = undefined;
  }

  publish(value) {
    this.value = value;
    this.callback?.(value);
  }

  subscribe(channel, callback) {
    if (channel !== ACADEMY_PROGRESS_CHANNEL) throw new TypeError('Unexpected channel');
    this.callback = callback;
    if (this.value !== undefined) callback(this.value);
  }

  unsubscribe(channel) {
    if (channel !== ACADEMY_PROGRESS_CHANNEL) throw new TypeError('Unexpected channel');
    this.callback = undefined;
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Bridge 4 progress channel', () => {
  it('navigates from the catalog with an object route parameter', async () => {
    const page = document.createElement(CatalogPage.is);
    const navigations = [];
    page.publish = () => undefined;
    page.navigate = (name, params) => navigations.push({ name, params });
    document.body.append(page);
    await page.updateComplete;

    page.shadowRoot.querySelector('catalog-page-template').dispatchEvent(new CustomEvent('academy-catalog-select', {
      bubbles: true,
      composed: true,
      detail: { lessonId: 'introduction' }
    }));

    expect(navigations).toEqual([{ name: 'lesson', params: { lessonId: 'introduction' } }]);
  });

  it('delivers the latest progress on enter and stops delivery after leave', async () => {
    const channel = new RetainedProgressChannel();
    const page = document.createElement(LessonPage.is);
    page.params = { lessonId: 'introduction' };
    page.subscribe = channel.subscribe.bind(channel);
    page.unsubscribe = channel.unsubscribe.bind(channel);
    document.body.append(page);
    await page.updateComplete;
    channel.publish({ lessonId: 'introduction', status: 'opened' });

    await page.onPageEnter();
    expect(page.progress).toEqual({ lessonId: 'introduction', status: 'opened' });
    page.onPageLeave();
    channel.publish({ lessonId: 'another', status: 'opened' });

    expect(page.progress).toEqual({ lessonId: 'introduction', status: 'opened' });
  });
});
`;
}

function dataManagerTestSource() {
  return `import { afterEach, describe, expect, it } from 'vitest';
import { LessonDataManager } from '../../app/data-managers/lesson-data-manager.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('lesson data manager', () => {
  it('emits loading and success for a local fixture', async () => {
    const manager = document.createElement(LessonDataManager.is);
    const states = [];
    for (const type of ['lesson-data-loading', 'lesson-data-success']) {
      manager.addEventListener(type, event => states.push(event.detail.status));
    }
    document.body.append(manager);

    const result = await manager.load({ lessonId: 'introduction' });

    expect(states).toEqual(['loading', 'success']);
    expect(result).toMatchObject({ status: 'success', lessonId: 'introduction' });
  });

  it('emits an error state when the local fixture mode fails', async () => {
    const manager = document.createElement(LessonDataManager.is);
    const states = [];
    manager.addEventListener('lesson-data-error', event => states.push(event.detail.status));
    document.body.append(manager);

    const result = await manager.load({ lessonId: 'introduction', mode: 'error' });

    expect(states).toEqual(['error']);
    expect(result).toMatchObject({ status: 'error', code: 'LOCAL_FIXTURE_UNAVAILABLE' });
  });

  it('emits a cancelled state when a local fixture request is cancelled', async () => {
    const manager = document.createElement(LessonDataManager.is);
    const states = [];
    manager.addEventListener('lesson-data-cancelled', event => states.push(event.detail.status));
    document.body.append(manager);

    const pending = manager.load({ lessonId: 'introduction' });
    manager.cancel('test-cancel');
    const result = await pending;

    expect(states).toEqual(['cancelled']);
    expect(result).toMatchObject({ status: 'cancelled' });
  });
});
`;
}

function localesTestSource() {
  return `import { afterEach, describe, expect, it } from 'vitest';
import catalogs from '../../app/locales-app/locales.json';
import { CatalogPageTemplate } from '../../app/tpls/catalog-page-template.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('application locales', () => {
  it('keeps English and Spanish keys in parity', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.es).sort());
  });

  it('renders visible catalog strings through the selected language', async () => {
    const template = document.createElement('catalog-page-template');
    template.language = 'en';
    document.body.append(template);
    await template.updateComplete;
    expect(template.shadowRoot.textContent).toContain('Learning catalog');

    template.language = 'es';
    await template.updateComplete;
    expect(template.shadowRoot.textContent).toContain('Catálogo de aprendizaje');
    expect(template).toBeInstanceOf(CatalogPageTemplate);
  });
});
`;
}

export function createBridge4Sources(profile, name, { e2e = false } = {}) {
  const locales = localeCatalogSource(profile);
  const sources = {
    'README.md': readmeSource(),
    'index.html': indexSource(),
    'vite.config.js': viteConfigSource(),
    'scripts/validate-locales.js': localeValidationSource(),
    'scripts/validate-source.js': sourceValidationSource(),
    'app/config/dev.js': configSource(profile, name, false),
    'app/config/prod.js': configSource(profile, name, true),
    'app/data-managers/lesson-data-manager.js': lessonDataManagerSource(),
    'app/locales-app/locales.json': locales,
    'app/pages/catalog-page/catalog-page.js': catalogPageSource(),
    'app/pages/lesson-page/lesson-page.js': lessonPageSource(),
    'app/scripts/app.js': appSource(),
    'app/scripts/app-module.js': appModuleSource(),
    'app/scripts/app-routes.js': appRoutesSource(),
    'app/scripts/channels.js': channelContractSource(),
    'app/scripts/lit-components.js': litComponentsSource(),
    'app/scripts/lit-initial-components.js': initialComponentsSource(),
    'app/scripts/localization.js': localizationSource(),
    'app/styles/main.scss': stylesSource(),
    'app/tpls/catalog-page-template.js': catalogTemplateSource(),
    'app/tpls/index.tpl': indexTemplateSource(),
    'app/tpls/lesson-page-template.js': lessonTemplateSource(),
    'test/unit/channels.test.js': channelsTestSource(),
    'test/unit/data-manager.test.js': dataManagerTestSource(),
    'test/unit/locales.test.js': localesTestSource(),
    'test/unit/routes.test.js': routesTestSource(),
    'test/unit/dev/locales/locales.json': locales,
    'test/unit/prod/locales/locales.json': locales
  };
  if (e2e) {
    sources['e2e/bridge4-app.spec.js'] = e2eSpecSource();
    sources['playwright.config.js'] = playwrightConfigSource();
  }
  return Object.freeze(sources);
}
