import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { academyCoreFacadeSource } from '../../../templates/capabilities/cells-core/academy-core-facade.js';
import { cellsCoreClientEntrypoint } from '../../../templates/capabilities/cells-core/main.js';
import { openCellsClientSource } from '../../../templates/capabilities/cells-core/open-cells-client.js';
import { dataManagerSource } from '../../../templates/capabilities/data-manager/data-manager.js';
import { messagesSource } from '../../../templates/capabilities/i18n/messages.js';
import { localApiClientSource } from '../../../templates/capabilities/local-api/local-api-client.js';
import { scopedHostsSource } from '../../../templates/capabilities/scoped-elements/scoped-hosts.js';
import { academyIntlMsgSource } from '../../../templates/capabilities/academy-widget/academy-intl-msg.js';
import { academyButtonDefaultSource } from '../../../templates/capabilities/academy-widget/academy-button-default.js';
import { academyTypeTextSource } from '../../../templates/capabilities/academy-widget/academy-type-text.js';
import { widgetMixinSource } from '../../../templates/capabilities/academy-widget/widget-mixin.js';

const DEFINITIONS = Object.freeze({
  'lit-runtime': Object.freeze({ dependencies: [['lit', '3.3.3', 'runtime']] }),
  'cells-config': Object.freeze({
    dependencies: [['@open-cells/core', '1.2.1', 'runtime'], ['lit', '3.3.3', 'runtime'], ['vite', '7.3.6', 'dev']],
    files: [
      ['src/main.js', cellsCoreClientEntrypoint],
      ['src/runtime/academy-core-facade.js', academyCoreFacadeSource],
      ['src/runtime/open-cells-client.js', openCellsClientSource]
    ]
  }),
  routing: Object.freeze({ dependencies: [] }),
  'cells-bridge-compat': Object.freeze({ dependencies: [] }),
  pubsub: Object.freeze({ dependencies: [] }),
  'data-manager': Object.freeze({
    dependencies: [],
    files: [['src/runtime/data-manager.js', dataManagerSource]]
  }),
  i18n: Object.freeze({
    dependencies: [],
    files: [
      ['src/capabilities/i18n/messages.js', messagesSource],
      ['src/runtime/academy-intl-msg.js', academyIntlMsgSource],
      ['src/mixins/WidgetMixin.js', widgetMixinSource],
      ['src/components/AcademyTypeText.js', academyTypeTextSource],
      ['src/components/AcademyButtonDefault.js', academyButtonDefaultSource]
    ]
  }),
  'scoped-elements': Object.freeze({
    dependencies: [['@open-wc/scoped-elements', '3.0.10', 'runtime'], ['@webcomponents/scoped-custom-element-registry', '0.0.10', 'runtime']],
    files: [['src/capabilities/scoped-elements/scoped-hosts.js', scopedHostsSource]]
  }),
  'sass-theme': Object.freeze({ dependencies: [['sass', '^1.80.0', 'dev']] }),
  'unit-browser-tests': Object.freeze({ dependencies: [['@vitest/coverage-v8', '3.2.4', 'dev'], ['happy-dom', '20.11.2', 'dev'], ['vitest', '^3.0.0', 'dev']] }),
  'accessibility-tests': Object.freeze({ dependencies: [['axe-core', '4.13.0', 'dev']] }),
  'e2e-playwright': Object.freeze({ dependencies: [['@axe-core/playwright', '^4.10.0', 'dev'], ['@playwright/test', '^1.50.0', 'dev']] }),
  'service-worker': Object.freeze({ dependencies: [] }),
  'local-api-fixtures': Object.freeze({
    dependencies: [],
    files: [['src/capabilities/local-api/local-api-client.js', localApiClientSource]]
  }),
  'component-demo': Object.freeze({ dependencies: [['vite', '7.3.6', 'dev']] }),
  'component-cem-docs': Object.freeze({ dependencies: [['@custom-elements-manifest/analyzer', '^0.10.0', 'dev']] })
});

const EMPTY_BRIDGE4_APPLICATION_CAPABILITY = Object.freeze({ dependencies: [] });
const BRIDGE4_APPLICATION_DEFINITIONS = Object.freeze({
  'lit-runtime': DEFINITIONS['lit-runtime'],
  'cells-config': Object.freeze({
    dependencies: [
      ['@open-cells/core', '1.2.1', 'runtime'],
      ['@open-cells/page-mixin', '1.2.4', 'runtime'],
      ['vite', '7.3.6', 'dev']
    ]
  }),
  routing: EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'cells-bridge-compat': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  pubsub: EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'data-manager': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  i18n: EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'scoped-elements': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'sass-theme': DEFINITIONS['sass-theme'],
  'unit-browser-tests': DEFINITIONS['unit-browser-tests'],
  'accessibility-tests': DEFINITIONS['accessibility-tests'],
  'e2e-playwright': DEFINITIONS['e2e-playwright'],
  'service-worker': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'local-api-fixtures': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'component-demo': EMPTY_BRIDGE4_APPLICATION_CAPABILITY,
  'component-cem-docs': EMPTY_BRIDGE4_APPLICATION_CAPABILITY
});

export const capabilityIdentifiers = Object.freeze(Object.keys(DEFINITIONS));

function assertIdentifier(identifier) {
  if (!Object.hasOwn(DEFINITIONS, identifier)) {
    throw typedError('INVALID_INPUT', { field: 'capability' });
  }
}

function assertOverrides(overrides) {
  if (overrides === undefined) {
    return;
  }
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw typedError('INVALID_INPUT', { field: 'capabilityOverrides' });
  }
}

function isBridge4Application(options) {
  return options?.kind === 'app' && options.cellsVersion === '5';
}

/**
 * Returns a declarative contribution only. Runtime/template payloads belong to
 * later tasks, so this descriptor deliberately has no host side effects.
 */
export function createCapability(identifier, options = {}) {
  assertIdentifier(identifier);
  assertOverrides(options.capabilityOverrides);
  const override = options.capabilityOverrides?.[identifier];
  if (override !== undefined && (override === null || typeof override !== 'object' || Array.isArray(override))) {
    throw typedError('INVALID_INPUT', { field: 'capabilityOverrides' });
  }
  const definition = isBridge4Application(options)
    ? BRIDGE4_APPLICATION_DEFINITIONS[identifier]
    : DEFINITIONS[identifier];
  let plan = ScaffoldPlan.empty();
  for (const [name, version, kind] of definition.dependencies) {
    plan = plan.addDependency(name, override?.[name] ?? version, kind);
  }
  for (const [file, content] of definition.files ?? []) {
    plan = plan.addFile(file, content);
  }
  return plan;
}
