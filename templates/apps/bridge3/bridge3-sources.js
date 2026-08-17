const PROFILE_TITLES = Object.freeze({
  blank: Object.freeze({ en: 'Open Cells learning starter', es: 'Inicio de aprendizaje Open Cells' }),
  'web-app': Object.freeze({ en: 'Open Cells learning catalog', es: 'Catálogo de aprendizaje Open Cells' }),
  'web-mobile-app': Object.freeze({ en: 'Open Cells mobile learning', es: 'Aprendizaje móvil Open Cells' }),
  'academy-app': Object.freeze({ en: 'Open Cells learning studio', es: 'Estudio de aprendizaje Open Cells' })
});

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function titleFor(profile) {
  return PROFILE_TITLES[profile];
}

function configSource(profile, name, production) {
  const title = titleFor(profile);
  const config = {
    lang: 'en',
    app: {
      name,
      title: title.en,
      description: 'A local Open Cells Bridge 3 learning application.'
    },
    componentsPath: './components/',
    pagesPath: './pages/',
    templatesPath: './composerMocks/',
    composerEndpoint: 'composerMocks',
    initialBundle: ['catalog'],
    isThemedMode: true,
    routes: {
      catalog: {},
      lesson: {}
    },
    cells_properties: {
      enableLitElement: true,
      onlyLitElements: true,
      debug: !production,
      logs: false,
      locales: {
        enabledI18n: true,
        languages: ['en', 'es'],
        intlInputFileNames: ['locales'],
        intlFileName: 'locales',
        forTesting: true
      }
    },
    app_properties: {
      environment: production ? 'production' : 'development',
      teachingMode: true
    }
  };
  return `const appConfig = ${stableJson(config).trimEnd()};

export default appConfig;
`;
}

function indexTemplateSource() {
  return `<!doctype html>
<html lang="##lang##">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="##app.description##">
    <title>##app.title##</title>
    <link rel="stylesheet" href="styles/main.css">
  </head>
  <body data-open-cells-route="catalog">
    <main id="app__content" aria-live="polite">
      <section class="academy-route" data-route="catalog" aria-labelledby="academy-catalog-title">
        <h1 id="academy-catalog-title">Open Cells learning catalog</h1>
        <p>Choose a local lesson to practice Bridge 3 routes, channels, locales, and Composer page definitions.</p>
        <a href="#!/lesson?lessonId=introduction">Open the introduction lesson</a>
      </section>
    </main>
    <script src="vendor/academy-runtime.js"></script>
    <script type="module" src="scripts/app-module.js"></script>
  </body>
</html>
`;
}

function bootstrapSource() {
  return `(function bootstrapOpenCellsAcademy() {
  window.AppConfig = {};
  window.OpenCellsAcademy = Object.freeze({ initialRoute: 'catalog' });
}());
`;
}

function routesSource() {
  return `export const NAVIGATION = Object.freeze([
  Object.freeze({ path: '/', page: 'catalog' }),
  Object.freeze({ path: '/lesson', page: 'lesson' })
]);

export const ROUTES = Object.freeze(NAVIGATION.reduce((routes, item) => {
  routes[item.page] = item.path;
  return routes;
}, {}));
`;
}

function channelContractSource() {
  return `export const LEARNING_PROGRESS_CHANNEL = 'academy_learning_progress';
export const OPEN_LESSON_EVENT = 'academy-open-lesson';
`;
}

function appSource() {
  return `import { ROUTES } from './app-routes.js';

(function startOpenCellsApplication() {
  if (window.CellsPolymer && typeof window.CellsPolymer.start === 'function') {
    window.CellsPolymer.start({ routes: ROUTES });
  }
}());
`;
}

function appModuleSource() {
  return `import './app-bootstrap.js';
import './lit-initial-components.js';
import './app.js';
`;
}

function initialComponentsSource() {
  return `import '../pages/catalog-page/catalog-page.js';
`;
}

function deferredComponentsSource() {
  return `import '../pages/lesson-page/lesson-page.js';
`;
}

