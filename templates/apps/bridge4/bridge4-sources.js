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
      initialTemplate: 'catalog',
      locales: {
        enabledI18n: true,
        languages: ['en', 'es'],
        intlInputFileNames: ['locales'],
        intlFileName: 'locales',
        forTesting: true
      }
    },
    app_properties: {
      app: {
        name,
        title: title.en,
        description: 'A local Open Cells learning application.',
        version: '0.0.0',
        runtimeConfig: production ? 'open-cells-production' : 'open-cells-development'
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
      'catalog.lesson.title': 'Open Cells fundamentals',
      'catalog.lesson.description': 'Open the lesson with a named route and an object parameter.',
      'catalog.openLesson': 'Open lesson',
      'catalog.parts.title': 'What this starter demonstrates',
      'catalog.parts.routes': 'Named routes and URL parameters',
      'catalog.parts.pages': 'Page enter and leave lifecycle',
      'catalog.parts.channels': 'Retained publish and subscribe state',
      'catalog.parts.data': 'A cancellable local data manager',
      'catalog.parts.i18n': 'English and Spanish IntlMsg catalogs',
      'shell.home': 'Catalog',
      'shell.lesson': 'Lesson',
      'shell.language': 'Language',
      'catalog.progress': 'Catalog progress published for {lessonId}.',
      'lesson.title': 'Lesson: {lessonId}',
      'lesson.description': 'The lesson receives route parameters and the latest catalog progress.',
      'lesson.progress': 'Latest progress: {lessonId}.',
      'lesson.state.loading': 'Loading local lesson data.',
      'lesson.state.success': 'Local lesson data is ready.',
      'lesson.state.error': 'Local lesson data is unavailable.',
      'lesson.state.cancelled': 'Local lesson request was cancelled.',
      'fixture.lesson.introduction': 'This local fixture explains Open Cells routes and page lifecycle hooks.',
      'fixture.lesson.notFound': 'This local fixture keeps the requested lesson available for practice.',
      'language.switcher': 'Choose language',
      'language.en': 'English',
      'language.es': 'Spanish'
    },
    es: {
      'app.title': title.es,
      'catalog.title': 'Catálogo de aprendizaje',
      'catalog.description': 'Elige una lección local para practicar rutas con nombre, canales y estados de datos.',
      'catalog.lesson.title': 'Fundamentos de Open Cells',
      'catalog.lesson.description': 'Abre la lección con una ruta con nombre y un parámetro de objeto.',
      'catalog.openLesson': 'Abrir lección',
      'catalog.parts.title': 'Qué demuestra este starter',
      'catalog.parts.routes': 'Rutas con nombre y parámetros de URL',
      'catalog.parts.pages': 'Ciclo de vida de entrada y salida de página',
      'catalog.parts.channels': 'Estado retenido con publicar y suscribir',
      'catalog.parts.data': 'Un gestor de datos local cancelable',
      'catalog.parts.i18n': 'Catálogos IntlMsg en inglés y español',
      'shell.home': 'Catálogo',
      'shell.lesson': 'Lección',
      'shell.language': 'Idioma',
      'catalog.progress': 'Progreso del catálogo publicado para {lessonId}.',
      'lesson.title': 'Lección: {lessonId}',
      'lesson.description': 'La lección recibe parámetros de ruta y el progreso más reciente del catálogo.',
      'lesson.progress': 'Progreso más reciente: {lessonId}.',
      'lesson.state.loading': 'Cargando datos locales de la lección.',
      'lesson.state.success': 'Los datos locales de la lección están listos.',
      'lesson.state.error': 'Los datos locales de la lección no están disponibles.',
      'lesson.state.cancelled': 'La solicitud local de la lección fue cancelada.',
      'fixture.lesson.introduction': 'Este fixture local explica las rutas de Open Cells y los hooks del ciclo de vida de página.',
      'fixture.lesson.notFound': 'Este fixture local mantiene disponible la lección solicitada para practicar.',
      'language.switcher': 'Elegir idioma',
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
  return `const ROUTES = Object.freeze([
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

export { ROUTES };
export const routes = ROUTES;
`;
}

function appSource() {
  return `import { startApp } from '@open-cells/core';
import appConfig from 'virtual:open-cells-app-config';
import { ROUTES } from './app-routes.js';
import { setLanguage } from './localization.js';
import './lit-initial-components.js';

setLanguage('en');

startApp({
  routes: ROUTES,
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
  return `import '../tpls/academy-app-shell.js';
import '../tpls/catalog-page-template.js';
import '../tpls/lesson-page-template.js';
import '../data-managers/lesson-data-manager.js';
`;
}

function appShellSource() {
  return `import { LitElement, html } from 'lit';
import { currentLanguage, t } from '../scripts/localization.js';

export class AcademyAppShell extends LitElement {
  static properties = {
    language: { state: true }
  };

  constructor() {
    super();
    this.language = currentLanguage();
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

  render() {
    return html\`<header class="academy-shell-header">
      <a class="academy-shell-brand" href="/#!/" aria-label=\"Open Cells\">Open Cells</a>
      <nav aria-label=\"\${t('shell.home', this.language)}\">
        <a href="/#!/">\${t('shell.home', this.language)}</a>
        <a href="/#!/lesson/introduction">\${t('shell.lesson', this.language)}</a>
      </nav>
      <span class="academy-shell-language" role="status" aria-label=\"\${t('shell.language', this.language)}\">\${this.language}</span>
    </header><slot></slot>\`;
  }
}

if (customElements.get('academy-app-shell') === undefined) {
  customElements.define('academy-app-shell', AcademyAppShell);
}
`;
}

function catalogTemplateSource() {
  return `import { LitElement, css, html } from 'lit';
import { currentLanguage, setLanguage, t } from '../scripts/localization.js';

export class CatalogPageTemplate extends LitElement {
  static styles = css\`:host { display: block; } :host([state="inactive"]), :host([state="cached"]) { display: none; }\`;

  static properties = {
    language: { type: String },
    state: { type: String, reflect: true }
  };

  constructor() {
    super();
    this.language = currentLanguage();
    this.state = 'inactive';
    this.setAttribute('data-cells-type', 'template');
  }

  selectLanguage(event) {
    setLanguage(event.currentTarget.dataset.language);
    this.language = currentLanguage();
  }

  render() {
    return html\`<nav aria-label="\${t('language.switcher', this.language)}">
      <button type="button" data-language="en" @click=\${this.selectLanguage}>\${t('language.en', this.language)}</button>
      <button type="button" data-language="es" @click=\${this.selectLanguage}>\${t('language.es', this.language)}</button>
    </nav>
    <header><slot name="app-header"></slot></header>
    <section class="page-main"><slot name="app-main-content"></slot></section>
    <footer><slot name="app-footer"></slot></footer>\`;
  }
}

if (customElements.get('catalog-page-template') === undefined) {
  customElements.define('catalog-page-template', CatalogPageTemplate);
}
`;
}

function lessonTemplateSource() {
  return `import { LitElement, css, html } from 'lit';

export class LessonPageTemplate extends LitElement {
  static styles = css\`:host { display: block; } :host([state="inactive"]), :host([state="cached"]) { display: none; }\`;

  static properties = {
    state: { type: String, reflect: true }
  };

  constructor() {
    super();
    this.state = 'inactive';
    this.setAttribute('data-cells-type', 'template');
  }

  render() {
    return html\`<header><slot name="app-header"></slot></header>
    <section class="page-main"><slot name="app-main-content"></slot></section>
    <footer><slot name="app-footer"></slot></footer>\`;
  }
}

if (customElements.get('lesson-page-template') === undefined) {
  customElements.define('lesson-page-template', LessonPageTemplate);
}
`;
}

function catalogPageSource() {
  return `import { PageMixin } from '@open-cells/page-mixin';
import { LitElement, html } from 'lit';
import { ACADEMY_PROGRESS_CHANNEL, createProgress } from '../../scripts/channels.js';
import { currentLanguage, t } from '../../scripts/localization.js';
import '../../tpls/catalog-page-template.js';

export class CatalogPage extends PageMixin(LitElement) {
  static get is() {
    return 'catalog-page';
  }

  static properties = {
    language: { state: true },
    lessonId: { state: true },
    progress: { state: true }
  };

  constructor() {
    super();
    this.language = currentLanguage();
    this.lessonId = 'introduction';
    this.progress = undefined;
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
    this.progress = createProgress(this.lessonId);
    this.publish(ACADEMY_PROGRESS_CHANNEL, this.progress);
  }

  selectLesson() {
    const lessonId = this.lessonId;
    const progress = createProgress(lessonId);
    this.lessonId = lessonId;
    this.progress = progress;
    this.publish(ACADEMY_PROGRESS_CHANNEL, progress);
    this.navigate('lesson', { lessonId });
  }

  render() {
    return html\`<catalog-page-template
      data-cells-type="template"
      .language=\${this.language}
    >
      <section slot="app-main-content" aria-labelledby="catalog-title">
        <h1 id="catalog-title">\${t('catalog.title', this.language)}</h1>
        <p>\${t('catalog.description', this.language)}</p>
        <output data-channel-state aria-live="polite">\${t('catalog.progress', this.language, { lessonId: this.progress?.lessonId ?? this.lessonId })}</output>
        <section class="academy-learning-parts" aria-labelledby="learning-parts-title" data-learning-parts>
          <h2 id="learning-parts-title">\${t('catalog.parts.title', this.language)}</h2>
          <ul>
            <li data-learning-part="routes">\${t('catalog.parts.routes', this.language)}</li>
            <li data-learning-part="pages">\${t('catalog.parts.pages', this.language)}</li>
            <li data-learning-part="channels">\${t('catalog.parts.channels', this.language)}</li>
            <li data-learning-part="data">\${t('catalog.parts.data', this.language)}</li>
            <li data-learning-part="i18n">\${t('catalog.parts.i18n', this.language)}</li>
          </ul>
        </section>
        <article>
          <h2>\${t('catalog.lesson.title', this.language)}</h2>
          <p>\${t('catalog.lesson.description', this.language)}</p>
          <button type="button" @click=\${this.selectLesson}>\${t('catalog.openLesson', this.language)}</button>
        </article>
      </section>
    </catalog-page-template>\`;
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
    if (mode === 'delayed') {
      await new Promise(resolve => setTimeout(resolve, 25));
    } else {
      await Promise.resolve();
    }
    if (request.settled || request.controller.signal.aborted || this.activeRequest !== request) {
      return Object.freeze({ status: 'cancelled', lessonId });
    }
    request.settled = true;
    this.activeRequest = undefined;
    if (mode === 'error') {
      return this.transition('error', { code: 'LOCAL_FIXTURE_UNAVAILABLE', lessonId });
    }
    if (mode !== 'success' && mode !== 'delayed') throw new TypeError('Unsupported local fixture mode');
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
  return `import { PageMixin } from '@open-cells/page-mixin';
import { LitElement, html } from 'lit';
import { ACADEMY_PROGRESS_CHANNEL } from '../../scripts/channels.js';
import { currentLanguage, t } from '../../scripts/localization.js';
import '../../data-managers/lesson-data-manager.js';
import '../../tpls/lesson-page-template.js';

export class LessonPage extends PageMixin(LitElement) {
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
    const status = this.dataState?.status ?? 'loading';
    const progressId = this.progress?.lessonId ?? this.lessonId;
    const messageKey = this.dataState?.data?.messageKey;
    return html\`<lesson-page-template
      data-cells-type="template"
      .language=\${this.language}
    >
      <section slot="app-main-content" aria-labelledby="lesson-title">
        <h1 id="lesson-title">\${t('lesson.title', this.language, { lessonId: this.lessonId })}</h1>
        <p>\${t('lesson.description', this.language)}</p>
        <output aria-live="polite">\${t('lesson.progress', this.language, { lessonId: progressId })}</output>
        <p data-state=\${status}>\${t('lesson.state.' + status, this.language)}</p>
        \${messageKey === undefined ? '' : html\`<p>\${t(messageKey, this.language)}</p>\`}
        <lesson-data-manager
          @lesson-data-loading=\${this.updateDataState}
          @lesson-data-success=\${this.updateDataState}
          @lesson-data-error=\${this.updateDataState}
          @lesson-data-cancelled=\${this.updateDataState}
        ></lesson-data-manager>
      </section>
    </lesson-page-template>\`;
  }
}

if (customElements.get(LessonPage.is) === undefined) {
  customElements.define(LessonPage.is, LessonPage);
}
`;
}

function indexTemplateSource() {
  return `<academy-app-shell><main id="app__content" aria-live="polite"></main></academy-app-shell>
<script type="module" src="scripts/app-module.js"></script>
`;
}

function indexSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
  </head>
  <body>
    <academy-app-shell><main id="app__content" aria-live="polite"></main></academy-app-shell>
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

academy-app-shell { display: block; min-height: 100vh; }
.academy-shell-header { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: .85rem 1.25rem; color: white; background: #172554; }
.academy-shell-brand { color: inherit; font-weight: 700; text-decoration: none; }
.academy-shell-header nav { display: flex; gap: .75rem; }
.academy-shell-header nav a { color: inherit; text-decoration: none; }
.academy-shell-language { display: flex; gap: .35rem; margin-left: auto; }
.academy-shell-language button { color: #172554; background: white; padding: .35rem .55rem; }

catalog-page-template,
lesson-page-template {
  display: block;
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem;
}

catalog-page-template[state="cached"],
catalog-page-template[state="inactive"],
lesson-page-template[state="cached"],
lesson-page-template[state="inactive"] {
  display: none;
}

article {
  border: 1px solid #cbd5e1;
  border-radius: .5rem;
  padding: 1rem;
  background: white;
}

.academy-learning-parts { margin: 1.25rem 0; padding: 1rem; border: 1px solid #bfdbfe; border-radius: .5rem; background: #eff6ff; }
.academy-learning-parts ul { display: grid; gap: .45rem; margin: .5rem 0 0; padding-left: 1.25rem; }

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
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    fileParallelism: false,
    include: ['test/unit/**/*.test.js'],
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['@open-cells/core', '@open-cells/core-plugin', '@open-cells/page-mixin']
        }
      }
    },
    alias: {
      'virtual:open-cells-app-config': fileURLToPath(new URL('./app/config/dev.js', import.meta.url))
    }
  }
});
`;
}

function playwrightConfigSource() {
  return `import { defineConfig } from 'playwright/test';

const port = Number(process.env.OPEN_CELLS_E2E_PORT ?? '4173');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError('OPEN_CELLS_E2E_PORT must be a TCP port');
}
const address = 'http://127.0.0.1:' + String(port);

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: address,
    browserName: 'chromium',
    channel: process.env.OPEN_CELLS_PLAYWRIGHT_CHANNEL ?? 'chrome'
  },
  webServer: {
    command: 'cells app:dev -c dev.js --host 127.0.0.1 --port ' + String(port) + ' --strictPort --no-open',
    reuseExistingServer: false,
    url: address
  }
});
`;
}

function e2eSpecSource() {
  return `import AxeBuilder from '@axe-core/playwright';
