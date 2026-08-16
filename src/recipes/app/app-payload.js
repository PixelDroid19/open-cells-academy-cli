import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { applicationProfilePayloads } from '../../../templates/apps/profile-payloads.js';

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function routeRecords(payload) {
  return payload.routes.map((route, index) => ({
    name: route.name,
    path: index === 0 ? '/' : `/${route.name}`,
    component: `academy-${route.name}-route`,
    titleKey: `route.${route.name}.title`,
    descriptionKey: `route.${route.name}.description`,
    ...(route.lesson === undefined ? {} : { lesson: route.lesson, example: route.example })
  }));
}

function catalogRecords(payload) {
  const en = {
    'app.title': payload.enTitle,
    'nav.label': 'Academy routes',
    'back.label': 'Back',
    'language.en': 'English',
    'language.es': 'Spanish',
    'params.label': 'Route parameters',
    'scoped.label': 'Scoped versions',
    'scoped.versionA': 'Scoped version A',
    'scoped.versionB': 'Scoped version B',
    'action.refresh': 'Refresh data',
    'action.success': 'Load success',
    'action.error': 'Load error',
    'action.delayed': 'Load delayed',
    'action.cancel': 'Cancel request',
    'action.lesson': 'Run lesson',
    'action.login': 'Sign in locally',
    'action.movements': 'Load movements',
    'action.setting': 'Toggle layout',
    'mobile.help': 'All teaching data stays on this local server.',
    'mobile.setting.compact': 'Compact layout',
    'mobile.setting.comfortable': 'Comfortable layout',
    'profile.loading': 'Loading teaching data',
    'profile.success': 'Teaching data ready',
    'profile.error': 'Teaching data unavailable'
  };
  const es = {
    'app.title': payload.esTitle,
    'nav.label': 'Rutas de Academy',
    'back.label': 'Atrás',
    'language.en': 'Inglés',
    'language.es': 'Español',
    'params.label': 'Parámetros de ruta',
    'scoped.label': 'Versiones aisladas',
    'scoped.versionA': 'Versión aislada A',
    'scoped.versionB': 'Versión aislada B',
    'action.refresh': 'Actualizar datos',
    'action.success': 'Cargar éxito',
    'action.error': 'Cargar error',
    'action.delayed': 'Cargar con demora',
    'action.cancel': 'Cancelar solicitud',
    'action.lesson': 'Ejecutar lección',
    'action.login': 'Ingresar localmente',
    'action.movements': 'Cargar movimientos',
    'action.setting': 'Cambiar diseño',
    'mobile.help': 'Todos los datos de aprendizaje permanecen en este servidor local.',
    'mobile.setting.compact': 'Configuración compacta',
    'mobile.setting.comfortable': 'Configuración cómoda',
    'profile.loading': 'Cargando datos de aprendizaje',
    'profile.success': 'Datos de aprendizaje listos',
    'profile.error': 'Datos de aprendizaje no disponibles'
  };
  for (const route of payload.routes) {
    en[`route.${route.name}.title`] = route.enTitle;
    en[`route.${route.name}.description`] = route.enDescription;
    es[`route.${route.name}.title`] = route.esTitle;
    es[`route.${route.name}.description`] = route.esDescription;
  }
  return Object.freeze({ en: Object.freeze(en), es: Object.freeze(es) });
}

function indexSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#072146">
    <title></title>
  </head>
  <body>
    <main id="app" aria-live="polite"></main>
    <script type="module" src="/src/app.js"></script>
  </body>
</html>
`;
}

function cellsConfigSource(payload, name, production) {
  return `export default ${stableJson({
    app: {
      lang: 'en',
      title: payload.enTitle,
      description: payload.enDescription ?? payload.enTitle,
      header: payload.enTitle,
      name,
      version: '0.0.0'
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
      enabledI18n: false
    }
  })}`;
}

function routesSource(routes) {
  return `export const routes = Object.freeze(${JSON.stringify(routes, null, 2)}.map(route => Object.freeze(route)));
`;
}

function appMessagesSource(catalogs) {
  return `import { loadMessages } from './main.js';
import { installIntlMsg } from './runtime/academy-intl-msg.js';

export const appCatalogs = Object.freeze(${JSON.stringify(catalogs, null, 2)});
export const appIntlMsg = installIntlMsg({ catalogs: appCatalogs, language: 'en' });
let languageRequestVersion = 0;

function academyI18nError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function appMessage(key) {
  const value = appIntlMsg.t(key);
  if (value === key) throw academyI18nError('ACADEMY_I18N_MISSING_KEY');
  return value;
}

export async function switchAppLanguage(language) {
  if (!Object.hasOwn(appCatalogs, language)) throw academyI18nError('ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  const requestVersion = ++languageRequestVersion;
  await loadMessages(language);
  await appIntlMsg.loadUrlResourcesComplete;
  if (requestVersion !== languageRequestVersion || appIntlMsg.lang !== language || document.documentElement.lang === language) return undefined;
  document.documentElement.lang = language;
  document.title = appIntlMsg.t('app.title');
  window.dispatchEvent(new CustomEvent('academy-language-changed', { detail: language }));
  if (requestVersion !== languageRequestVersion) return undefined;
  return language;
}
`;
}

function stylesSource() {
  return `import { css } from 'lit';

export const appStyles = css\`
  :host { display: block; min-height: 100%; padding: 2rem; color: #072146; font: 16px/1.5 system-ui, sans-serif; }
  :host([state="cached"]), :host([state="inactive"]) { display: none; }
  nav, .language, .scoped { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.5rem 0; }
  button { border: 0; border-radius: .25rem; padding: .65rem 1rem; color: white; background: #1464a5; cursor: pointer; }
  button.secondary { color: #072146; background: #d4edfc; }
  section { max-width: 48rem; margin: auto; }
  output { display: block; padding: .75rem; background: #f4f5f6; }
\`;
`;
}

