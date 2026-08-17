const PROFILE_TITLES = Object.freeze({
  blank: Object.freeze({ en: 'Open Cells learning starter', es: 'Inicio de aprendizaje Open Cells' }),
  'web-app': Object.freeze({ en: 'Open Cells learning catalog', es: 'Catálogo de aprendizaje Open Cells' }),
  'web-mobile-app': Object.freeze({ en: 'Open Cells mobile learning', es: 'Aprendizaje móvil Open Cells' }),
  'academy-app': Object.freeze({ en: 'Open Cells learning studio', es: 'Estudio de aprendizaje Open Cells' })
});

const PROFILE_FEATURES = Object.freeze({
  blank: Object.freeze({ file: 'blank-base', key: 'profile.blank', useLocalLessons: false, responsiveNavigation: false, guidedLearning: false }),
  'web-app': Object.freeze({ file: 'web-local-fixture', key: 'profile.web', useLocalLessons: true, responsiveNavigation: false, guidedLearning: false }),
  'web-mobile-app': Object.freeze({ file: 'mobile-navigation', key: 'profile.mobile', useLocalLessons: true, responsiveNavigation: true, guidedLearning: false }),
  'academy-app': Object.freeze({ file: 'guided-learning', key: 'profile.academy', useLocalLessons: true, responsiveNavigation: false, guidedLearning: true })
});

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function titleFor(profile) {
  return PROFILE_TITLES[profile];
}

function featureFor(profile) {
  return PROFILE_FEATURES[profile];
}

function configSource(profile, name, production) {
  const title = titleFor(profile);
  return `const appConfig = ${stableJson({
    lang: 'en',
    profile,
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
  }).trimEnd()};

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
    <title></title>
    <link rel="stylesheet" href="styles/main.css">
  </head>
  <body data-open-cells-route="catalog">
    <main id="app__content" aria-live="polite"></main>
    <script type="module" src="scripts/app-module.js"></script>
  </body>
</html>
`;
}

function bootstrapSource() {
  return `(function bootstrapOpenCellsAcademy() {
  window.AppConfig = {};
}());
`;
}

function routesSource() {
  return `export const ROUTES = Object.freeze([
  Object.freeze({
    name: 'catalog',
    path: '/',
    component: 'academy-catalog-page',
    template: 'academy-learning-shell',
    action: () => import('../pages/catalog-page/catalog-page.js')
  }),
  Object.freeze({
    name: 'lesson',
    path: '/lesson',
    component: 'academy-lesson-page',
    template: 'academy-learning-shell',
    action: () => import('../pages/lesson-page/lesson-page.js')
  })
]);
`;
}

function channelContractSource() {
  return `export const LEARNING_PROGRESS_CHANNEL = 'academy_learning_progress';
export const OPEN_LESSON_EVENT = 'academy-open-lesson';
`;
}