function initialImportsSource() {
  return `<!-- Open Cells Bridge 3 initial component imports -->
<!-- will be replaced with imports -->
<!-- will be replaced with dependencies -->
`;
}

function themedInitialImportsSource() {
  return `<!-- Open Cells Bridge 3 themed initial component imports -->
<!-- will be replaced with imports -->
<!-- will be replaced with dependencies -->
`;
}

function catalogComposerSource() {
  return `module.exports = function createCatalogPage() {
  return {
    template: {
      familyPath: '../../components/academy-learning-shell',
      tag: 'academy-learning-shell'
    },
    components: [{
      zone: 'app__main',
      familyPath: '../components/academy-catalog-page',
      tag: 'academy-catalog-page',
      properties: {
        cellsConnections: {
          out: {
            academy_learning_open_lesson: {
              bind: 'academy-open-lesson',
              link: {
                page: 'lesson',
                params: { lessonId: 'lessonId' }
              }
            }
          }
        }
      }
    }]
  };
};
`;
}

function lessonComposerSource() {
  return `module.exports = function createLessonPage() {
  return {
    template: {
      familyPath: '../../components/academy-learning-shell',
      tag: 'academy-learning-shell'
    },
    components: [{
      zone: 'app__main',
      familyPath: '../components/academy-lesson-page',
      tag: 'academy-lesson-page',
      properties: {
        cellsConnections: {
          params: { lessonId: 'lessonId' },
          in: {
            academy_learning_progress: { bind: 'progress' }
          }
        }
      }
    }]
  };
};
`;
}

function catalogPageSource() {
  return `import { LitElement, html } from 'lit';
import { CellsPageMixin } from '@cells/cells-page-mixin';
import { LEARNING_PROGRESS_CHANNEL, OPEN_LESSON_EVENT } from '../../scripts/channel-contract.js';

export class AcademyCatalogPage extends CellsPageMixin(LitElement) {
  static get is() {
    return 'academy-catalog-page';
  }

  onPageEnter() {
    this.publish(LEARNING_PROGRESS_CHANNEL, { lessonId: 'introduction', status: 'ready' });
  }

  openLesson() {
    this.dispatchEvent(new CustomEvent(OPEN_LESSON_EVENT, {
      bubbles: true,
      composed: true,
      detail: { lessonId: 'introduction' }
    }));
  }

  render() {
    return html\`<section aria-labelledby="catalog-title">
      <h1 id="catalog-title">Open Cells learning catalog</h1>
      <button type="button" @click=\${this.openLesson}>Open lesson</button>
    </section>\`;
  }
}

if (customElements.get(AcademyCatalogPage.is) === undefined) {
  customElements.define(AcademyCatalogPage.is, AcademyCatalogPage);
}
`;
}

function lessonPageSource() {
  return `import { LitElement, html } from 'lit';
import { CellsPageMixin } from '@cells/cells-page-mixin';
import { LEARNING_PROGRESS_CHANNEL } from '../../scripts/channel-contract.js';

export class AcademyLessonPage extends CellsPageMixin(LitElement) {
  static get is() {
    return 'academy-lesson-page';
  }

  static get properties() {
    return {
      lessonId: { type: String },
      progress: { type: Object }
    };
  }

  constructor() {
    super();
    this.lessonId = 'introduction';
    this.progress = undefined;
  }

  onPageEnter() {
    this.subscribe(LEARNING_PROGRESS_CHANNEL, progress => {
      this.progress = progress;
    });
  }

  onPageLeave() {
    this.unsubscribe(LEARNING_PROGRESS_CHANNEL);
  }

  render() {
    return html\`<section aria-labelledby="lesson-title">
      <h1 id="lesson-title">Open Cells lesson: \${this.lessonId}</h1>
      <p>Latest progress: \${this.progress?.lessonId ?? this.lessonId}</p>
    </section>\`;
  }
}

if (customElements.get(AcademyLessonPage.is) === undefined) {
  customElements.define(AcademyLessonPage.is, AcademyLessonPage);
}
`;
}

function componentSource(tag, content) {
  return `<dom-module id="${tag}">
  <template>${content}</template>
</dom-module>
`;
}