function fixtureApiPluginSource() {
  return `const payloads = Object.freeze({
  courses: Object.freeze({ courses: Object.freeze([{ id: 'course-42', title: 'Local API course' }]) }),
  account: Object.freeze({ account: Object.freeze({ id: 'account-ada', name: 'Ada' }) }),
  movements: Object.freeze({ movements: Object.freeze([{ id: 'movement-42', amount: 42 }]) }),
  lessons: Object.freeze({ lesson: Object.freeze({ id: 'lesson-local-api', capability: 'createLocalApiRequest' }) })
});

function send(response, status, body) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

export function academyFixtureApi() {
  function installFixtureApi(server) {
    server.middlewares.use('/fixtures/local-api', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const resource = url.pathname.replace(/^\\//, '');
      const mode = url.searchParams.get('mode');
      if (!Object.hasOwn(payloads, resource)) return send(response, 404, JSON.stringify({ code: 'NOT_FOUND' }));
      const payload = JSON.stringify(payloads[resource]);
      if (mode === 'success') return send(response, 200, payload);
      if (mode === 'error') return send(response, 503, JSON.stringify({ code: 'FIXTURE_UNAVAILABLE' }));
      if (mode !== 'delayed') return send(response, 404, JSON.stringify({ code: 'NOT_FOUND' }));
      const timer = setTimeout(() => send(response, 200, payload), 5000);
      request.once('aborted', () => clearTimeout(timer));
      response.once('close', () => clearTimeout(timer));
    });
  }

  return {
    name: 'academy-local-fixture-api',
    configureServer: installFixtureApi,
    configurePreviewServer: installFixtureApi
  };
}
`;
}

function profileRuntimeSource(profile) {
  if (profile === 'blank') return undefined;
  if (profile === 'web-app') {
    return `import { createDataManager, publish, subscribe } from './main.js';

const channel = 'academy:web-app:catalog:loaded';
export const taughtCapabilities = Object.freeze(['createDataManager', 'publish', 'subscribe']);

function emitProfileData(data) {
  globalThis.__academyProfileState = data;
  window.dispatchEvent(new CustomEvent('academy-profile-data', { detail: data }));
}

export async function activateProfileRuntime() {
  const cleanup = subscribe(channel, data => {
    globalThis.__academyPubSubDelivery = data;
  });
  const manager = createDataManager({
    request: async () => ({ courses: [{ id: 'cells-core', title: 'Cells Core' }] }),
    publish: state => {
      emitProfileData(state);
      if (state.status === 'success') publish(channel, state.data, { sessionStorage: true });
    }
  });
  await manager.load({ resource: 'catalog' });
  return Object.freeze({
    run: () => manager.load({ resource: 'catalog' }),
    cancel: () => manager.cancel('teaching-cancel'),
    close: () => { cleanup(); manager.dispose(); }
  });
}
`;
  }
  if (profile === 'web-mobile-app') {
    return `import { createDataManager } from './main.js';
import { createLocalApiRequest } from './capabilities/local-api/local-api-client.js';

export const taughtCapabilities = Object.freeze(['createDataManager', 'createLocalApiRequest']);

function emitProfileData(data) {
  globalThis.__academyProfileState = data;
  window.dispatchEvent(new CustomEvent('academy-profile-data', { detail: data }));
}

export async function activateProfileRuntime() {
  const manager = createDataManager({
    request: createLocalApiRequest({ baseUrl: window.location.origin }),
    publish: emitProfileData
  });
  await manager.load({ resource: 'courses', mode: 'success' });
  return Object.freeze({
    run: (mode, resource = 'courses') => manager.load({ resource, mode }),
    cancel: () => manager.cancel('teaching-cancel'),
    close: () => manager.dispose()
  });
}
`;
  }
  return `import { createDataManager, loadMessages, navigate, publish, subscribe } from './main.js';
import { createLocalApiRequest } from './capabilities/local-api/local-api-client.js';
import { createScopedRouteHosts } from './capabilities/scoped-elements/scoped-hosts.js';

export const taughtCapabilities = Object.freeze(['navigate', 'publish', 'subscribe', 'createDataManager', 'createLocalApiRequest', 'loadMessages', 'createScopedRouteHosts']);

function emitProfileData(data) {
  globalThis.__academyProfileState = data;
  window.dispatchEvent(new CustomEvent('academy-profile-data', { detail: data }));
}

export async function activateProfileRuntime() {
  const channel = 'academy:academy-app:lesson:ready';
  const cleanup = subscribe(channel, emitProfileData);
  const localRequest = createLocalApiRequest({ baseUrl: window.location.origin });
  const manager = createDataManager({
    request: input => input.resource === 'local-api' ? localRequest({ resource: 'lessons', mode: 'success' }) : Promise.resolve({ lessons: taughtCapabilities }),
    publish: state => publish(channel, state, { sessionStorage: true })
  });
  const result = await manager.load({ resource: 'catalog' });
  return Object.freeze({
    run: capability => manager.load({ resource: capability === 'createLocalApiRequest' ? 'local-api' : 'catalog' }),
    cancel: () => manager.cancel('teaching-cancel'),
    close: () => { cleanup(); manager.dispose(); }
  });
}
`;
}