function appSource(profile) {
  const loader = featureFor(profile).useLocalLessons
    ? "import { loadLocalLessonData } from '../data-managers/local-lesson-data.js';\n"
    : 'const loadLocalLessonData = undefined;\n';
  return `import { installAcademyBridge3Compatibility } from '../vendor/runtime/academy-bridge3-compat.js';
import { academyProfile } from './app-profile.js';
import { ROUTES } from './app-routes.js';
${loader}
const bridge = installAcademyBridge3Compatibility();

void bridge.start({
  appConfig: window.AppConfig,
  mainNode: '#app__content',
  routes: ROUTES,
  profile: academyProfile,
  loadLessons: loadLocalLessonData,
  localeUrl: language => new URL('../locales/' + language + '.json', import.meta.url)
});
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

function runtimeSource() {
  return `function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function routeParameters(value) {
  const parameters = new URLSearchParams();
  if (!asRecord(value)) return parameters;
  for (const [name, parameter] of Object.entries(value)) {
    if (typeof parameter === 'string' || typeof parameter === 'number' || typeof parameter === 'boolean') {
      parameters.set(name, String(parameter));
    }
  }
  return parameters;
}

class AcademyBridge3Runtime {
  constructor(target) {
    this.target = target;
    this.channels = new Map();
    this.catalogs = Object.create(null);
    this.language = 'en';
    this.routes = [];
    this.profile = Object.freeze({});
    this.idle = Promise.resolve();
    this.activePage = undefined;
    this.activeRoute = undefined;
    this.activeSignature = undefined;
    this.boundHashChange = () => { void this.activateFromLocation(); };
    this.boundOpenLesson = event => {
      const lessonId = event?.detail?.lessonId;
      void this.navigate('lesson', typeof lessonId === 'string' ? { lessonId } : {});
    };
  }

  async start(options) {
    if (!asRecord(options) || typeof options.mainNode !== 'string' || !Array.isArray(options.routes)) {
      throw new TypeError('Academy Bridge 3 runtime requires routes and a main node.');
    }
    this.appConfig = asRecord(options.appConfig) ? options.appConfig : {};
    this.mainNode = this.target.document.querySelector(options.mainNode);
    if (this.mainNode === null) throw new TypeError('Academy Bridge 3 runtime did not find the main node.');
    this.routes = options.routes;
    this.profile = asRecord(options.profile) ? Object.freeze({ ...options.profile }) : Object.freeze({});
    this.loadLessons = typeof options.loadLessons === 'function' ? options.loadLessons : undefined;
    this.localeUrl = typeof options.localeUrl === 'function' ? options.localeUrl : undefined;
    if (asRecord(options.catalogs)) Object.assign(this.catalogs, options.catalogs);
    this.language = typeof this.appConfig.lang === 'string' ? this.appConfig.lang : 'en';
    await this.loadLanguage(this.language);
    this.target.document.documentElement.lang = this.language;
    this.target.document.title = this.translate('app.title');
    this.target.document.body.dataset.academyProfile = typeof this.profile.id === 'string' ? this.profile.id : 'blank';
    this.target.addEventListener('hashchange', this.boundHashChange);
    this.mainNode.addEventListener('academy-open-lesson', this.boundOpenLesson);
    await this.activateFromLocation();
    return this;
  }

  async loadLanguage(language) {
    if (asRecord(this.catalogs[language])) return this.catalogs[language];
    if (this.localeUrl === undefined) throw new TypeError('Academy Bridge 3 runtime needs generated locale catalogs.');
    const response = await this.target.fetch(this.localeUrl(language));
    if (!response.ok) throw new TypeError('Academy Bridge 3 runtime could not load a locale catalog.');
    const catalog = await response.json();
    if (!asRecord(catalog)) throw new TypeError('Academy Bridge 3 runtime received an invalid locale catalog.');
    this.catalogs[language] = catalog;
    return catalog;
  }

  translate(key, parameters = {}) {
    const source = this.catalogs[this.language]?.[key];
    if (typeof source !== 'string') return key;
    return source.replace(/\\{([A-Za-z0-9_.-]+)\\}/g, (_match, name) => String(parameters[name] ?? ''));
  }

  publish(channel, value) {
    if (typeof channel !== 'string' || channel.length === 0) throw new TypeError('Academy channels need a name.');
    const entry = this.channels.get(channel) ?? { subscribers: new Set(), value: undefined, hasValue: false };
    entry.value = value;
    entry.hasValue = true;
    this.channels.set(channel, entry);
    for (const subscriber of [...entry.subscribers]) subscriber(value);
    return value;
  }

  subscribe(channel, subscriber) {
    if (typeof channel !== 'string' || typeof subscriber !== 'function') throw new TypeError('Academy channel subscriptions need a callback.');
    const entry = this.channels.get(channel) ?? { subscribers: new Set(), value: undefined, hasValue: false };
    entry.subscribers.add(subscriber);
    this.channels.set(channel, entry);
    if (entry.hasValue) subscriber(entry.value);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry.subscribers.delete(subscriber);
    };
  }

  unsubscribe(channel, subscriber) {
    const entry = this.channels.get(channel);
    if (entry === undefined || typeof subscriber !== 'function') return;
    entry.subscribers.delete(subscriber);
  }

  latestValue(channel) {
    const entry = this.channels.get(channel);
    return entry?.hasValue === true ? entry.value : undefined;
  }

  routeInfo() {
    const hash = this.target.location.hash;
    const value = hash.startsWith('#!') ? hash.slice(2) : '/';
    const parsed = new URL(value.startsWith('/') ? value : '/' + value, this.target.location.origin);
    const route = this.routes.find(candidate => candidate.path === parsed.pathname) ?? this.routes[0];
    if (route === undefined) throw new TypeError('Academy Bridge 3 runtime has no routes.');
    return Object.freeze({
      route,
      signature: '#!' + parsed.pathname + parsed.search,
      params: Object.freeze(Object.fromEntries(parsed.searchParams.entries()))
    });
  }

  activateFromLocation() {
    const work = this.idle.then(async () => {
      const info = this.routeInfo();
      if (this.activeSignature === info.signature && this.activePage !== undefined) return this.activePage;
      await info.route.action?.();
      const previousPage = this.activePage;
      const previousRoute = this.activeRoute;
      if (typeof previousPage?.onPageLeave === 'function') await previousPage.onPageLeave({ nextRoute: info.route.name });
      const page = this.target.document.createElement(info.route.component);
      page.runtime = this;
      page.routeParams = info.params;
      page.profile = this.profile;
      const template = this.target.document.createElement('section');
      template.dataset.academyTemplate = typeof info.route.template === 'string' ? info.route.template : 'academy-page-shell';
      template.append(page);
      this.mainNode.replaceChildren(template);
      this.activePage = page;
      this.activeRoute = info.route.name;
      this.activeSignature = info.signature;
      this.target.document.body.dataset.route = info.route.name;
      if (typeof page.onPageEnter === 'function') await page.onPageEnter({ params: info.params, previousRoute });
      this.publish('__academy_app', Object.freeze({ currentPage: info.route.name, fromPage: previousRoute }));
      return page;
    });
    this.idle = work.catch(() => undefined);
    return work;
  }

  navigate(name, parameters = {}) {
    const route = this.routes.find(candidate => candidate.name === name);
    if (route === undefined) throw new TypeError('Academy Bridge 3 runtime received an unknown route.');
    const query = routeParameters(parameters).toString();
    const signature = '#!' + route.path + (query === '' ? '' : '?' + query);
    if (this.target.location.hash !== signature) this.target.location.hash = signature.slice(1);
    return this.activateFromLocation();
  }

  async setLanguage(language) {
    if (typeof language !== 'string' || language.length === 0) throw new TypeError('Academy Bridge 3 runtime needs a language.');
    await this.loadLanguage(language);
    this.language = language;
    this.target.document.documentElement.lang = language;
    this.target.document.title = this.translate('app.title');
    if (typeof this.activePage?.onLanguageChange === 'function') this.activePage.onLanguageChange(language);
    return language;
  }

  whenIdle() {
    return this.idle;
  }
}