import { expect, test } from 'playwright/test';

test('opens a lesson through the generated named route', async ({ page }) => {
  await page.goto('/');
  const catalog = page.locator('catalog-page');
  const lesson = page.locator('lesson-page');
  await expect(page.getByRole('heading', { name: 'Learning catalog' })).toBeVisible();
  await page.getByRole('button', { name: 'Open lesson' }).click();
  await expect(page).toHaveURL(/lesson\\/introduction/);
  await expect(page.getByRole('heading', { name: 'Lesson: introduction' })).toBeVisible();
  await expect(catalog).toBeHidden();
  await expect(lesson).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
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
if (files.length === 0) throw new Error('Expected Open Cells application sources.');
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
  return `# Open Cells learning app

This generated application uses the public Open Cells runtime, Lit 3, named routes, page lifecycle hooks, and a small app shell. Start it with \`cells app:dev -c dev.js\`, build it with \`cells app:build -c prod.js\`, and preview it with \`cells app:preview -c prod.js\`.

The first catalog page is intentionally a learning map: it makes routes, page enter/leave hooks, retained channels, a cancellable local data manager, and English/Spanish locale catalogs visible in the UI. The shell exposes Catalog, Lesson, and the active language; the page controls let learners switch English and Spanish. The lesson consumes the latest \`academy-progress\` value when it enters and unsubscribes when it leaves. Route parameters carry the selected lesson identifier, while the nonvisual data manager serves local fixture data only.

Run \`cells app:test\` for generated unit tests and \`cells app:locales\` to validate English and Spanish catalog parity.
`;
}

function routesTestSource() {
  return `import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../app/scripts/app-routes.js';

describe('Open Cells routes', () => {
  it('declares named catalog and lesson routes with a lesson parameter', () => {
    expect(ROUTES.map(route => ({ name: route.name, path: route.path }))).toEqual([
      { name: 'catalog', path: '/' },
      { name: 'lesson', path: '/lesson/:lessonId' }
    ]);
    expect(Object.isFrozen(ROUTES)).toBe(true);
    expect(ROUTES.every(Object.isFrozen)).toBe(true);
  });

  it('loads both pages through their lazy route actions', async () => {
    await Promise.all(ROUTES.map(route => route.action()));
    expect(customElements.get('catalog-page')).toBeDefined();
    expect(customElements.get('lesson-page')).toBeDefined();
  });
});
`;
}

function channelsTestSource() {
  return `import { describe, expect, it } from 'vitest';
import { ACADEMY_PROGRESS_CHANNEL, createProgress } from '../../app/scripts/channels.js';

describe('Open Cells progress channel', () => {
  it('creates an immutable public progress value', () => {
    const progress = createProgress('introduction');
    expect(ACADEMY_PROGRESS_CHANNEL).toBe('academy-progress');
    expect(progress).toEqual({ lessonId: 'introduction', status: 'opened' });
    expect(Object.isFrozen(progress)).toBe(true);
  });
});
`;
}

function runtimeTestSource() {
  return `import { describe, expect, it } from 'vitest';
import { getConfig, startApp } from '@open-cells/core';
import { CatalogPageTemplate } from '../../app/tpls/catalog-page-template.js';
import { ACADEMY_PROGRESS_CHANNEL, createProgress } from '../../app/scripts/channels.js';
import { t } from '../../app/scripts/localization.js';
import { ROUTES } from '../../app/scripts/app-routes.js';

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitFor(condition) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = condition();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the Open Cells runtime.');
}

function pageTemplate(page) {
  return page.shadowRoot?.querySelector('[data-cells-type="template"]');
}

describe('public Open Cells application runtime', () => {
  it('starts routes, delivers retained progress, cancels on leave, and changes visible language', async () => {
    const inactiveTemplate = new CatalogPageTemplate();
    document.body.append(inactiveTemplate);
    await inactiveTemplate.updateComplete;
    expect(inactiveTemplate.getAttribute('state')).toBe('inactive');
    inactiveTemplate.remove();

    const mainNode = document.createElement('main');
    mainNode.id = 'app__content';
    document.body.replaceChildren(mainNode);
    window.location.hash = '#!/';
    await Promise.all(ROUTES.map(route => route.action()));
    await import('../../app/scripts/app.js');

    const catalog = await waitFor(() => document.querySelector('catalog-page'));
    const catalogTemplate = await waitFor(() => pageTemplate(catalog)?.getAttribute('state') === 'active' && pageTemplate(catalog));
    expect(typeof startApp).toBe('function');
    expect(catalog.constructor.getPagePrivateChannel('catalog-page')).toBe('__oc_page_catalog');
    expect(typeof catalog.pluginCellsCoreAPI).toBe('function');
    expect(typeof catalog.publish).toBe('function');
    expect(typeof catalog.navigate).toBe('function');
    expect(getConfig()?.mainNode).toBe('app__content');
    expect(catalogTemplate.getAttribute('data-cells-type')).toBe('template');
    expect(catalogTemplate.getAttribute('state')).toBe('active');

    catalog.publish(ACADEMY_PROGRESS_CHANNEL, createProgress('retained-progress'));
    catalog.navigate('lesson', { lessonId: 'route-param' });

    const lesson = await waitFor(() => document.querySelector('lesson-page'));
    await waitFor(() => pageTemplate(lesson)?.getAttribute('state') === 'active');
    await waitFor(() => lesson.params?.lessonId === 'route-param');
    const lessonOutput = await waitFor(() => lesson.shadowRoot?.querySelector('output'));
    await waitFor(() => lessonOutput.textContent.includes('retained-progress'));
    expect(lesson.constructor.getPagePrivateChannel('lesson-page')).toBe('__oc_page_lesson');
    expect(typeof lesson.subscribe).toBe('function');
    expect(typeof lesson.unsubscribe).toBe('function');
    expect(window.location.hash).toBe('#!/lesson/route-param');
    expect(lesson.params).toMatchObject({ lessonId: 'route-param' });

    const manager = await waitFor(() => lesson.shadowRoot?.querySelector('lesson-data-manager'));
    const cancelled = [];
    manager.addEventListener('lesson-data-cancelled', event => cancelled.push(event.detail.status));
    const pending = manager.load({ lessonId: 'route-param', mode: 'delayed' });
    lesson.navigate('catalog');
    await waitFor(() => pageTemplate(catalog)?.getAttribute('state') === 'active');
    expect(await pending).toMatchObject({ status: 'cancelled', lessonId: 'route-param' });
    expect(cancelled).toEqual(['cancelled']);

    const valueAfterLeave = lessonOutput.textContent;
    catalog.publish(ACADEMY_PROGRESS_CHANNEL, createProgress('after-leave'));
    await nextTask();
    expect(lessonOutput.textContent).toBe(valueAfterLeave);

    const languageButton = catalogTemplate.shadowRoot.querySelector('button[data-language="es"]');
    languageButton.click();
    await waitFor(() => document.documentElement.lang === 'es' && catalog.shadowRoot.textContent.includes('Catálogo de aprendizaje'));
    expect(document.title).toBe(t('app.title'));
  }, 15000);
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
import { currentLanguage, setLanguage, t } from '../../app/scripts/localization.js';

afterEach(() => {
  document.body.replaceChildren();
  setLanguage('en');
});

describe('application locales', () => {
  it('keeps English and Spanish keys in parity', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.es).sort());
  });

  it('changes the document and visible catalog strings through the language control', async () => {
    setLanguage('en');
    const template = document.createElement('catalog-page-template');
    document.body.append(template);
    await template.updateComplete;
    expect(template.shadowRoot.textContent).toContain('English');

    template.shadowRoot.querySelector('button[data-language="es"]').click();
    await template.updateComplete;
    expect(currentLanguage()).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe(catalogs.es['app.title']);
    expect(t('catalog.title')).toBe('Catálogo de aprendizaje');
    expect(template.shadowRoot.textContent).toContain('Inglés');
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
    'app/tpls/academy-app-shell.js': appShellSource(),
    'app/tpls/catalog-page-template.js': catalogTemplateSource(),
    'app/tpls/index.tpl': indexTemplateSource(),
    'app/tpls/lesson-page-template.js': lessonTemplateSource(),
    'test/unit/channels.test.js': channelsTestSource(),
    'test/unit/data-manager.test.js': dataManagerTestSource(),
    'test/unit/locales.test.js': localesTestSource(),
    'test/unit/runtime.test.js': runtimeTestSource(),
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