function appSource(payload, routes, hasProfileRuntime) {
  const runtimeImport = hasProfileRuntime ? "import { activateProfileRuntime, taughtCapabilities } from './profile-runtime.js';" : 'const taughtCapabilities = Object.freeze([]);';
  const runtimeActivation = hasProfileRuntime ? 'const profileRuntime = await activateProfileRuntime();' : 'const profileRuntime = undefined;';
  const actions = JSON.stringify(payload.actions);
  const isDesktop = payload.marker === 'academy-web-app';
  const isMobile = payload.marker === 'academy-mobile-app';
  const isAcademy = payload.marker === 'academy-learning-app';
  const desktopSubscription = isDesktop
    ? `this.pubsubCleanup = subscribe('academy:web-app:catalog:loaded', data => { this.pubsubData = data; });`
    : '';
  const desktopCleanup = isDesktop ? 'this.pubsubCleanup?.();' : '';
  const mobileActions = isMobile
    ? `\${route.name === 'login' ? html\`<academy-button-default data-mobile-action="login" .text=\${this.t('action.login')} @click=\${async () => { await profileRuntime.run('success', 'account'); navigate('dashboard', { accountId: 'account-ada' }); }}></academy-button-default>\` : ''}
      \${route.name === 'movements' ? html\`<academy-button-default data-mobile-action="load-movements" .text=\${this.t('action.movements')} @click=\${() => profileRuntime.run('success', 'movements')}></academy-button-default>\` : ''}
      \${route.name === 'settings' ? html\`<academy-button-default data-mobile-action="toggle-setting" .text=\${this.t('action.setting')} @click=\${() => { this.mobileSetting = this.mobileSetting === 'compact' ? 'comfortable' : 'compact'; }}></academy-button-default><output data-mobile-setting>\${this.t('mobile.setting.' + this.mobileSetting)}</output>\` : ''}
      \${route.name === 'help' ? html\`<academy-type-text data-mobile-help .text=\${this.t('mobile.help')}></academy-type-text>\` : ''}`
    : '';
  const lesson = isAcademy ? `\${route.lesson ? html\`<output data-lesson-capability>\${route.lesson}</output><pre data-lesson-example><code>\${route.example}</code></pre>\` : ''}` : '';
  const pubsubOutput = isDesktop ? `\${this.pubsubData ? html\`<output data-pubsub-data>\${JSON.stringify(this.pubsubData)}</output>\` : ''}` : '';
  return `import '@webcomponents/scoped-custom-element-registry';
import { LitElement, html } from 'lit';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { WidgetMixin as widgetMixin } from './mixins/WidgetMixin.js';
import { AcademyTypeText } from './components/AcademyTypeText.js';
import { AcademyButtonDefault } from './components/AcademyButtonDefault.js';
import { appStyles } from './styles.js';
import { routes } from './routes.js';
import { navigate, startAcademyApp${isDesktop ? ', subscribe' : ''} } from './main.js';
import { appIntlMsg, switchAppLanguage } from './app-messages.js';
import { createScopedRouteHosts, defineScopedRouteHosts } from './capabilities/scoped-elements/scoped-hosts.js';
${runtimeImport}

const profileMarker = '${payload.marker}';

class ScopedVersionA extends HTMLElement {
  constructor() {
    super();
    this.renderLabel = () => { this.textContent = appIntlMsg.t('scoped.versionA'); };
  }
  connectedCallback() { this.renderLabel(); window.addEventListener('academy-language-changed', this.renderLabel); }
  disconnectedCallback() { window.removeEventListener('academy-language-changed', this.renderLabel); }
}

class ScopedVersionB extends HTMLElement {
  constructor() {
    super();
    this.renderLabel = () => { this.textContent = appIntlMsg.t('scoped.versionB'); };
  }
  connectedCallback() { this.renderLabel(); window.addEventListener('academy-language-changed', this.renderLabel); }
  disconnectedCallback() { window.removeEventListener('academy-language-changed', this.renderLabel); }
}

const scopedHosts = defineScopedRouteHosts({
  hosts: [
    createScopedRouteHosts({ childConstructor: ScopedVersionA, routeTag: 'academy-scope-version-a' }),
    createScopedRouteHosts({ childConstructor: ScopedVersionB, routeTag: 'academy-scope-version-b' })
  ]
});

class AcademyRoutePage extends widgetMixin(ScopedElementsMixin(LitElement)) {
  static get scopedElements() {
    return {
      ...super.scopedElements,
      'academy-type-text': AcademyTypeText,
      'academy-button-default': AcademyButtonDefault,
      ...Object.fromEntries(scopedHosts.map(host => [host.routeTag, host.Host]))
    };
  }

  static styles = appStyles;
  static properties = { params: { state: true }, language: { state: true }, profileState: { state: true }, pubsubData: { state: true }, mobileSetting: { state: true } };
  static route;

  constructor() {
    super();
    this.params = {};
    this.language = document.documentElement.lang;
    this.profileState = globalThis.__academyProfileState ?? { status: 'loading' };
    this.pubsubData = undefined;
    this.mobileSetting = 'comfortable';
    this.routeWasActive = false;
    this.routeFocusScheduled = false;
    this.routeStateObserver = new MutationObserver(() => this.onRouteStateChange());
    this.onLanguage = event => { this.language = event.detail; };
    this.onProfileData = event => { this.profileState = event.detail; globalThis.__academyProfileState = event.detail; };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('academy-language-changed', this.onLanguage);
    window.addEventListener('academy-profile-data', this.onProfileData);
    this.routeWasActive = this.getAttribute('state') === 'active';
    this.routeStateObserver.observe(this, { attributes: true, attributeFilter: ['state'] });
    if (this.routeWasActive && this.constructor.route.name !== routes[0].name) this.focusRouteHeading();
    ${desktopSubscription}
  }

  disconnectedCallback() {
    window.removeEventListener('academy-language-changed', this.onLanguage);
    window.removeEventListener('academy-profile-data', this.onProfileData);
    this.routeStateObserver.disconnect();
    this.routeFocusScheduled = false;
    ${desktopCleanup}
    super.disconnectedCallback();
  }

  async switchLanguage(language) {
    const selectedLanguage = await switchAppLanguage(language);
    if (selectedLanguage !== undefined) this.emitEvent('language-changed', { language: selectedLanguage });
    return selectedLanguage;
  }

  onRouteStateChange() {
    const isActive = this.getAttribute('state') === 'active';
    if (isActive && !this.routeWasActive) this.focusRouteHeading();
    this.routeWasActive = isActive;
  }

  focusRouteHeading() {
    if (this.constructor.route.name === routes[0].name || this.routeFocusScheduled || this.getAttribute('state') !== 'active') return;
    this.routeFocusScheduled = true;
    void this.updateComplete.then(() => {
      this.routeFocusScheduled = false;
      if (this.getAttribute('state') === 'active') this.shadowRoot?.querySelector('[data-route-title]')?.focus();
    });
  }

  render() {
    const route = this.constructor.route;
    const status = this.profileState?.status ?? (this.profileState?.courses || this.profileState?.lessons ? 'success' : 'loading');
    return html\`<section data-profile=\${profileMarker} data-capabilities=\${taughtCapabilities.join(',')}>
      <academy-type-text data-route-title tabindex="-1" role="heading" aria-level="1" aria-label=\${this.t(route.titleKey)} .text=\${this.t(route.titleKey)}></academy-type-text>
      <academy-type-text data-route-description .text=\${this.t(route.descriptionKey)}></academy-type-text>
      <div class="language">
        <academy-button-default data-language="en" .text=\${this.t('language.en')} @click=\${() => { void this.switchLanguage('en'); }}></academy-button-default>
        <academy-button-default data-language="es" .text=\${this.t('language.es')} @click=\${() => { void this.switchLanguage('es'); }}></academy-button-default>
      </div>
      <nav aria-label=\${this.t('nav.label') + ' — ' + this.t(route.titleKey)}>
        \${routes.map(item => html\`<academy-button-default data-route=\${item.name} .text=\${this.t(item.titleKey)} @click=\${() => navigate(item.name, { lessonId: item.name })}></academy-button-default>\`)}
      </nav>
      <academy-type-text data-route-params .text=\${this.t('params.label') + ': ' + JSON.stringify(this.params)}></academy-type-text>
      <output data-profile-status>\${this.t(\`profile.\${status === 'error' ? 'error' : status === 'success' ? 'success' : 'loading'}\`)}</output>
      <output data-profile-data>\${JSON.stringify(this.profileState)}</output>
      ${pubsubOutput}
      <div class="profile-actions">
        \${${actions}.map(action => html\`<academy-button-default data-profile-action=\${action} .text=\${this.t('action.' + action)} @click=\${() => action === 'cancel' ? profileRuntime?.cancel() : profileRuntime?.run(action === 'refresh' ? undefined : action === 'lesson' ? route.lesson : action)}></academy-button-default>\`)}
      </div>
      ${mobileActions}
      ${lesson}
      \${route.name === routes[0].name ? html\`<div class="scoped" role="group"><academy-type-text data-scoped-label .text=\${this.t('scoped.label')}></academy-type-text><academy-scope-version-a></academy-scope-version-a><academy-scope-version-b></academy-scope-version-b></div>\` : html\`<academy-button-default class="secondary" data-action="goBack" .text=\${this.t('back.label')} @click=\${() => window.history.back()}></academy-button-default>\`}
    </section>\`;
  }
}

for (const route of routes) {
  if (customElements.get(route.component) === undefined) {
    customElements.define(route.component, class extends AcademyRoutePage { static route = route; });
  }
}

await switchAppLanguage('en');
document.title = appIntlMsg.t('app.title');
startAcademyApp({
  mainNode: 'app',
  initialTemplate: routes[0].name,
  debug: false,
  routes: routes.map(route => ({
    ...route,
    action: () => customElements.whenDefined(route.component)
  }))
});
${runtimeActivation}

export { profileMarker, scopedHosts };
`;
}