export const AcademyBridge3PageMixin = Base => class extends Base {
  constructor(...args) {
    super(...args);
    this.academySubscriptions = [];
  }

  publish(channel, value) {
    return this.runtime.publish(channel, value);
  }

  subscribe(channel, subscriber) {
    const cleanup = this.runtime.subscribe(channel, subscriber);
    this.academySubscriptions.push({ channel, cleanup });
    return cleanup;
  }

  unsubscribe(channel = undefined) {
    for (const entry of [...this.academySubscriptions]) {
      if (channel === undefined || entry.channel === channel) {
        entry.cleanup();
        this.academySubscriptions.splice(this.academySubscriptions.indexOf(entry), 1);
      }
    }
  }

  latestValue(channel) {
    return this.runtime.latestValue(channel);
  }

  t(key, parameters = {}) {
    return this.runtime.translate(key, parameters);
  }

  onPageLeave() {
    this.unsubscribe();
  }
};

export function installAcademyBridge3Compatibility({ target = globalThis.window ?? globalThis } = {}) {
  const runtime = new AcademyBridge3Runtime(target);
  const bridge = Object.freeze({
    adapter: 'academy-owned-bridge3-teaching-runtime',
    runtime,
    start: options => runtime.start(options)
  });
  target.CellsPolymer = bridge;
  return bridge;
}
`;
}

function catalogPageSource() {
  return `import { AcademyBridge3PageMixin } from '../../vendor/runtime/academy-bridge3-compat.js';