function stylesSource() {
  return `$academy-ink: #1e293b;
$academy-surface: #f8fafc;
$academy-action: #0f766e;

html,
body {
  min-height: 100%;
  margin: 0;
}

body {
  color: $academy-ink;
  background: $academy-surface;
  font-family: system-ui, sans-serif;
}

.academy-route {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem;
}

.academy-route a {
  color: $academy-action;
}
`;
}

function localeSource(profile, language) {
  const title = titleFor(profile);
  const catalog = language === 'en'
    ? {
        'app.title': title.en,
        'catalog.title': 'Open Cells learning catalog',
        'catalog.description': 'Choose a local lesson to practice Bridge 3 routes, channels, and Composer page definitions.',
        'catalog.openLesson': 'Open lesson',
        'lesson.title': 'Open Cells lesson',
        'lesson.progress': 'Latest progress',
        'language.en': 'English',
        'language.es': 'Spanish'
      }
    : {
        'app.title': title.es,
        'catalog.title': 'Catálogo de aprendizaje Open Cells',
        'catalog.description': 'Elige una lección local para practicar rutas Bridge 3, canales y definiciones de páginas Composer.',
        'catalog.openLesson': 'Abrir lección',
        'lesson.title': 'Lección Open Cells',
        'lesson.progress': 'Último progreso',
        'language.en': 'Inglés',
        'language.es': 'Español'
      };
  return stableJson(catalog);
}

function routesTestSource() {
  return `import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('declares catalog and lesson routes for the Bridge 3 application', async () => {
  const source = await readFile(new URL('../../app/scripts/app-routes.js', import.meta.url), 'utf8');
  expect(source).toMatch(/path: '\\/'/u);
  expect(source).toMatch(/page: 'catalog'/u);
  expect(source).toMatch(/page: 'lesson'/u);
});
`;
}

function localesTestSource() {
  return `import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('keeps English and Spanish app locale keys in parity', async () => {
  const [english, spanish] = await Promise.all([
    readFile(new URL('../../app/locales-app/en.json', import.meta.url), 'utf8'),
    readFile(new URL('../../app/locales-app/es.json', import.meta.url), 'utf8')
  ]);
  expect(Object.keys(JSON.parse(english)).sort()).toEqual(Object.keys(JSON.parse(spanish)).sort());
});
`;
}

function configTestSource() {
  return `import { expect, test } from 'vitest';
import appConfig from '../../app/config/dev.js';

test('keeps Composer and locale inputs in the development config', () => {
  expect(appConfig.composerEndpoint).toBe('composerMocks');
  expect(appConfig.initialBundle).toEqual(['catalog']);
  expect(appConfig.cells_properties.locales.languages).toEqual(['en', 'es']);
});
`;
}

function sourceValidationSource() {
  return `import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
  'start' + 'App',
  '@open-cells/' + 'core',
  '@open-cells/' + 'page-mixin',
  'start' + 'Bridge'
];

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(candidate));
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(candidate);
  }
  return files;
}

for (const file of await sourceFiles(fileURLToPath(new URL('../app/', import.meta.url)))) {
  const source = await readFile(file, 'utf8');
  if (forbidden.some(token => source.includes(token))) {
    throw new Error('Generated Bridge 3 source imported a modern runtime API.');
  }
}
`;
}

function localeValidationSource() {
  return `import { readFile } from 'node:fs/promises';

const [english, spanish] = await Promise.all([
  readFile(new URL('../app/locales-app/en.json', import.meta.url), 'utf8'),
  readFile(new URL('../app/locales-app/es.json', import.meta.url), 'utf8')
]);
const englishCatalog = JSON.parse(english);
const spanishCatalog = JSON.parse(spanish);
const englishKeys = Object.keys(englishCatalog).sort();
if (englishKeys.length === 0 || JSON.stringify(englishKeys) !== JSON.stringify(Object.keys(spanishCatalog).sort())) {
  throw new Error('Locale keys are not in parity.');
}
`;
}