function testSource(routes, catalogs) {
  return `import { describe, expect, it } from 'vitest';
import * as academyMain from '../src/main.js';
import { routes } from '../src/routes.js';
import catalogs from '../src/app-messages.json';

describe('generated Academy routes', () => {
  it('keeps unique named routes with locale parity', () => {
    expect(routes.map(route => route.name)).toEqual(${JSON.stringify(routes.map(route => route.name))});
    expect(new Set(routes.map(route => route.component)).size).toBe(routes.length);
    expect(Object.keys(catalogs.en)).toEqual(Object.keys(catalogs.es));
    expect(Object.keys(catalogs.en)).toEqual(${JSON.stringify(Object.keys(catalogs.en))});
    expect(Object.keys(academyMain).sort()).toEqual([
      'createDataManager',
      'loadMessages',
      'navigate',
      'publish',
      'startAcademyApp',
      'subscribe'
    ]);
  });
});
`;
}

function testHarnessSource(payload, routes) {
  const fixturePayload = payload.marker === 'academy-mobile-app'
    ? `{ courses: [{ id: 'course-42', title: 'Local API course' }], account: { id: 'account-ada', name: 'Ada' }, movements: [{ id: 'movement-42', amount: 42 }] }`
    : payload.marker === 'academy-learning-app'
      ? `{ lesson: { id: 'lesson-local-api', capability: 'createLocalApiRequest' } }`
      : '{}';
  return `import { routes } from '../src/routes.js';

const fixturePayload = Object.freeze(${fixturePayload});

function nextFrame() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function clickScopedControl(root, selector) {
  root.querySelector(selector).shadowRoot.querySelector('button').click();
}

export function focusScopedControl(root, selector) {
  root.querySelector(selector).shadowRoot.querySelector('button').focus();
}

export async function renderGeneratedApp() {
  document.body.innerHTML = '<main id="app" aria-live="polite"></main>';
  globalThis.fetch = async () => ({ ok: true, json: async () => fixturePayload });
  await import('../src/app.js');
  await globalThis.IntlMsg.loadUrlResourcesComplete;
  const route = routes[0];
  await customElements.whenDefined(route.component);
  let element = document.querySelector(route.component);
  if (element === null) {
    element = document.createElement(route.component);
    document.getElementById('app').append(element);
  }
  await element.updateComplete;
  await nextFrame();
  return Object.freeze({ element, root: element.shadowRoot, routes });
}

export async function settle(element) {
  await globalThis.IntlMsg.loadUrlResourcesComplete;
  await nextFrame();
  await element.updateComplete;
  await nextFrame();
}

export async function navigateFrom(element, routeName) {
  const route = routes.find(candidate => candidate.name === routeName);
  clickScopedControl(element.shadowRoot, '[data-route="' + routeName + '"]');
  const nextElement = document.querySelector(route.component);
  await settle(nextElement);
  return Object.freeze({ element: nextElement, root: nextElement.shadowRoot });
}
`;
}

