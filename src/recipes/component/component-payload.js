import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { ACADEMY_DEMO_HELPER_SOURCE } from '../../../templates/components/academy-demo-helper-source.js';

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
    demoEventEmpty: `${name}.demo.event.empty`,
    demoCaseBasic: `${name}.demo.case.basic`,
    demoCaseBasicDescription: `${name}.demo.case.basic.description`,
    demoStatus: `${name}.demo.status`,
    demoLivePreview: `${name}.demo.live-preview`,
    demoEventIntro: `${name}.demo.event-intro`,
    demoInteractive: `${name}.demo.interactive`,
    demoDocumentation: `${name}.demo.documentation`,
    demoDocumentationDescription: `${name}.demo.documentation.description`,
    demoVisual: `${name}.demo.visual`,
    demoCode: `${name}.demo.code`,
    demoCaseLabel: `${name}.demo.case`,
    demoLanguageLabel: `${name}.demo.language`,
    demoHideUi: `${name}.demo.hide-ui`,
    demoShowUi: `${name}.demo.show-ui`,
    demoResolution: `${name}.demo.resolution`,
    demoViewport: `${name}.demo.viewport`,
    demoEvents: `${name}.demo.events`,
    demoEventLabel: `${name}.demo.events.label`,
    demoEventLatest: `${name}.demo.events.latest`,
    demoEventHistory: `${name}.demo.events.history`,
    demoClearEvents: `${name}.demo.events.clear`,
    demoExportEvents: `${name}.demo.events.export`,
    demoEventFilter: `${name}.demo.events.filter`,
    demoEventsEmpty: `${name}.demo.events.empty`,
    demoCustomWidth: `${name}.demo.custom.width`,
    demoCustomHeight: `${name}.demo.custom.height`,
    demoApply: `${name}.demo.apply`,
    demoResponsive: `${name}.demo.responsive`,
    demoFluid: `${name}.demo.fluid`,
    demoMobile: `${name}.demo.mobile`,
    demoTablet: `${name}.demo.tablet`,
    demoDesktop: `${name}.demo.desktop`,
    demoLargeDesktop: `${name}.demo.large-desktop`,
    demoOpen: `${name}.demo.open`,
    demoPatternLabel: `${name}.demo.pattern.label`,
    demoPatternDots: `${name}.demo.pattern.dots`,
    demoPatternGrid: `${name}.demo.pattern.grid`,
    demoPatternClean: `${name}.demo.pattern.clean`,
    demoBrandBadge: `${name}.demo.brand-badge`,
    demoCopy: `${name}.demo.copy`,
    demoCopied: `${name}.demo.copied`,
    demoScope: `${name}.demo.scope`,
    demoScopeDescription: `${name}.demo.scope.description`,
    demoApi: `${name}.demo.api`,
    demoApiDescription: `${name}.demo.api.description`,
    demoApiColumn: `${name}.demo.api-column`,
    demoContractColumn: `${name}.demo.contract-column`,
    demoEvidenceColumn: `${name}.demo.evidence-column`,
    demoHtmlSnippet: `${name}.demo.html-snippet`,
    demoJsSnippet: `${name}.demo.js-snippet`,
    demoNoCase: `${name}.demo.no-case`
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
      [keys.demoEventEmpty]: 'Activate the component to see its event.',
      [keys.demoCaseBasic]: 'Basic',
      [keys.demoCaseBasicDescription]: 'A first case with language, event, and scoped component controls.',
      [keys.demoStatus]: 'Interactive specimen',
      [keys.demoLivePreview]: 'Live preview',
      [keys.demoEventIntro]: 'Events emitted by the component appear here as an inspectable stream.',
      [keys.demoInteractive]: 'Interactive demo',
      [keys.demoDocumentation]: 'Documentation',
      [keys.demoDocumentationDescription]: 'A compact reference for the component contract used in this demo.',
      [keys.demoVisual]: 'Visual',
      [keys.demoCode]: 'Code',
      [keys.demoCaseLabel]: 'Case',
      [keys.demoLanguageLabel]: 'Language',
      [keys.demoHideUi]: 'Hide UI',
      [keys.demoShowUi]: 'Show UI',
      [keys.demoResolution]: 'Viewport preset',
      [keys.demoViewport]: 'Demo viewport',
      [keys.demoEvents]: 'Events',
      [keys.demoEventLabel]: 'Event:',
      [keys.demoEventLatest]: 'Latest event',
      [keys.demoEventHistory]: 'Event history',
      [keys.demoClearEvents]: 'Clear',
      [keys.demoExportEvents]: 'Export',
      [keys.demoEventFilter]: 'Filter events…',
      [keys.demoEventsEmpty]: 'No events captured yet.',
      [keys.demoCustomWidth]: 'Width',
      [keys.demoCustomHeight]: 'Height',
      [keys.demoApply]: 'Apply',
      [keys.demoResponsive]: 'Responsive',
      [keys.demoFluid]: 'Fluid',
      [keys.demoMobile]: 'Mobile',
      [keys.demoTablet]: 'Tablet',
      [keys.demoDesktop]: 'Desktop',
      [keys.demoLargeDesktop]: 'Large Desktop',
      [keys.demoOpen]: 'Open in new tab',
      [keys.demoPatternLabel]: 'Background:',
      [keys.demoPatternDots]: 'Dots',
      [keys.demoPatternGrid]: 'Grid',
      [keys.demoPatternClean]: 'Clean',
      [keys.demoBrandBadge]: 'SDK',
      [keys.demoCopy]: 'Copy',
      [keys.demoCopied]: 'Copied',
      [keys.demoScope]: 'Scoped composition',
      [keys.demoScopeDescription]: 'The component registers child controls in a local scoped registry.',
      [keys.demoApi]: 'Component contract',
      [keys.demoApiDescription]: 'Use public properties, translated labels and emitted events.',
      [keys.demoApiColumn]: 'API',
      [keys.demoContractColumn]: 'Cells contract',
      [keys.demoEvidenceColumn]: 'Demo evidence',
      [keys.demoHtmlSnippet]: 'HTML usage',
      [keys.demoJsSnippet]: 'JavaScript usage',
      [keys.demoNoCase]: 'No demo case available'
    }),
    es: Object.freeze({
      [keys.heading]: `${displayName} listo`,
      [keys.continue]: 'Continuar',
      [keys.demoTitle]: `Demostración de ${displayName}`,
      [keys.demoLanguageEn]: 'Inglés',
      [keys.demoLanguageEs]: 'Español',
      [keys.demoEvent]: 'Evento: {event}',
      [keys.demoEventEmpty]: 'Activa el componente para ver su evento.',
      [keys.demoCaseBasic]: 'Básico',
      [keys.demoCaseBasicDescription]: 'Un primer caso con idioma, eventos y controles de componentes aislados.',
      [keys.demoStatus]: 'Ejemplo interactivo',
      [keys.demoLivePreview]: 'Vista previa',
      [keys.demoEventIntro]: 'Los eventos emitidos por el componente aparecen aquí como un flujo inspeccionable.',
      [keys.demoInteractive]: 'Demo interactiva',
      [keys.demoDocumentation]: 'Documentación',
      [keys.demoDocumentationDescription]: 'Una referencia compacta del contrato del componente usado en esta demo.',
      [keys.demoVisual]: 'Visual',
      [keys.demoCode]: 'Código',
      [keys.demoCaseLabel]: 'Caso',
      [keys.demoLanguageLabel]: 'Idioma',
      [keys.demoHideUi]: 'Ocultar interfaz',
      [keys.demoShowUi]: 'Mostrar interfaz',
      [keys.demoResolution]: 'Preajuste de viewport',
      [keys.demoViewport]: 'Viewport de demo',
      [keys.demoEvents]: 'Eventos',
      [keys.demoEventLabel]: 'Evento:',
      [keys.demoEventLatest]: 'Último evento',
      [keys.demoEventHistory]: 'Historial de eventos',
      [keys.demoClearEvents]: 'Limpiar',
      [keys.demoExportEvents]: 'Exportar',
      [keys.demoEventFilter]: 'Filtrar eventos…',
      [keys.demoEventsEmpty]: 'Aún no se han capturado eventos.',
      [keys.demoCustomWidth]: 'Ancho',
      [keys.demoCustomHeight]: 'Alto',
      [keys.demoApply]: 'Aplicar',
      [keys.demoResponsive]: 'Adaptable',
      [keys.demoFluid]: 'Fluido',
      [keys.demoMobile]: 'Móvil',
      [keys.demoTablet]: 'Tableta',
      [keys.demoDesktop]: 'Escritorio',
      [keys.demoLargeDesktop]: 'Escritorio grande',
      [keys.demoOpen]: 'Abrir en una pestaña nueva',
      [keys.demoPatternLabel]: 'Fondo:',
      [keys.demoPatternDots]: 'Puntos',
      [keys.demoPatternGrid]: 'Retícula',
      [keys.demoPatternClean]: 'Limpio',
      [keys.demoBrandBadge]: 'SDK',
      [keys.demoCopy]: 'Copiar',
      [keys.demoCopied]: 'Copiado',
      [keys.demoScope]: 'Composición aislada',
      [keys.demoScopeDescription]: 'El componente registra sus controles secundarios en un registro local aislado.',
      [keys.demoApi]: 'Contrato del componente',
      [keys.demoApiDescription]: 'Usa propiedades públicas, etiquetas traducidas y eventos emitidos.',
      [keys.demoApiColumn]: 'API',
      [keys.demoContractColumn]: 'Contrato Cells',
      [keys.demoEvidenceColumn]: 'Evidencia en la demo',
      [keys.demoHtmlSnippet]: 'Uso en HTML',
      [keys.demoJsSnippet]: 'Uso en JavaScript',
      [keys.demoNoCase]: 'No hay casos de demo disponibles'
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
      <header>
        <span class="status">● \${this.t(${JSON.stringify(keys.demoCaseBasic)})}</span>
        <span class="identifier">#01</span>
      </header>
      <academy-type-text .text=\${this.t(${JSON.stringify(keys.heading)})}></academy-type-text>
      <slot></slot>
      <academy-button-default .text=\${this.t(${JSON.stringify(keys.continue)})} @click=\${this.notifyContinue}></academy-button-default>
    </article>\`;
  }
}
`;
}

const COMPONENT_STYLE_RULES = `  :host { display: block; width: min(100%, 35rem); color: #0f172a; font: 16px/1.5 "Plus Jakarta Sans", system-ui, sans-serif; }
  article { display: grid; gap: 1.75rem; border: 1px solid #e2e8f0; border-radius: 1.25rem; padding: 2rem; background: #fff; box-shadow: 0 10px 25px -12px rgb(15 23 42 / 22%); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .status, .identifier { display: inline-flex; align-items: center; border-radius: 999px; padding: .28rem .65rem; font-size: .72rem; font-weight: 700; }
  .status { border: 1px solid #a7f3d0; background: #ecfdf5; color: #047857; }
  .identifier { background: #f1f5f9; color: #475569; font-family: ui-monospace, monospace; }
  academy-type-text { display: block; font-size: clamp(1.55rem, 4vw, 2rem); font-weight: 700; letter-spacing: -.035em; }
  academy-button-default { display: block; width: 100%; }
  ::slotted(*) { margin: 0; color: #64748b; }`;

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

function rootIndexSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="0; url=demo/">
    <title>${name} demo</title>
  </head>
  <body></body>
</html>
`;
}

function demoIndexSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} demo</title>
  </head>
  <body>
    <academy-demo-helper component-tag="${name}" events="${name}-continue">
      <academy-demo-case heading="Basic" description="A first component case with language and event controls." heading-key="caseBasic" description-key="caseBasicDescription" src="./basic.html"></academy-demo-case>
    </academy-demo-helper>
    <script type="module" src="./demo-build.js"></script>
  </body>
</html>
`;
}