function readmeSource() {
  return `# Open Cells Bridge 3 learning app

This generated app is a CLI 4-compatible Open Cells teaching project. Start development with \`cells app:serve -c dev.js\`, create a production build with \`cells app:build -c prod.js\`, validate locales with \`cells app:locales -c dev.js\`, and run its generated tests with \`cells app:test\`.

The catalog is the initial Composer page. It publishes the public \`academy_learning_progress\` channel and links to the lesson through a named page definition. The lesson consumes the latest progress while active and releases its subscription when it leaves. All lesson data is local fixture content; the scaffold has no business endpoint, identity flow, analytics package, or private design dependency.
`;
}

function e2eSource() {
  return `import { expect, test } from 'playwright/test';

test('serves the neutral Open Cells catalog route', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-route="catalog"]')).toContainText('Open Cells learning catalog');
});
`;
}

function playwrightConfigSource() {
  return `import { defineConfig } from 'playwright/test';

const port = Number(process.env.OPEN_CELLS_E2E_PORT ?? '4173');
const address = 'http://127.0.0.1:' + String(port);

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: address },
  webServer: {
    command: 'cells app:serve -c dev.js --host 127.0.0.1 --port ' + String(port) + ' --strictPort --no-open',
    reuseExistingServer: false,
    url: address
  }
});
`;
}

export function createBridge3Sources(profile, name, { e2e = false } = {}) {
  const sources = {
    'README.md': readmeSource(),
    'app/config/dev.js': configSource(profile, name, false),
    'app/config/prod.js': configSource(profile, name, true),
    'app/composerMocksTpl/catalog.js': catalogComposerSource(),
    'app/composerMocksTpl/lesson.js': lessonComposerSource(),
    'app/elements/academy-learning-copy/academy-learning-copy.js': `export const academyLearningCopy = 'Open Cells learning';\n`,
    'app/locales-app/en.json': localeSource(profile, 'en'),
    'app/locales-app/es.json': localeSource(profile, 'es'),
    'app/manifest.json': stableJson({ name: titleFor(profile).en, short_name: 'Open Cells', start_url: './', display: 'standalone' }),
    'app/pages/catalog-page/catalog-page.js': catalogPageSource(),
    'app/pages/lesson-page/lesson-page.js': lessonPageSource(),
    'app/precache.json': stableJson([]),
    'app/resources/lessons.json': stableJson({ lessons: [{ id: 'introduction', title: 'Open Cells fundamentals' }] }),
    'app/robots.txt': 'User-agent: *\nDisallow:\n',
    'app/scripts/app-bootstrap.js': bootstrapSource(),
    'app/scripts/channel-contract.js': channelContractSource(),
    'app/scripts/app-module.js': appModuleSource(),
    'app/scripts/app-routes.js': routesSource(),
    'app/scripts/app.js': appSource(),
    'app/scripts/lit-components.js': deferredComponentsSource(),
    'app/scripts/lit-initial-components.js': initialComponentsSource(),
    'app/styles/main.scss': stylesSource(),
    'app/tpls/index.tpl': indexTemplateSource(),
    'app/tpls/initial-components-imports-themed.tpl': themedInitialImportsSource(),
    'app/tpls/initial-components-imports.tpl': initialImportsSource(),
    'app/vendor/academy-runtime.js': `window.OpenCellsAcademyVendor = Object.freeze({ family: 'bridge3-teaching' });\n`,
    'components/academy-catalog-page/academy-catalog-page.html': componentSource('academy-catalog-page', '<slot></slot>'),
    'components/academy-learning-shell/academy-learning-shell.html': componentSource('academy-learning-shell', '<main><slot></slot></main>'),
    'components/academy-lesson-page/academy-lesson-page.html': componentSource('academy-lesson-page', '<slot></slot>'),
    'scripts/validate-locales.js': localeValidationSource(),
    'scripts/validate-source.js': sourceValidationSource(),
    'test/unit/config.test.js': configTestSource(),
    'test/unit/locales.test.js': localesTestSource(),
    'test/unit/routes.test.js': routesTestSource()
  };
  if (e2e) {
    sources['e2e/bridge3-app.spec.js'] = e2eSource();
    sources['playwright.config.js'] = playwrightConfigSource();
  }
  return Object.freeze(sources);
}