function uiTestSource(payload, routes) {
  const profileAssertion = payload.marker === 'academy-web-app'
    ? `    expect(root.querySelector('[data-profile-data]').textContent).toContain('cells-core');
    expect(root.querySelector('[data-pubsub-data]').textContent).toContain('cells-core');`
    : payload.marker === 'academy-mobile-app'
      ? `    expect(root.querySelector('[data-profile-data]').textContent).toContain('course-42');
    expect(root.querySelector('[data-mobile-action="login"]')).not.toBeNull();`
      : payload.marker === 'academy-learning-app'
        ? `    expect(root.querySelector('[data-lesson-capability]').textContent).toBe('startAcademyApp');
    expect(root.querySelector('[data-profile-data]').textContent).toContain('createScopedRouteHosts');`
        : `    expect(root.querySelectorAll('[data-profile-action]').length).toBe(0);`;
  return `import { describe, expect, it } from 'vitest';
import { switchAppLanguage } from '../src/app-messages.js';
import { clickScopedControl, focusScopedControl, navigateFrom, renderGeneratedApp, settle } from './app-harness.js';

function routeTitle(root) {
  return root.querySelector('[data-route-title]').shadowRoot.querySelector('[part="text"]').textContent;
}

function expectFocusedRouteTitle(element, root) {
  const heading = root.querySelector('[data-route-title]');
  expect(heading.getAttribute('tabindex')).toBe('-1');
  expect(document.activeElement).toBe(element);
  expect(root.activeElement).toBe(heading);
}

describe('generated Academy application UI', () => {
  it('renders its named routes, localized controls, and profile capability', async () => {
    const { element, root, routes } = await renderGeneratedApp();

    expect(routeTitle(root)).toBe('${payload.routes[0].enTitle}');
    expect(customElements.get('academy-type-text')).toBeUndefined();
    expect(customElements.get('academy-button-default')).toBeUndefined();
    expect([...root.querySelectorAll('[data-route]')].map(control => control.dataset.route)).toEqual(routes.map(route => route.name));
${profileAssertion}
    const notifications = [];
    const onLanguageNotification = event => notifications.push(event.detail);
    window.addEventListener('academy-language-changed', onLanguageNotification);
    const languageChanged = new Promise(resolve => {
      element.addEventListener(element.localName + '-language-changed', resolve, { once: true });
    });
    clickScopedControl(root, '[data-language="es"]');
    const languageEvent = await languageChanged;
    await settle(element);
    expect(languageEvent.detail).toEqual({ language: 'es' });
    expect(languageEvent.bubbles).toBe(true);
    expect(languageEvent.composed).toBe(true);
    expect(languageEvent.cancelable).toBe(true);
    expect(notifications).toEqual(['es']);
    window.removeEventListener('academy-language-changed', onLanguageNotification);
    expect(routeTitle(root)).toBe('${payload.routes[0].esTitle}');
    clickScopedControl(root, '[data-language="en"]');
    await settle(element);
    let activeElement = element;
    for (const [index, route] of routes.slice(1).entries()) {
      focusScopedControl(activeElement.shadowRoot, '[data-route="' + route.name + '"]');
      const next = await navigateFrom(activeElement, route.name);
      activeElement = next.element;
      expect(next.element.getAttribute('state')).toBe('active');
      expectFocusedRouteTitle(next.element, next.root);
      expect(routeTitle(next.root)).toBe(${JSON.stringify(payload.routes.slice(1).map(route => route.enTitle))}[index]);
      ${payload.marker === 'academy-learning-app' ? `if (route.name === 'local-api') {
        clickScopedControl(next.root, '[data-profile-action="lesson"]');
        await settle(activeElement);
        expect(next.root.querySelector('[data-profile-data]').textContent).toContain('lesson-local-api');
      }` : ''}
    }
  });

  it('emits only the latest coherent language selection when requests overlap', async () => {
    const { element, root } = await renderGeneratedApp();
    const spanishChange = new Promise(resolve => {
      element.addEventListener(element.localName + '-language-changed', resolve, { once: true });
    });
    clickScopedControl(root, '[data-language="es"]');
    await spanishChange;
    await settle(element);
    const appEvents = [];
    const pageEvents = [];
    const onAppEvent = event => appEvents.push(event.detail);
    const onPageEvent = event => pageEvents.push(event.detail);
    window.addEventListener('academy-language-changed', onAppEvent);
    element.addEventListener(element.localName + '-language-changed', onPageEvent);
    clickScopedControl(root, '[data-language="es"]');
    clickScopedControl(root, '[data-language="en"]');
    await settle(element);
    window.removeEventListener('academy-language-changed', onAppEvent);
    element.removeEventListener(element.localName + '-language-changed', onPageEvent);

    expect(appEvents).toEqual(['en']);
    expect(pageEvents).toEqual([{ language: 'en' }]);
    expect(globalThis.IntlMsg.lang).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('${payload.enTitle}');
    expect(routeTitle(root)).toBe('${payload.routes[0].enTitle}');
  });

  it('does not emit a stale page event after synchronous app-language reentry', async () => {
    const { element, root } = await renderGeneratedApp();
    const appEvents = [];
    const pageEvents = [];
    let reentrantEnglish;
    const onAppEvent = event => {
      appEvents.push(event.detail);
      if (event.detail === 'es') reentrantEnglish = switchAppLanguage('en');
    };
    const onPageEvent = event => pageEvents.push(event.detail);
    window.addEventListener('academy-language-changed', onAppEvent);
    element.addEventListener(element.localName + '-language-changed', onPageEvent);

    const originatingSpanish = element.switchLanguage('es');
    await expect(originatingSpanish).resolves.toBeUndefined();
    await reentrantEnglish;
    await settle(element);
    window.removeEventListener('academy-language-changed', onAppEvent);
    element.removeEventListener(element.localName + '-language-changed', onPageEvent);

    expect(appEvents).toEqual(['es', 'en']);
    expect(pageEvents).toEqual([]);
    expect(globalThis.IntlMsg.lang).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('${payload.enTitle}');
    expect(routeTitle(root)).toBe('${payload.routes[0].enTitle}');
  });
});
`;
}

