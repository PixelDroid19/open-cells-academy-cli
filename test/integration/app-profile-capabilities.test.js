import assert from 'node:assert/strict';
import test from 'node:test';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const PROFILES = Object.freeze(['blank', 'web-app', 'web-mobile-app', 'academy-app']);

function filesFor(profile, options = {}) {
  const plan = composeRecipe(profile, { kind: 'app', name: `${profile}-contract`, cellsVersion: '4', ...options });
  return new Map(plan.files.map(file => [file.path, file.content]));
}

test('red: generated applications localize every visible profile string in English and Spanish', () => {
  for (const profile of PROFILES) {
    const files = filesFor(profile);
    const app = files.get('src/app.js');
    const appMessages = files.get('src/app-messages.js');
    const messages = files.get('src/capabilities/i18n/messages.js');
    assert.equal(files.has('src/app-messages.js'), true, `${profile} has no app catalog`);
    const catalogs = JSON.parse(files.get('src/app-messages.json'));
    assert.deepEqual(Object.keys(catalogs.en), Object.keys(catalogs.es));
    for (const catalog of Object.values(catalogs)) {
      for (const message of Object.values(catalog)) assert.notEqual(message, '');
    }
    assert.match(app, /import \{ ScopedElementsMixin \} from '@open-wc\/scoped-elements\/lit-element\.js';/);
    assert.match(app, /import \{ WidgetMixin as widgetMixin \} from '\.\/mixins\/WidgetMixin\.js';/);
    assert.match(app, /import \{ AcademyTypeText \} from '\.\/components\/AcademyTypeText\.js';/);
    assert.match(app, /import \{ AcademyButtonDefault \} from '\.\/components\/AcademyButtonDefault\.js';/);
    assert.match(app, /class AcademyRoutePage extends widgetMixin\(ScopedElementsMixin\(LitElement\)\)/);
    assert.match(app, /static get scopedElements\(\)/);
    assert.match(app, /\.\.\.super\.scopedElements/);
    assert.match(app, /'academy-type-text': AcademyTypeText/);
    assert.match(app, /'academy-button-default': AcademyButtonDefault/);
    assert.match(app, /this\.t\('action\.' \+ action\)/);
    assert.match(app, /this\.t\('scoped\.label'\)/);
    assert.match(app, /async switchLanguage\(language\)/);
    assert.match(app, /await switchAppLanguage\(language\)/);
    assert.match(app, /this\.emitEvent\('language-changed', \{ language/);
    assert.match(app, /switchAppLanguage\('en'\)/);
    assert.match(app, /data-language="es"/);
    assert.match(app, /data-language="en"/);
    assert.match(app, /<academy-type-text/);
    assert.match(app, /<academy-button-default/);
    assert.match(app, /class="scoped" role="group"/);
    assert.match(app, /data-scoped-label/);
    assert.doesNotMatch(app, /appMessage\(/);
    assert.doesNotMatch(app, /<h[1-6]\b/);
    assert.doesNotMatch(app, /<button\b/);
    assert.match(appMessages, /import \{ installIntlMsg \} from '\.\/runtime\/academy-intl-msg\.js';/);
    assert.match(appMessages, /installIntlMsg\(\{ catalogs: appCatalogs, language: 'en' \}\)/);
    assert.match(appMessages, /await loadMessages\(language\);/);
    assert.match(appMessages, /await appIntlMsg\.loadUrlResourcesComplete;/);
    assert.equal((appMessages.match(/academy-language-changed/g) ?? []).length, 1);
    assert.match(messages, /globalThis\.IntlMsg/);
    assert.match(messages, /intlMsg\.setLanguage\(language\)/);
    assert.match(messages, /intlMsg\.t\(key, params\)/);
    assert.doesNotMatch(messages, /@lit\/localize/);
  }
});

test('red: generated guided lessons keep the Core curriculum while making widget composition observable', () => {
  const academy = filesFor('academy-app');
  const routes = academy.get('src/routes.json');

  for (const capability of [
    'startAcademyApp',
    'navigate',
    'publish+subscribe',
    'createDataManager',
    'createLocalApiRequest',
    'loadMessages',
    'createScopedRouteHosts'
  ]) {
    assert.match(routes, new RegExp(capability.replace('+', '\\+')));
  }
  assert.match(routes, /widgetMixin\(ScopedElementsMixin\(LitElement\)\)/);
  assert.match(routes, /static get scopedElements\(\)/);
  assert.match(routes, /this\.t\('route\.i18n\.title'\)/);
  assert.match(routes, /this\.emitEvent\('lesson-complete'/);
});

test('red: generated route UI uses named params, native history Back, scoped hosts, and no raw bridge debug surface', () => {
  for (const profile of PROFILES) {
    const files = filesFor(profile);
    const app = files.get('src/app.js');
    assert.match(app, /navigate\([^,]+,\s*\{\s*lessonId:/);
    assert.match(app, /params\s*=\s*\{\}/);
    assert.match(app, /window\.history\.back\(\)/);
    assert.match(app, /createScopedRouteHosts/);
    assert.match(app, /defineScopedRouteHosts/);
    assert.match(app, /debug:\s*false/);
    assert.doesNotMatch(app, /createHistoryBackControl|\$bridge|backStep/);
  }
});

test('red: generated route pages keep only the Core-selected template visible', () => {
  for (const profile of PROFILES) {
    const styles = filesFor(profile).get('src/styles.js');
    assert.match(styles, /:host\(\[state="cached"\]\), :host\(\[state="inactive"\]\) \{ display: none; \}/);
  }
});

test('red: generated route transitions focus the newly active route heading', () => {
  for (const profile of PROFILES) {
    const files = filesFor(profile, { e2e: true });
    const app = files.get('src/app.js');
    const ui = files.get('test/app-ui.test.js');
    const e2e = files.get('e2e/app.spec.js');

    assert.match(app, /data-route-title tabindex="-1"/);
    assert.match(app, /new MutationObserver/);
    assert.match(app, /focusRouteHeading/);
    assert.match(app, /getAttribute\('state'\) === 'active'/);
    assert.match(app, /route\.name !== routes\[0\]\.name/);
    assert.match(ui, /document\.activeElement/);
    assert.match(ui, /root\.activeElement/);
    assert.match(e2e, /toBeFocused\(\)/);
    assert.match(e2e, /toHaveAttribute\('state', 'active'\)/);
  }
});

test('red: desktop, mobile, and guided profiles materialize their distinct teaching capabilities', () => {
  const blank = filesFor('blank');
  const desktop = filesFor('web-app');
  const mobile = filesFor('web-mobile-app');
  const academy = filesFor('academy-app');

  assert.equal(blank.has('src/profile-runtime.js'), false);
  assert.match(desktop.get('src/profile-runtime.js'), /createDataManager/);
  assert.match(desktop.get('src/profile-runtime.js'), /publish/);
  assert.match(desktop.get('src/profile-runtime.js'), /subscribe/);
  assert.match(desktop.get('src/app.js'), /data-pubsub-data/);
  assert.equal(mobile.has('src/fixture-api-plugin.js'), true);
  assert.match(mobile.get('vite.config.js'), /academyFixtureApi/);
  assert.match(mobile.get('src/profile-runtime.js'), /createLocalApiRequest/);
  for (const action of ['login', 'load-movements', 'toggle-setting']) {
    assert.match(mobile.get('src/app.js'), new RegExp(`data-mobile-action=.?${action}`));
  }
  assert.match(mobile.get('src/fixture-api-plugin.js'), /account/);
  assert.match(mobile.get('src/fixture-api-plugin.js'), /movements/);
  assert.match(mobile.get('src/fixture-api-plugin.js'), /configurePreviewServer/);
  for (const capability of ['navigate', 'publish', 'subscribe', 'createDataManager', 'createLocalApiRequest', 'loadMessages', 'createScopedRouteHosts']) {
    assert.match(academy.get('src/profile-runtime.js'), new RegExp(capability));
  }
  assert.match(academy.get('src/routes.json'), /createLocalApiRequest/);
  assert.match(academy.get('src/profile-runtime.js'), /createLocalApiRequest/);
  assert.match(academy.get('src/fixture-api-plugin.js'), /lessons/);
  assert.match(academy.get('src/app.js'), /data-lesson-example/);
  assert.match(academy.get('test/app-ui.test.js'), /lesson-local-api/);
  assert.match(academy.get('src/app.js'), /data-lesson-capability/);
  for (const lesson of ['startAcademyApp', 'navigate', 'publish+subscribe', 'createDataManager', 'createLocalApiRequest', 'loadMessages', 'createScopedRouteHosts']) {
    assert.match(academy.get('src/routes.json'), new RegExp(lesson.replace('+', '\\+')));
  }
  for (const example of [
    'startAcademyApp({',
    "navigate('routing'",
    "publish('academy:",
    'createDataManager({',
    'createLocalApiRequest({',
    "loadMessages('es')",
    'createScopedRouteHosts({'
  ]) {
    assert.match(academy.get('src/routes.json'), new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('red: optional Playwright suite checks accessibility, locale switching, params, and Back', () => {
  for (const profile of PROFILES) {
    const files = filesFor(profile, { e2e: true });
    const spec = files.get('e2e/app.spec.js');
    assert.match(spec, /@axe-core\/playwright/);
    assert.match(spec, /violations/);
    assert.match(spec, /data-language/);
    assert.match(spec, /lessonId/);
    assert.match(spec, /goBack|Back/);
  }
});

test('red: profile E2E specs assert each profile capability instead of one generic smoke', () => {
  const blank = filesFor('blank', { e2e: true }).get('e2e/app.spec.js');
  const desktop = filesFor('web-app', { e2e: true }).get('e2e/app.spec.js');
  const mobile = filesFor('web-mobile-app', { e2e: true }).get('e2e/app.spec.js');
  const academy = filesFor('academy-app', { e2e: true }).get('e2e/app.spec.js');

  assert.match(blank, /Scoped version A/);
  assert.match(blank, /Scoped version B/);
  assert.match(desktop, /createDataManager,publish,subscribe/);
  assert.match(desktop, /data-profile-status/);
  assert.match(mobile, /createDataManager,createLocalApiRequest/);
  assert.match(mobile, /data-mobile-action=.login/);
  for (const flow of ['movements', 'settings', 'help']) assert.match(mobile, new RegExp(`data-route=.?${flow}`));
  assert.match(academy, /navigate,publish,subscribe,createDataManager,createLocalApiRequest,loadMessages,createScopedRouteHosts/);
});

test('red: real E2E observes profile data and mobile fixture success error and abort behavior', () => {
  const desktop = filesFor('web-app', { e2e: true }).get('e2e/app.spec.js');
  const mobile = filesFor('web-mobile-app', { e2e: true }).get('e2e/app.spec.js');
  const academy = filesFor('academy-app', { e2e: true }).get('e2e/app.spec.js');

  assert.match(desktop, /data-profile-action="refresh"/);
  assert.match(desktop, /cells-core/);
  assert.match(desktop, /data-profile-data/);
  assert.match(desktop, /data-pubsub-data/);
  assert.match(mobile, /course-42/);
  assert.match(mobile, /account-ada/);
  assert.match(mobile, /movement-42/);
  assert.match(mobile, /data-mobile-setting/);
  assert.match(mobile, /Configuración compacta/);
  const mobileCatalogs = JSON.parse(filesFor('web-mobile-app', { e2e: true }).get('src/app-messages.json'));
  assert.equal(mobileCatalogs.es['mobile.setting.compact'], 'Configuración compacta');
  assert.equal(mobileCatalogs.es['mobile.setting.comfortable'], 'Configuración cómoda');
  assert.match(mobile, /ACADEMY_LOCAL_API_HTTP_ERROR/);
  assert.match(mobile, /ACADEMY_LOCAL_API_ABORTED/);
  assert.match(academy, /createScopedRouteHosts/);
  assert.match(academy, /data-profile-data/);
  assert.match(academy, /data-lesson-capability/);
  assert.match(academy, /data-lesson-example/);
  assert.match(academy, /createLocalApiRequest/);
});