import { LEARNING_PROGRESS_CHANNEL, OPEN_LESSON_EVENT } from '../../scripts/channel-contract.js';

function escaped(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export class AcademyCatalogPage extends AcademyBridge3PageMixin(HTMLElement) {
  async onPageEnter() {
    this.state = 'loading';
    this.render();
    if (typeof this.runtime.loadLessons !== 'function') {
      this.lessons = [];
      this.state = 'empty';
      this.render();
      return;
    }
    try {
      const payload = await this.runtime.loadLessons();
      this.lessons = Array.isArray(payload?.lessons) ? payload.lessons : [];
      if (this.lessons.length === 0) {
        this.state = 'empty';
      } else {
        this.state = 'ready';
        this.publish(LEARNING_PROGRESS_CHANNEL, { lessonId: this.lessons[0].id, status: 'ready' });
      }
    } catch {
      this.lessons = [];
      this.state = 'error';
    }
    this.render();
  }

  onLanguageChange() {
    this.render();
  }

  openLesson() {
    const lessonId = this.lessons?.[0]?.id ?? 'introduction';
    this.dispatchEvent(new CustomEvent(OPEN_LESSON_EVENT, {
      bubbles: true,
      composed: true,
      detail: { lessonId }
    }));
  }

  setLanguage(language) {
    void this.runtime.setLanguage(language);
  }

  render() {
    const stateKey = 'catalog.' + (this.state ?? 'loading');
    const profileKey = typeof this.profile?.key === 'string' ? this.profile.key : 'profile.blank';
    const ready = this.state === 'ready';
    const guided = this.profile?.guidedLearning === true
      ? '<p data-guided-learning="true">' + escaped(this.t('catalog.guidedLearning')) + '</p>'
      : '';
    const action = ready
      ? '<button type="button" data-open-lesson="true">' + escaped(this.t('catalog.openLesson')) + '</button>'
      : '';
    this.innerHTML = '<section class="academy-route" data-navigation-mode="' + (this.profile?.responsiveNavigation === true ? 'responsive' : 'standard') + '" aria-labelledby="catalog-title">' +
      '<div class="academy-language"><button type="button" data-language="en">' + escaped(this.t('language.en')) + '</button>' +
      '<button type="button" data-language="es">' + escaped(this.t('language.es')) + '</button></div>' +
      '<h1 id="catalog-title">' + escaped(this.t('catalog.title')) + '</h1>' +
      '<p>' + escaped(this.t('catalog.description')) + '</p>' +
      '<p data-profile="true">' + escaped(this.t(profileKey)) + '</p>' +
      guided +
      '<p data-data-state="' + escaped(this.state ?? 'loading') + '">' + escaped(this.t(stateKey)) + '</p>' +
      action +
      '</section>';
    this.querySelector('[data-open-lesson]')?.addEventListener('click', () => this.openLesson());
    for (const button of this.querySelectorAll('[data-language]')) {
      button.addEventListener('click', () => this.setLanguage(button.dataset.language));
    }
  }
}

if (customElements.get('academy-catalog-page') === undefined) {
  customElements.define('academy-catalog-page', AcademyCatalogPage);
}
`;
}

function lessonPageSource() {
  return `import { AcademyBridge3PageMixin } from '../../vendor/runtime/academy-bridge3-compat.js';
import { LEARNING_PROGRESS_CHANNEL } from '../../scripts/channel-contract.js';

function escaped(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export class AcademyLessonPage extends AcademyBridge3PageMixin(HTMLElement) {
  // academy lesson render marker
  onPageEnter({ params }) {
    this.lessonId = typeof params?.lessonId === 'string' ? params.lessonId : 'introduction';
    this.progress = this.latestValue(LEARNING_PROGRESS_CHANNEL);
    this.subscribe(LEARNING_PROGRESS_CHANNEL, progress => {
      this.progress = progress;
      this.render();
    });
    this.render();
  }

  onPageLeave() {
    super.onPageLeave();
  }

  onLanguageChange() {
    this.render();
  }

  setLanguage(language) {
    void this.runtime.setLanguage(language);
  }

  render() {
    const progress = this.progress?.lessonId ?? this.lessonId;
    this.innerHTML = '<section class="academy-route" aria-labelledby="lesson-title">' +
      '<div class="academy-language"><button type="button" data-language="en">' + escaped(this.t('language.en')) + '</button>' +
      '<button type="button" data-language="es">' + escaped(this.t('language.es')) + '</button></div>' +
      '<h1 id="lesson-title">' + escaped(this.t('lesson.title', { lessonId: this.lessonId })) + '</h1>' +
      '<p data-progress="true">' + escaped(this.t('lesson.progress', { lessonId: progress })) + '</p>' +
      '</section>';
    for (const button of this.querySelectorAll('[data-language]')) {
      button.addEventListener('click', () => this.setLanguage(button.dataset.language));
    }
  }
}

if (customElements.get('academy-lesson-page') === undefined) {
  customElements.define('academy-lesson-page', AcademyLessonPage);
}
`;
}

function localLessonDataSource() {
  return `export async function loadLocalLessonData() {
  const response = await fetch(new URL('../resources/lessons.json', import.meta.url));
  if (!response.ok) throw new TypeError('Local lesson fixture is unavailable.');
  return response.json();
}
`;
}

function featureSource(profile) {
  const feature = featureFor(profile);
  return `export const academyProfile = Object.freeze(${stableJson({
    id: profile,
    feature: feature.file,
    key: feature.key,
    useLocalLessons: feature.useLocalLessons,
    responsiveNavigation: feature.responsiveNavigation,
    guidedLearning: feature.guidedLearning
  }).trimEnd()});
`;
}

function appProfileSource(profile) {
  return `import { academyProfile } from '../features/${featureFor(profile).file}.js';

export { academyProfile };
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

.academy-language {
  display: flex;
  gap: .5rem;
  justify-content: flex-end;
}

button {
  border: 0;
  border-radius: .25rem;
  padding: .65rem 1rem;
  color: white;
  background: $academy-action;
  cursor: pointer;
}

[data-navigation-mode='responsive'] {
  max-width: 34rem;
}

@media (max-width: 40rem) {
  .academy-route {
    padding: 1rem;
  }
}
`;
}

function localeSource(profile, language) {
  const title = titleFor(profile);
  const english = {
    'app.title': title.en,
    'catalog.title': 'Open Cells learning catalog',
    'catalog.description': 'Choose a local lesson to practice routes, channels, locales, and Composer page definitions.',
    'catalog.loading': 'Loading local learning data.',
    'catalog.ready': 'Local learning data is ready.',
    'catalog.empty': 'This starter profile has no local learning data.',
    'catalog.error': 'Local learning data is unavailable.',
    'catalog.openLesson': 'Open lesson',
    'catalog.guidedLearning': 'Guided learning is enabled for this profile.',
    'lesson.title': 'Open Cells lesson: {lessonId}',
    'lesson.progress': 'Latest progress: {lessonId}',
    'lesson.introduction.title': 'Open Cells fundamentals',
    'language.en': 'English',
    'language.es': 'Spanish',
    'profile.blank': 'Blank learning base',
    'profile.web': 'Local web fixture profile',
    'profile.mobile': 'Responsive mobile navigation profile',
    'profile.academy': 'Guided learning profile'
  };
  const spanish = {
    'app.title': title.es,
    'catalog.title': 'Catálogo de aprendizaje Open Cells',
    'catalog.description': 'Elige una lección local para practicar rutas, canales, idiomas y definiciones de páginas Composer.',
    'catalog.loading': 'Cargando datos locales de aprendizaje.',
    'catalog.ready': 'Los datos locales de aprendizaje están listos.',
    'catalog.empty': 'Este perfil inicial no tiene datos locales de aprendizaje.',
    'catalog.error': 'Los datos locales de aprendizaje no están disponibles.',
    'catalog.openLesson': 'Abrir lección',
    'catalog.guidedLearning': 'El aprendizaje guiado está activo para este perfil.',
    'lesson.title': 'Lección Open Cells: {lessonId}',
    'lesson.progress': 'Último progreso: {lessonId}',
    'lesson.introduction.title': 'Fundamentos de Open Cells',
    'language.en': 'Inglés',
    'language.es': 'Español',
    'profile.blank': 'Base de aprendizaje inicial',
    'profile.web': 'Perfil de fixture web local',
    'profile.mobile': 'Perfil de navegación móvil adaptable',
    'profile.academy': 'Perfil de aprendizaje guiado'
  };
  return stableJson(language === 'en' ? english : spanish);
}

function runtimeTestSource(profile) {
  const feature = featureFor(profile);
  return `import { beforeEach, expect, test } from 'vitest';
import { installAcademyBridge3Compatibility } from '../../app/vendor/runtime/academy-bridge3-compat.js';
import { ROUTES } from '../../app/scripts/app-routes.js';
import '../../app/pages/catalog-page/catalog-page.js';
import '../../app/pages/lesson-page/lesson-page.js';

const catalogs = Object.freeze({
  en: Object.freeze(${stableJson(JSON.parse(localeSource(profile, 'en'))).trimEnd()}),
  es: Object.freeze(${stableJson(JSON.parse(localeSource(profile, 'es'))).trimEnd()})
});
const profile = Object.freeze(${stableJson({
    id: profile,
    key: feature.key,
    useLocalLessons: feature.useLocalLessons,
    responsiveNavigation: feature.responsiveNavigation,
    guidedLearning: feature.guidedLearning
  }).trimEnd()});

beforeEach(() => {
  window.location.hash = '#!/';
  document.body.innerHTML = '<main id="app__content"></main>';
});

test('runs the local compatibility runtime through catalog, lesson, retained state, leave cleanup, and locale switching', async () => {
  const bridge = installAcademyBridge3Compatibility();
  await bridge.start({
    appConfig: { lang: 'en' },
    mainNode: '#app__content',
    routes: ROUTES,
    profile,
    catalogs,
    loadLessons: profile.useLocalLessons ? async () => ({ lessons: [{ id: 'introduction' }] }) : undefined
  });
  await bridge.runtime.whenIdle();
  const catalog = document.querySelector('academy-catalog-page');
  expect(document.querySelector('[data-academy-template]').dataset.academyTemplate).toBe('academy-learning-shell');
  expect(catalog.querySelector('[data-data-state]').dataset.dataState).toBe(profile.useLocalLessons ? 'ready' : 'empty');
  bridge.runtime.publish('academy_learning_progress', { lessonId: 'introduction', status: 'ready' });
  await bridge.runtime.navigate('lesson', { lessonId: 'introduction' });
  await bridge.runtime.whenIdle();
  const lesson = document.querySelector('academy-lesson-page');
  expect(lesson.textContent).toContain('introduction');
  const beforeLeave = lesson.textContent;
  await bridge.runtime.navigate('catalog');
  await bridge.runtime.whenIdle();
  bridge.runtime.publish('academy_learning_progress', { lessonId: 'after-leave', status: 'ready' });
  expect(lesson.textContent).toBe(beforeLeave);
  await bridge.runtime.setLanguage('es');
  expect(document.documentElement.lang).toBe('es');
  expect(document.title).toBe(catalogs.es['app.title']);
  expect(document.querySelector('academy-catalog-page').textContent).toContain(catalogs.es['catalog.title']);
});

test('renders the generated data error state when a local fixture rejects', async () => {
  const bridge = installAcademyBridge3Compatibility();
  await bridge.start({
    appConfig: { lang: 'en' },
    mainNode: '#app__content',
    routes: ROUTES,
    profile,
    catalogs,
    loadLessons: async () => { throw new Error('fixture unavailable'); }
  });
  await bridge.runtime.whenIdle();
  expect(document.querySelector('[data-data-state]').dataset.dataState).toBe('error');
});
`;
}

function routesTestSource() {
  return `import { expect, test } from 'vitest';
import { ROUTES } from '../../app/scripts/app-routes.js';

test('declares the catalog initial route and the parameterized lesson route', () => {
  expect(ROUTES.map(route => route.name)).toEqual(['catalog', 'lesson']);
  expect(ROUTES.find(route => route.name === 'lesson').path).toBe('/lesson');
});
`;
}

function localesTestSource() {
  return `import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('keeps English and Spanish app locale keys in parity', async () => {
  const [english, spanish] = await Promise.all([
    readFile(resolve(process.cwd(), 'app/locales-app/en.json'), 'utf8'),
    readFile(resolve(process.cwd(), 'app/locales-app/es.json'), 'utf8')
  ]);
  expect(Object.keys(JSON.parse(english)).sort()).toEqual(Object.keys(JSON.parse(spanish)).sort());
});
`;
}

function configTestSource() {
  return `import { expect, test } from 'vitest';
import appConfig from '../../app/config/dev.js';

test('keeps Composer, locale, and profile inputs in the development config', () => {
  expect(appConfig.composerEndpoint).toBe('composerMocks');
  expect(appConfig.initialBundle).toEqual(['catalog']);
  expect(appConfig.cells_properties.locales.languages).toEqual(['en', 'es']);
  expect(typeof appConfig.profile).toBe('string');
});
`;
}

function vitestConfigSource() {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.js']
  }
});
`;
}

function sourceValidationSource() {
  return `import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
  '@' + 'cells/',
  '@' + 'open-cells/',
  'start' + 'App',
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
    throw new Error('Generated compatibility source imported a modern runtime API.');
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

This generated app ships an Academy-owned Bridge 3 compatibility runtime in \`app/vendor/runtime\`. It is a local teaching adapter based on documented routing, page lifecycle, and retained-channel contracts; it is not a vendor package.

Use the supported CLI 4 workflow: \`cells app:serve -c dev.js\`, \`cells app:test\`, and \`cells app:locales -c dev.js\`. Build and lint adapters remain outside this compatibility payload until their dedicated toolchain work is available.

The catalog is the initial Composer page. It publishes the public \`academy_learning_progress\` channel and links to the lesson through a named page definition. The lesson consumes the latest progress while active and releases its subscription when it leaves. All lesson data is local fixture content; the scaffold has no business endpoint, identity flow, analytics package, or private design dependency.
`;
}

function e2eSource(profile) {
  const opensLesson = featureFor(profile).useLocalLessons;
  const lessonFlow = opensLesson
    ? `  await page.getByRole('button', { name: 'Open lesson' }).click();
  await expect(page).toHaveURL(/#!\\/lesson\\?lessonId=introduction/u);
  await expect(page.getByRole('heading', { name: 'Open Cells lesson: introduction' })).toBeVisible();
  await page.getByRole('button', { name: 'Spanish' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
`
    : `  await page.getByRole('button', { name: 'Spanish' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
`;
  return `import { expect, test } from '@playwright/test';

test('runs the local Academy Bridge 3 compatibility catalog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open Cells learning catalog' })).toBeVisible();
  await expect(page.locator('[data-data-state="ready"], [data-data-state="empty"]')).toBeVisible();
${lessonFlow}});
`;
}

function playwrightConfigSource() {
  return `import { defineConfig } from '@playwright/test';

const port = Number(process.env.OPEN_CELLS_E2E_PORT ?? '4173');
const address = 'http://127.0.0.1:' + String(port);

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: address, channel: 'chrome' },
  webServer: {
    command: 'cells app:serve -c dev.js --host 127.0.0.1 --port ' + String(port) + ' --strictPort --no-open',
    reuseExistingServer: false,
    url: address
  }
});
`;
}

export function createBridge3Sources(profile, name, { e2e = false } = {}) {
  const feature = featureFor(profile);
  const sources = {
    'README.md': readmeSource(),
    'app/config/dev.js': configSource(profile, name, false),
    'app/config/prod.js': configSource(profile, name, true),
    'app/composerMocksTpl/catalog.js': catalogComposerSource(),
    'app/composerMocksTpl/lesson.js': lessonComposerSource(),
    ['app/features/' + feature.file + '.js']: featureSource(profile),
    'app/locales-app/en.json': localeSource(profile, 'en'),
    'app/locales-app/es.json': localeSource(profile, 'es'),
    'app/manifest.json': stableJson({ name: titleFor(profile).en, short_name: 'Open Cells', start_url: './', display: 'standalone' }),
    'app/pages/catalog-page/catalog-page.js': catalogPageSource(),
    'app/pages/lesson-page/lesson-page.js': lessonPageSource(),
    'app/precache.json': stableJson([]),
    'app/resources/lessons.json': stableJson({ lessons: [{ id: 'introduction', titleKey: 'lesson.introduction.title' }] }),
    'app/robots.txt': 'User-agent: *\nDisallow:\n',
    'app/scripts/app-bootstrap.js': bootstrapSource(),
    'app/scripts/app-profile.js': appProfileSource(profile),
    'app/scripts/channel-contract.js': channelContractSource(),
    'app/scripts/app-module.js': appModuleSource(),
    'app/scripts/app-routes.js': routesSource(),
    'app/scripts/app.js': appSource(profile),
    'app/scripts/lit-components.js': deferredComponentsSource(),
    'app/scripts/lit-initial-components.js': initialComponentsSource(),
    'app/styles/main.scss': stylesSource(),
    'app/tpls/index.tpl': indexTemplateSource(),
    'app/tpls/initial-components-imports-themed.tpl': themedInitialImportsSource(),
    'app/tpls/initial-components-imports.tpl': initialImportsSource(),
    'app/vendor/runtime/academy-bridge3-compat.js': runtimeSource(),
    'components/academy-catalog-page/academy-catalog-page.html': componentSource('academy-catalog-page', '<slot></slot>'),
    'components/academy-learning-shell/academy-learning-shell.html': componentSource('academy-learning-shell', '<main><slot></slot></main>'),
    'components/academy-lesson-page/academy-lesson-page.html': componentSource('academy-lesson-page', '<slot></slot>'),
    'scripts/validate-locales.js': localeValidationSource(),
    'scripts/validate-source.js': sourceValidationSource(),
    'test/unit/config.test.js': configTestSource(),
    'test/unit/locales.test.js': localesTestSource(),
    'test/unit/routes.test.js': routesTestSource(),
    'test/unit/runtime.test.js': runtimeTestSource(profile),
    'vitest.config.js': vitestConfigSource()
  };
  if (feature.useLocalLessons) sources['app/data-managers/local-lesson-data.js'] = localLessonDataSource();
  if (e2e) {
    sources['e2e/bridge3-app.spec.js'] = e2eSource(profile);
    sources['playwright.config.js'] = playwrightConfigSource();
  }
  return Object.freeze(sources);
}