function accessibilityTestSource() {
  return `import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { navigateFrom, renderGeneratedApp } from './app-harness.js';

describe('generated Academy application accessibility', () => {
  it('has no automatically detectable violations on its initial route', async () => {
    const { element, routes } = await renderGeneratedApp();
    let activeElement = element;
    for (const route of routes) {
      if (route !== routes[0]) activeElement = (await navigateFrom(activeElement, route.name)).element;
      const results = await axe.run(document.body);
      expect(results.violations.map(violation => violation.id), route.name).toEqual([]);
    }
  });
});
`;
}

function openCellsCoreTestAdapterSource() {
  return `let config;
const channels = new Map();

export function getConfig() {
  return config;
}

export function startApp(nextConfig) {
  config = nextConfig;
  const initial = nextConfig.routes.find(route => route.name === nextConfig.initialTemplate);
  if (initial !== undefined) {
    queueMicrotask(() => {
      const element = document.createElement(initial.component);
      const mainNode = document.getElementById(nextConfig.mainNode);
      mainNode.append(element);
      element.setAttribute('state', 'active');
    });
  }
}

export function navigate(routeName, params = {}) {
  const route = config.routes.find(candidate => candidate.name === routeName);
  if (route === undefined) throw new Error('Unknown route');
  const element = document.createElement(route.component);
  element.params = params;
  const mainNode = document.getElementById(config.mainNode);
  for (const activeElement of mainNode.children) activeElement.setAttribute('state', 'inactive');
  mainNode.append(element);
  element.setAttribute('state', 'active');
  history.pushState({ routeName, params }, '', route.path);
}

export function publish(channel, payload) {
  const state = channels.get(channel) ?? { callbacks: new Set(), hasValue: false, value: undefined };
  state.hasValue = true;
  state.value = payload;
  channels.set(channel, state);
  for (const callback of [...state.callbacks]) callback(payload);
}

export function subscribe(channel, owner, callback) {
  const state = channels.get(channel) ?? { callbacks: new Set(), hasValue: false, value: undefined };
  state.callbacks.add(callback);
  channels.set(channel, state);
  if (state.hasValue) callback(state.value);
}

export function unsubscribe(channel, owner) {
  channels.get(channel)?.callbacks.clear();
}
`;
}

