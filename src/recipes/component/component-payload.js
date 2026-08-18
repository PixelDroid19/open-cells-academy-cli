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
    demoEventEmpty: `${name}.demo.event.empty`,
    demoCaseBasic: `${name}.demo.case.basic`,
    demoCaseBasicDescription: `${name}.demo.case.basic.description`,
    demoResolution: `${name}.demo.resolution`,
    demoViewport: `${name}.demo.viewport`,
    demoEvents: `${name}.demo.events`,
    demoEventsEmpty: `${name}.demo.events.empty`,
    demoCustomWidth: `${name}.demo.custom.width`,
    demoCustomHeight: `${name}.demo.custom.height`,
    demoApply: `${name}.demo.apply`
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
      [keys.demoResolution]: 'Viewport preset',
      [keys.demoViewport]: 'Demo viewport',
      [keys.demoEvents]: 'Events',
      [keys.demoEventsEmpty]: 'No events captured yet.',
      [keys.demoCustomWidth]: 'Width',
      [keys.demoCustomHeight]: 'Height',
      [keys.demoApply]: 'Apply'
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
      [keys.demoResolution]: 'Preajuste de viewport',
      [keys.demoViewport]: 'Viewport de demo',
      [keys.demoEvents]: 'Eventos',
      [keys.demoEventsEmpty]: 'Aún no se han capturado eventos.',
      [keys.demoCustomWidth]: 'Ancho',
      [keys.demoCustomHeight]: 'Alto',
      [keys.demoApply]: 'Aplicar'
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
    <academy-demo-helper events="${name}-continue">
      <academy-demo-case heading="Basic" description="A first component case with language and event controls." src="./basic.html"></academy-demo-case>
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
  return `const DEFAULT_LABELS = Object.freeze({
  caseBasic: 'Basic',
  caseBasicDescription: 'A first component case.',
  resolution: 'Viewport preset',
  viewport: 'Demo viewport',
  events: 'Events',
  eventsEmpty: 'No events captured yet.',
  customWidth: 'Width',
  customHeight: 'Height',
  apply: 'Apply'
});

const RESOLUTIONS = Object.freeze({
  responsive: Object.freeze({ width: '100%', height: '480px' }),
  desktop: Object.freeze({ width: '1024px', height: '720px' }),
  tablet: Object.freeze({ width: '768px', height: '900px' }),
  mobile: Object.freeze({ width: '390px', height: '844px' })
});

function safeLabels(value) {
  return value && typeof value === 'object' ? { ...DEFAULT_LABELS, ...value } : { ...DEFAULT_LABELS };
}

class AcademyDemoCase extends HTMLElement {
  static get observedAttributes() {
    return ['heading', 'description', 'src'];
  }
}

if (customElements.get('academy-demo-case') === undefined) {
  customElements.define('academy-demo-case', AcademyDemoCase);
}

class AcademyDemoHelper extends HTMLElement {
  constructor() {
    super();
    this.selected = 0;
    this.resolution = 'responsive';
    this.customViewportWidth = '';
    this.customViewportHeight = '';
    this.labels = safeLabels();
    this.events = [];
    this.cases = [];
    this.onMessage = event => {
      const iframe = this.querySelector('iframe');
      if (iframe === null || event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.source !== 'academy-demo') return;
      if (message.kind === 'labels') {
        this.labels = safeLabels(message.labels);
        if (this.cases[0] !== undefined) {
          this.cases[0].heading = this.labels.caseBasic;
          this.cases[0].description = this.labels.caseBasicDescription;
        }
        this.updateLabels();
        return;
      }
      if (message.kind !== 'event' || typeof message.eventType !== 'string') return;
      const allowed = (this.getAttribute('events') ?? '').split(',').map(value => value.trim()).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(message.eventType)) return;
      this.events = [{ type: message.eventType, detail: message.detail }, ...this.events].slice(0, 20);
      this.renderEvents();
    };
  }

  connectedCallback() {
    this.cases = [...this.querySelectorAll('academy-demo-case')].map(candidate => ({
      heading: candidate.getAttribute('heading') ?? this.labels.caseBasic,
      description: candidate.getAttribute('description') ?? '',
      src: candidate.getAttribute('src') ?? './basic.html'
    }));
    window.addEventListener('message', this.onMessage);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.onMessage);
  }

  viewport() {
    const preset = RESOLUTIONS[this.resolution] ?? RESOLUTIONS.responsive;
    return {
      width: this.customViewportWidth || preset.width,
      height: this.customViewportHeight || preset.height
    };
  }

  applyViewport() {
    const frame = this.querySelector('[data-demo-frame]');
    if (frame === null) return;
    const viewport = this.viewport();
    frame.style.width = viewport.width;
    frame.style.height = viewport.height;
    frame.setAttribute('aria-label', this.labels.viewport + ': ' + viewport.width + ' x ' + viewport.height);
  }

  selectCase(index) {
    this.selected = Math.max(0, Math.min(index, this.cases.length - 1));
    this.events = [];
    this.render();
  }

  renderEvents() {
    const list = this.querySelector('[data-demo-events]');
    if (list === null) return;
    list.replaceChildren();
    if (this.events.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = this.labels.eventsEmpty;
      list.append(empty);
      return;
    }
    for (const event of this.events) {
      const item = document.createElement('li');
      item.textContent = event.type + (event.detail === undefined ? '' : ' ' + JSON.stringify(event.detail));
      list.append(item);
    }
  }

  updateLabels() {
    const region = this.querySelector('[data-demo-region]');
    const cases = this.querySelector('[data-demo-cases]');
    const caseButton = this.querySelector('[data-case="0"]');
    const description = this.querySelector('[data-demo-description]');
    const resolution = this.querySelector('[data-resolution]');
    const width = this.querySelector('[data-width]');
    const height = this.querySelector('[data-height]');
    const apply = this.querySelector('[data-apply]');
    const viewport = this.querySelector('[data-demo-frame]');
    const eventsHeading = this.querySelector('[data-demo-events-heading]');
    if (region !== null) region.setAttribute('aria-label', this.labels.caseBasic);
    if (cases !== null) cases.setAttribute('aria-label', this.labels.caseBasic);
    if (caseButton !== null) caseButton.textContent = this.labels.caseBasic;
    if (description !== null) description.textContent = this.cases[0]?.description ?? this.labels.caseBasicDescription;
    if (resolution !== null) resolution.setAttribute('aria-label', this.labels.resolution);
    if (width !== null) width.setAttribute('aria-label', this.labels.customWidth);
    if (height !== null) height.setAttribute('aria-label', this.labels.customHeight);
    if (apply !== null) apply.textContent = this.labels.apply;
    if (viewport !== null) viewport.setAttribute('title', this.labels.viewport);
    if (eventsHeading !== null) eventsHeading.textContent = this.labels.events;
    this.applyViewport();
    this.renderEvents();
  }

  render() {
    const labels = this.labels;
    const selectedCase = this.cases[this.selected] ?? { heading: labels.caseBasic, description: labels.caseBasicDescription, src: './basic.html' };
    const buttons = this.cases.map((candidate, index) => '<button type="button" data-case="' + index + '" aria-pressed="' + (index === this.selected) + '">' + candidate.heading + '</button>').join('');
    this.innerHTML = '<style>' +
      ':host{display:block;color:#172554;font:16px/1.45 system-ui,sans-serif}.academy-demo{display:grid;gap:1rem;max-width:72rem;margin:0 auto;padding:1rem}.academy-demo-controls{display:flex;flex-wrap:wrap;gap:.75rem;align-items:end;padding:.75rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#f8fafc}.academy-demo-controls label{display:grid;gap:.25rem;font-size:.85rem}.academy-demo-controls input,.academy-demo-controls select,.academy-demo-controls button,.academy-demo nav button{font:inherit;padding:.45rem .65rem;border:1px solid #94a3b8;border-radius:.3rem;background:white}.academy-demo-controls button,.academy-demo nav button[aria-pressed="true"]{color:white;background:#0f766e;border-color:#0f766e}.academy-demo nav{display:flex;gap:.5rem;flex-wrap:wrap}.academy-demo-frame-wrap{display:grid;place-items:start;overflow:auto;min-height:12rem;padding:1rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#e2e8f0}.academy-demo-frame-wrap iframe{display:block;min-width:240px;max-width:none;border:0;background:white;box-shadow:0 1px 4px #0f172a33}aside{border-top:1px solid #cbd5e1}aside ol{min-height:2rem;padding-left:1.5rem}' +
      '</style><section class="academy-demo" data-demo-region aria-label="' + labels.caseBasic + '">' +
      '<nav data-demo-cases aria-label="' + labels.caseBasic + '">' + buttons + '</nav>' +
      '<div class="academy-demo-controls">' +
      '<label>' + labels.resolution + ' <select data-resolution aria-label="' + labels.resolution + '">' +
      '<option value="responsive">responsive</option><option value="desktop">desktop</option><option value="tablet">tablet</option><option value="mobile">mobile</option></select></label>' +
      '<label>' + labels.customWidth + ' <input data-width type="number" min="240" max="1920" placeholder="auto"></label>' +
      '<label>' + labels.customHeight + ' <input data-height type="number" min="240" max="1400" placeholder="auto"></label>' +
      '<button type="button" data-apply>' + labels.apply + '</button>' +
      '</div>' +
      '<p data-demo-description>' + selectedCase.description + '</p>' +
      '<div data-demo-frame-wrap><iframe data-demo-frame title="' + selectedCase.heading + '" src="' + selectedCase.src + '"></iframe></div>' +
      '<aside><h2 data-demo-events-heading>' + labels.events + '</h2><ol data-demo-events></ol></aside>' +
      '</section>';
    this.querySelector('[data-resolution]').value = this.resolution;
    this.querySelector('[data-width]').value = this.customViewportWidth;
    this.querySelector('[data-height]').value = this.customViewportHeight;
    for (const button of this.querySelectorAll('[data-case]')) {
      button.addEventListener('click', () => this.selectCase(Number(button.dataset.case)));
    }
    this.querySelector('[data-resolution]').addEventListener('change', event => {
      this.resolution = event.currentTarget.value;
      this.customViewportWidth = '';
      this.customViewportHeight = '';
      this.applyViewport();
    });
    this.querySelector('[data-apply]').addEventListener('click', () => {
      this.customViewportWidth = this.querySelector('[data-width]').value;
      this.customViewportHeight = this.querySelector('[data-height]').value;
      this.applyViewport();
    });
    this.applyViewport();
    this.renderEvents();
  }
}

if (customElements.get('academy-demo-helper') === undefined) {
  customElements.define('academy-demo-helper', AcademyDemoHelper);
}
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

function publishLabels() {
  window.parent.postMessage({
    source: 'academy-demo',
    kind: 'labels',
    labels: {
      caseBasic: intlMsg.t(${JSON.stringify(keys.demoCaseBasic)}),
      caseBasicDescription: intlMsg.t(${JSON.stringify(keys.demoCaseBasicDescription)}),
      resolution: intlMsg.t(${JSON.stringify(keys.demoResolution)}),
      viewport: intlMsg.t(${JSON.stringify(keys.demoViewport)}),
      events: intlMsg.t(${JSON.stringify(keys.demoEvents)}),
      eventsEmpty: intlMsg.t(${JSON.stringify(keys.demoEventsEmpty)}),
      customWidth: intlMsg.t(${JSON.stringify(keys.demoCustomWidth)}),
      customHeight: intlMsg.t(${JSON.stringify(keys.demoCustomHeight)}),
      apply: intlMsg.t(${JSON.stringify(keys.demoApply)})
    }
  }, window.location.origin);
}

function textElement(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

async function setLanguage(language) {
  intlMsg.lang = language;
  document.documentElement.lang = language;
  await intlMsg.loadUrlResourcesComplete;
  publishLabels();
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
    window.parent.postMessage({ source: 'academy-demo', kind: 'event', eventType: event.type, detail: event.detail }, window.location.origin);
  });
  controls.append(english, spanish);
  root.replaceChildren(title, controls, component, eventOutput);
  document.title = intlMsg.t(${JSON.stringify(keys.demoTitle)});
}

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

test('runs the generated demo cases, viewport controls, locale switch, and event capture', async ({ page }) => {
  await page.goto('/demo/');
  const helper = page.locator('academy-demo-helper');
  await expect(helper).toBeVisible();
  await expect(helper.locator('[data-case="0"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Viewport preset' }).selectOption('desktop');
  await expect(page.locator('iframe[data-demo-frame]')).toHaveCSS('width', '1024px');

  const demo = page.frameLocator('iframe[data-demo-frame]');
  await expect(demo.locator('${name}')).toBeVisible();
  await expect(demo.getByText('${name.replace(/-/g, ' ')} ready')).toBeVisible();
  await demo.getByRole('button', { name: 'Spanish' }).click();
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