function basicDemoSource(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} basic demo</title>
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; min-width: 280px; min-height: 100%; background: transparent; }
      body { color: #0f172a; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
      main[data-demo-root] { min-height: 100vh; padding: clamp(1rem, 5vw, 3rem); display: grid; place-items: center; box-sizing: border-box; }
      .inner-demo { display: grid; width: min(100%, 35rem); }
      .inner-demo-event { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      ${name} { display: block; width: 100%; }
    </style>
  </head>
  <body>
    <script>
      window.IntlMsg = window.IntlMsg || {};
      window.IntlMsg.lang = document.documentElement.lang;
      window.IntlMsg.localesHost = '.';
    </script>
    <main data-demo-root></main>
    <script type="module" src="./demo.js"></script>
  </body>
</html>
`;
}

function demoBuildSource() {
  return `import './academy-demo-helper.js';
`;
}

export function demoHelperSource() {
  return ACADEMY_DEMO_HELPER_SOURCE;
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

function publishLabels() {
  window.parent.postMessage({
    source: 'academy-demo',
    kind: 'labels',
    language: document.documentElement.lang,
    labels: {
      title: intlMsg.t(${JSON.stringify(keys.demoTitle)}),
      status: intlMsg.t(${JSON.stringify(keys.demoStatus)}),
      caseBasic: intlMsg.t(${JSON.stringify(keys.demoCaseBasic)}),
      caseBasicDescription: intlMsg.t(${JSON.stringify(keys.demoCaseBasicDescription)}),
      livePreview: intlMsg.t(${JSON.stringify(keys.demoLivePreview)}),
      eventIntro: intlMsg.t(${JSON.stringify(keys.demoEventIntro)}),
      interactive: intlMsg.t(${JSON.stringify(keys.demoInteractive)}),
      documentation: intlMsg.t(${JSON.stringify(keys.demoDocumentation)}),
      documentationDescription: intlMsg.t(${JSON.stringify(keys.demoDocumentationDescription)}),
      visual: intlMsg.t(${JSON.stringify(keys.demoVisual)}),
      code: intlMsg.t(${JSON.stringify(keys.demoCode)}),
      caseLabel: intlMsg.t(${JSON.stringify(keys.demoCaseLabel)}),
      languageLabel: intlMsg.t(${JSON.stringify(keys.demoLanguageLabel)}),
      languageEn: intlMsg.t(${JSON.stringify(keys.demoLanguageEn)}),
      languageEs: intlMsg.t(${JSON.stringify(keys.demoLanguageEs)}),
      hideUi: intlMsg.t(${JSON.stringify(keys.demoHideUi)}),
      showUi: intlMsg.t(${JSON.stringify(keys.demoShowUi)}),
      resolution: intlMsg.t(${JSON.stringify(keys.demoResolution)}),
      viewport: intlMsg.t(${JSON.stringify(keys.demoViewport)}),
      events: intlMsg.t(${JSON.stringify(keys.demoEvents)}),
      eventLabel: intlMsg.t(${JSON.stringify(keys.demoEventLabel)}),
      eventLatest: intlMsg.t(${JSON.stringify(keys.demoEventLatest)}),
      eventHistory: intlMsg.t(${JSON.stringify(keys.demoEventHistory)}),
      clearEvents: intlMsg.t(${JSON.stringify(keys.demoClearEvents)}),
      exportEvents: intlMsg.t(${JSON.stringify(keys.demoExportEvents)}),
      eventFilter: intlMsg.t(${JSON.stringify(keys.demoEventFilter)}),
      eventsEmpty: intlMsg.t(${JSON.stringify(keys.demoEventsEmpty)}),
      customWidth: intlMsg.t(${JSON.stringify(keys.demoCustomWidth)}),
      customHeight: intlMsg.t(${JSON.stringify(keys.demoCustomHeight)}),
      apply: intlMsg.t(${JSON.stringify(keys.demoApply)}),
      responsive: intlMsg.t(${JSON.stringify(keys.demoResponsive)}),
      fluid: intlMsg.t(${JSON.stringify(keys.demoFluid)}),
      mobile: intlMsg.t(${JSON.stringify(keys.demoMobile)}),
      tablet: intlMsg.t(${JSON.stringify(keys.demoTablet)}),
      desktop: intlMsg.t(${JSON.stringify(keys.demoDesktop)}),
      largeDesktop: intlMsg.t(${JSON.stringify(keys.demoLargeDesktop)}),
      open: intlMsg.t(${JSON.stringify(keys.demoOpen)}),
      patternLabel: intlMsg.t(${JSON.stringify(keys.demoPatternLabel)}),
      patternDots: intlMsg.t(${JSON.stringify(keys.demoPatternDots)}),
      patternGrid: intlMsg.t(${JSON.stringify(keys.demoPatternGrid)}),
      patternClean: intlMsg.t(${JSON.stringify(keys.demoPatternClean)}),
      brandBadge: intlMsg.t(${JSON.stringify(keys.demoBrandBadge)}),
      copy: intlMsg.t(${JSON.stringify(keys.demoCopy)}),
      copied: intlMsg.t(${JSON.stringify(keys.demoCopied)}),
      scope: intlMsg.t(${JSON.stringify(keys.demoScope)}),
      scopeDescription: intlMsg.t(${JSON.stringify(keys.demoScopeDescription)}),
      api: intlMsg.t(${JSON.stringify(keys.demoApi)}),
      apiDescription: intlMsg.t(${JSON.stringify(keys.demoApiDescription)}),
      apiColumn: intlMsg.t(${JSON.stringify(keys.demoApiColumn)}),
      contractColumn: intlMsg.t(${JSON.stringify(keys.demoContractColumn)}),
      evidenceColumn: intlMsg.t(${JSON.stringify(keys.demoEvidenceColumn)}),
      htmlSnippet: intlMsg.t(${JSON.stringify(keys.demoHtmlSnippet)}),
      jsSnippet: intlMsg.t(${JSON.stringify(keys.demoJsSnippet)}),
      noCase: intlMsg.t(${JSON.stringify(keys.demoNoCase)})
    }
  }, window.location.origin);
}

async function setLanguage(language) {
  intlMsg.lang = language;
  document.documentElement.lang = language;
  await intlMsg.loadUrlResourcesComplete;
  publishLabels();
  renderDemo();
}

function renderDemo() {
  const shell = document.createElement('section');
  shell.className = 'inner-demo';
  const component = document.createElement('${name}');
  const eventOutput = document.createElement('output');

  eventOutput.className = 'inner-demo-event';
  eventOutput.dataset.event = '';
  eventOutput.setAttribute('aria-live', 'polite');
  eventOutput.textContent = intlMsg.t(${JSON.stringify(keys.demoEventEmpty)});
  component.addEventListener('${name}-continue', event => {
    eventOutput.textContent = intlMsg.t(${JSON.stringify(keys.demoEvent)}, { event: event.type });
    window.parent.postMessage({ source: 'academy-demo', kind: 'event', eventType: event.type, detail: event.detail }, window.location.origin);
  });
  shell.append(component, eventOutput);
  root.replaceChildren(shell);
  document.title = intlMsg.t(${JSON.stringify(keys.demoTitle)});
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'academy-demo-host' || message.kind !== 'language') return;
  if (message.language !== 'en' && message.language !== 'es') return;
  void setLanguage(message.language);
});

publishLabels();
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

const executablePath = process.env.ACADEMY_PLAYWRIGHT_EXECUTABLE_PATH;
const channel = process.env.OPEN_CELLS_PLAYWRIGHT_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...(executablePath ? { launchOptions: { executablePath } } : { channel })
  },
  webServer: { command: 'cells component:dev --host 127.0.0.1 --port 4173 --strictPort --no-open', url: 'http://127.0.0.1:4173', reuseExistingServer: false }
});
`)
    .addFile('e2e/' + name + '.spec.js', `import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('runs the generated demo cases, viewport controls, locale switch, and event capture', async ({ page }) => {
  await page.goto('/demo/');
  const helper = page.locator('academy-demo-helper');
  await expect(helper).toBeVisible();
  await expect(helper.getByRole('combobox', { name: 'Case' })).toHaveCount(1);
  await helper.getByRole('button', { name: 'Desktop', exact: true }).click();
  await expect(helper.locator('[data-device-frame]')).toHaveCSS('width', '768px');

  const demo = page.frameLocator('iframe[data-demo-frame]');
  await expect(demo.locator('${name}')).toBeVisible();
  await expect(demo.getByText('${name.replace(/-/g, ' ')} ready')).toBeVisible();
  await helper.getByRole('tab', { name: 'Code' }).click();
  await expect(helper.locator('[data-code-view]')).toBeVisible();
  await helper.getByRole('tab', { name: 'Visual' }).click();
  await helper.getByRole('button', { name: 'Spanish' }).click();
  await expect(demo.locator('html[lang="es"]')).toHaveAttribute('lang', 'es');
  await expect(demo.getByText('${name.replace(/-/g, ' ')} listo')).toBeVisible();
  await demo.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('[data-demo-events] li')).toContainText('${name}-continue');
  await expect(demo.locator('[data-event]')).toHaveText('Evento: ${name}-continue');

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
    .addDependency('@web/test-runner', '0.19.0', 'dev')
    .addDependency('@web/test-runner-playwright', '0.11.0', 'dev')
    .addDependency('@web/test-runner-junit-reporter', '0.8.0', 'dev')
    .addFile('index.html', rootIndexSource(name))
    .addFile('index.js', `export { ${className} } from './src/${className}.js';\n`)
    .addFile(`${name}.js`, entrypointSource(name, className))
    .addFile(`src/${className}.js`, componentSource(name, className, keys))
    .addFile(`src/${name}.scss`, scssSource())
    .addFile(`src/${name}.css.js`, stylesSource())
    .addFile('custom-elements.json', customElementsManifestSource(name, className))
    .addFile('demo/basic.html', basicDemoSource(name))
    .addFile('demo/demo-build.js', demoBuildSource())
    .addFile('demo/academy-demo-helper.js', demoHelperSource())
    .addFile('demo/index.html', demoIndexSource(name))
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