function testSetupSource() {
  return `import * as PropertySymbol from 'happy-dom/lib/PropertySymbol.js';

const scopedRegistry = Symbol('academyScopedRegistry');
const aliases = new WeakMap();
let aliasNumber = 0;

function aliasFor(constructor, preferredTag) {
  let alias = aliases.get(constructor);
  if (alias === undefined) {
    if (preferredTag !== undefined && customElements.get(preferredTag) === constructor) {
      alias = preferredTag;
    } else {
      alias = 'academy-test-scoped-' + aliasNumber;
      aliasNumber += 1;
      customElements.define(alias, constructor);
    }
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

function createScopedElement(root, tagName) {
  let definition;
  for (const [registeredTag, candidate] of root[scopedRegistry].entries()) {
    if (registeredTag === tagName) {
      definition = candidate;
      break;
    }
  }
  if (definition === undefined) {
    return root.ownerDocument.createElement(tagName);
  }
  const element = root.ownerDocument.createElement(definition.alias);
  element[PropertySymbol.tagName] = tagName.toUpperCase();
  element[PropertySymbol.localName] = tagName;
  return element;
}

class TestScopedRegistry {
  constructor() {
    this.definitions = new Map();
  }

  define(tagName, constructor) {
    if (this.definitions.has(tagName)) {
      throw new Error('Duplicate scoped element: ' + tagName);
    }
    this.definitions.set(tagName, { constructor, alias: aliasFor(constructor, tagName) });
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
    root.createElement = function(tagName) {
      return createScopedElement(root, tagName);
    };
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

function viteSource(profile) {
  const hasFixtureApi = profile === 'web-mobile-app' || profile === 'academy-app';
  const pluginImport = hasFixtureApi ? "import { academyFixtureApi } from './src/fixture-api-plugin.js';\n" : '';
  const plugins = hasFixtureApi ? 'plugins: [academyFixtureApi()],' : '';
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
${pluginImport}

export default defineConfig({
  ${plugins}
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    alias: {
      '@open-cells/core': fileURLToPath(new URL('./test/open-cells-core.js', import.meta.url)),
      '@webcomponents/scoped-custom-element-registry': fileURLToPath(new URL('./test/scoped-registry-polyfill.js', import.meta.url))
    }
  }
});
`;
}

function e2ePlan(payload, routes) {
  const first = payload.routes[0];
  const genericRouteChecks = payload.routes.slice(1).map((route, index) => `  await page.getByRole('heading', { name: '${payload.routes[index].enTitle}' }).locator('..').locator('[data-route="${route.name}"]').click();
  await expect(page.getByRole('heading', { name: '${route.enTitle}' })).toBeVisible();
  await expectActiveRouteFocus(page, '${route.name}');${payload.marker === 'academy-learning-app' ? `
  const lessonPage${index} = page.getByRole('heading', { name: '${route.enTitle}' }).locator('..');
  await expect(lessonPage${index}.locator('[data-lesson-capability]')).toHaveText('${route.lesson}');
  await expect(lessonPage${index}.locator('[data-lesson-example]')).toHaveText(${JSON.stringify(route.example)});${route.name === 'local-api' || route.name === 'scoped' ? `
  await lessonPage${index}.locator('[data-profile-action="lesson"]').click();
  await expect(lessonPage${index}.locator('[data-profile-data]')).toContainText('${route.name === 'local-api' ? 'lesson-local-api' : 'createScopedRouteHosts'}');` : ''}` : ''}`).join('\n');
  const routeChecks = payload.marker === 'academy-mobile-app'
    ? `  const loginPage = page.getByRole('heading', { name: 'Sign in' }).locator('..');
  await expect(loginPage.locator('[data-profile-data]')).toContainText('course-42');
  await loginPage.locator('[data-mobile-action="login"]').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectActiveRouteFocus(page, 'dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' }).locator('..').locator('[data-route-params]')).toContainText('account-ada');
  await page.getByRole('heading', { name: 'Dashboard' }).locator('..').locator('[data-route="movements"]').click();
  const movementsPage = page.getByRole('heading', { name: 'Movements' }).locator('..');
  await expectActiveRouteFocus(page, 'movements');
  await movementsPage.locator('[data-mobile-action="load-movements"]').click();
  await expect(movementsPage.locator('[data-profile-data]')).toContainText('movement-42');
  await movementsPage.locator('[data-route="settings"]').click();
  const settingsPage = page.locator('academy-settings-route');
  await expect(settingsPage.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expectActiveRouteFocus(page, 'settings');
  await settingsPage.locator('[data-language="es"]').click();
  await settingsPage.locator('[data-mobile-action="toggle-setting"]').click();
  await expect(settingsPage.locator('[data-mobile-setting]')).toHaveText('Configuración compacta');
  await settingsPage.locator('[data-language="en"]').click();
  await settingsPage.locator('[data-route="help"]').click();
  await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
  await expectActiveRouteFocus(page, 'help');
  await expect(page.getByRole('heading', { name: 'Help' }).locator('..').locator('[data-mobile-help]')).toBeVisible();`
    : genericRouteChecks;
  const expectedCapabilities = payload.marker === 'academy-web-app'
    ? 'createDataManager,publish,subscribe'
    : payload.marker === 'academy-mobile-app'
      ? 'createDataManager,createLocalApiRequest'
      : payload.marker === 'academy-learning-app'
    ? 'navigate,publish,subscribe,createDataManager,createLocalApiRequest,loadMessages,createScopedRouteHosts'
        : '';
  const profileAssertions = payload.marker === 'academy-web-app'
    ? `  await activePage.locator('[data-profile-action="refresh"]').click();
  await expect(activePage.locator('[data-profile-data]')).toContainText('cells-core');
  await expect(activePage.locator('[data-pubsub-data]')).toContainText('cells-core');`
    : payload.marker === 'academy-mobile-app'
      ? `  await expect(activePage.locator('[data-profile-data]')).toContainText('movement-42');
  await activePage.locator('[data-profile-action="error"]').click();
  await expect(activePage.locator('[data-profile-data]')).toContainText('AcademyDataRequestError');
  await activePage.locator('[data-profile-action="delayed"]').click();
  await activePage.locator('[data-profile-action="cancel"]').click();
  await expect(activePage.locator('[data-profile-data]')).toContainText('aborted');
  const clientContract = await page.evaluate(async () => {
    const { createLocalApiRequest } = await import('/src/capabilities/local-api/local-api-client.js');
    const request = createLocalApiRequest({ baseUrl: location.origin });
    const errorCode = await request({ resource: 'courses', mode: 'error' }).catch(error => error.code);
    const controller = new AbortController();
    const delayed = request({ resource: 'courses', mode: 'delayed' }, { signal: controller.signal }).catch(error => error.code);
    controller.abort();
    return { errorCode, abortCode: await delayed };
  });
  expect(clientContract).toEqual({ errorCode: 'ACADEMY_LOCAL_API_HTTP_ERROR', abortCode: 'ACADEMY_LOCAL_API_ABORTED' });`
      : payload.marker === 'academy-learning-app'
        ? `  await expect(page.locator('[data-profile-data]').last()).toContainText('createScopedRouteHosts');
  await expect(activePage.locator('[data-lesson-capability]')).toHaveText('createScopedRouteHosts');`
        : '';
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
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false }
});
`)
    .addFile('e2e/app.spec.js', `import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectActiveRouteFocus(page, routeName) {
  const route = page.locator('academy-' + routeName + '-route');
  await expect(route).toHaveAttribute('state', 'active');
  await expect(route.locator('[data-route-title]')).toBeFocused();
}

test('runs the generated Academy profile flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '${first.enTitle}' })).toBeVisible();
  await expect(page.locator('academy-scope-version-a').locator('academy-scoped-child')).toHaveText('Scoped version A');
  await expect(page.locator('academy-scope-version-b').locator('academy-scoped-child')).toHaveText('Scoped version B');
  await expect(page.locator('[data-profile]').first()).toHaveAttribute('data-capabilities', '${expectedCapabilities}');
  await expect(page.locator('[data-profile-status]')).toContainText(/Loading teaching data|Teaching data ready/);
  await page.locator('[data-profile]:visible').locator('[data-language="es"]').click();
  await expect(page.getByRole('heading', { name: '${first.esTitle}' })).toBeVisible();
  await page.locator('[data-profile]:visible').locator('[data-language="en"]').click();
${routeChecks}
  const activePage = page.getByRole('heading', { name: '${payload.routes.at(-1).enTitle}' }).locator('..');
  await expect(activePage.locator('[data-route-params]')).toContainText('lessonId');
${profileAssertions}
  await activePage.locator('[data-action="goBack"]').click();
  await expect(page.getByRole('heading', { name: '${payload.routes.at(-2)?.enTitle ?? first.enTitle}' })).toBeVisible();
${payload.routes.at(-2)?.name !== first.name ? `  await expectActiveRouteFocus(page, '${payload.routes.at(-2).name}');
` : ''}  expect(await page.evaluate(() => window.$bridge)).toBeUndefined();
  expect(await page.evaluate(() => window.$bridge)).toBeUndefined();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});
`);
}

export function createApplicationPayload(profile, { e2e = false, name = profile } = {}) {
  const payload = applicationProfilePayloads[profile];
  if (payload === undefined || typeof e2e !== 'boolean') {
    throw typedError('INVALID_INPUT', { field: 'profile' });
  }
  const routes = routeRecords(payload);
  const catalogs = catalogRecords(payload);
  const profileRuntime = profileRuntimeSource(profile);
  let plan = ScaffoldPlan.empty()
    .addDirectory('test/coverage')
    .addFile('index.html', indexSource())
    .addFile('app/config/dev.js', cellsConfigSource(payload, name, false))
    .addFile('app/config/prod.js', cellsConfigSource(payload, name, true))
    .addFile('src/app.js', appSource(payload, routes, profileRuntime !== undefined))
    .addFile('src/app-messages.js', appMessagesSource(catalogs))
    .addFile('src/app-messages.json', stableJson(catalogs))
    .addFile('src/routes.js', routesSource(routes))
    .addFile('src/routes.json', stableJson(routes))
    .addFile('src/styles.js', stylesSource())
    .addFile('test/app.test.js', testSource(routes, catalogs))
    .addFile('test/app-harness.js', testHarnessSource(payload, routes))
    .addFile('test/open-cells-core.js', openCellsCoreTestAdapterSource())
    .addFile('test/app-ui.test.js', uiTestSource(payload, routes))
    .addFile('test/app-accessibility.test.js', accessibilityTestSource())
    .addFile('test/scoped-registry-polyfill.js', '// Happy DOM uses the scoped-element bridge from setup.js instead of the browser polyfill.\nexport {};\n')
    .addFile('test/setup.js', testSetupSource())
    .addFile('vite.config.js', viteSource(profile));
  if (profileRuntime !== undefined) plan = plan.addFile('src/profile-runtime.js', profileRuntime);
  if (profile === 'web-mobile-app' || profile === 'academy-app') {
    plan = plan.addFile('src/fixture-api-plugin.js', fixtureApiPluginSource());
  }
  if (e2e) plan = plan.merge(e2ePlan(payload, routes));
  return plan;
}
