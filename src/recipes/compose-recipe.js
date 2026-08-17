import { createReadonlyMap } from '../domain/command-definition.js';
import { ScaffoldPlan } from '../domain/scaffold-plan.js';
import { typedError } from '../domain/workspace-session.js';
import { profileDefinition as academyAppProfile } from './app/academy-app.js';
import { profileDefinition as blankProfile } from './app/blank.js';
import { profileDefinition as webAppProfile } from './app/web-app.js';
import { profileDefinition as webMobileAppProfile } from './app/web-mobile-app.js';
import { createCapability } from './capabilities/index.js';
import { createApplicationPayload } from './app/app-payload.js';
import { profileDefinition as componentProfile } from './component/component.js';
import { createComponentPayload } from './component/component-payload.js';
export { applicationCapabilityOrder, componentCapabilityOrder } from './profile-definition.js';

export const profileRegistry = createReadonlyMap([
  [blankProfile.profile, blankProfile],
  [webAppProfile.profile, webAppProfile],
  [webMobileAppProfile.profile, webMobileAppProfile],
  [academyAppProfile.profile, academyAppProfile],
  [componentProfile.profile, componentProfile]
]);

const DEPENDENCY_FIELDS = Object.freeze({ runtime: 'dependencies', dev: 'devDependencies', optional: 'optionalDependencies', peer: 'peerDependencies' });
const CELLS_VERSIONS = new Set(['4', '5']);

function assertOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options) || typeof options.kind !== 'string' || typeof options.name !== 'string' || options.name.length === 0) {
    throw typedError('INVALID_INPUT', { field: 'recipe' });
  }
  if (options.e2e !== undefined && typeof options.e2e !== 'boolean') {
    throw typedError('INVALID_INPUT', { field: 'e2e' });
  }
  const cellsVersion = options.cellsVersion === undefined ? '5' : options.cellsVersion;
  if (typeof cellsVersion !== 'string' || !CELLS_VERSIONS.has(cellsVersion)) {
    throw typedError('INVALID_INPUT', { field: 'cellsVersion' });
  }
  if (options.localCli !== undefined) {
    const artifact = options.localCli;
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      typeof artifact.fileName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(artifact.fileName) ||
      !(artifact.content instanceof Uint8Array)
    ) {
      throw typedError('INVALID_INPUT', { field: 'localCli' });
    }
  }
  return Object.freeze({ ...options, cellsVersion, e2e: options.e2e ?? false });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function packageMetadata(options, dependencies) {
  const metadata = { name: options.packageName ?? options.name, private: true, version: '0.0.0', type: 'module' };
  const localName = options.localCli?.fileName ?? 'open-cells-academy-cli-0.1.0.tgz';
  const buckets = { dependencies: {}, devDependencies: { 'open-cells-academy-cli': `file:tools/${localName}` }, optionalDependencies: {}, peerDependencies: {} };
  for (const dependency of dependencies) {
    buckets[DEPENDENCY_FIELDS[dependency.kind]][dependency.name] = dependency.version;
  }
  for (const field of Object.values(DEPENDENCY_FIELDS)) {
    metadata[field] = Object.fromEntries(Object.entries(buckets[field]).sort(([left], [right]) => left.localeCompare(right)));
  }
  if (options.kind === 'app') {
    const bridge4 = options.cellsVersion === '5';
    metadata.scripts = {
      'academy:version': 'cells --version',
      build: 'vite build',
      dev: 'vite',
      lint: 'node scripts/validate-source.js',
      locales: 'node scripts/validate-locales.js',
      preview: 'vite preview',
      test: 'vitest run',
      'test:a11y': bridge4 ? 'vitest run test/unit' : 'vitest run test/app-accessibility.test.js'
    };
    if (options.e2e) metadata.scripts.e2e = 'playwright test';
  }
  if (options.kind === 'component') {
    metadata.scripts = {
      build: 'vite build',
      dev: 'vite',
      test: 'vitest run test/unit',
      'test:a11y': `vitest run test/unit/${options.name}-accessibility.test.js`
    };
    if (options.e2e) metadata.scripts.e2e = 'playwright test';
  }
  return metadata;
}

function applicationReadme() {
  return '# Cells Academy scaffold\n\nThis generated application uses `@open-cells/core@1.2.1` through an Academy-owned browser facade. Start the app once with a valid main node and named routes; navigate only by a declared route name.\n\nUse the local Cells workflow: `cells app:dev -c dev.js`, `cells app:build -c prod.js`, and `cells app:preview -c prod.js`.\n\nUse Academy channels in the form `academy:<appId>:<feature>:<event>`. The only supported publish option is `{ sessionStorage: true }`; unsupported options are rejected. Core retains the last published value, so a later subscriber receives it once. `subscribe` returns an idempotent cleanup function that stops later callbacks.\n\nThe Core runtime is browser-only: SSR and prerendering are unsupported and fail with an Academy diagnostic before browser-only runtime modules load. Task 5 does not register a service worker.\n';
}

function componentReadme() {
  return '# Cells Academy component\n\nThis generated component teaches independent Cells-style composition with `WidgetMixin(ScopedElementsMixin(LitElement))`. Its public host registers the Academy UI constructors in `static get scopedElements()`, keeping `academy-type-text` and `academy-button-default` out of the global custom-elements registry.\n\nComponent-owned labels use `this.t(...)`. Its public continuation action calls `this.emitEvent(\'continue\', { component: \'<component-name>\' })`, which emits the prefixed `<component-name>-continue` event with bubbling, composed, and cancelable defaults.\n\nThe identical EN/ES catalogs live at `locales/locales.json`, `demo/locales/locales.json`, and `test/unit/locales/locales.json`. The demo installs IntlMsg before loading the component and lets users switch English and Spanish.\n\nUse `cells component:test` for generated unit and accessibility tests, `cells component:test --coverage` for the 100% component-source coverage gate, `cells component:build:demo` to build the demo, and `cells component:dev` to serve it.\n';
}

function structuralFiles(options, capabilities, dependencies) {
  const declaration = {
    schema: 1,
    kind: options.kind,
    profile: options.profile,
    name: options.name,
    cellsVersion: options.cellsVersion,
    capabilities
  };
  if (options.namespace !== undefined) {
    declaration.namespace = options.namespace;
  }
  if (options.componentBase !== undefined) {
    declaration.componentBase = options.componentBase;
  }
  const bridge4Application = options.kind === 'app' && options.cellsVersion === '5';
  let plan = ScaffoldPlan.empty()
    .addDirectory('tools')
    .addFile('.open-cells-academy-recipe.json', stableJson(declaration))
    .addFile('package.json', stableJson(packageMetadata(options, dependencies)));
  if (!bridge4Application) {
    plan = plan.addFile('README.md', options.kind === 'component' ? componentReadme() : applicationReadme());
  }
  if (options.kind === 'app' && !bridge4Application) {
    plan = plan
      .addFile('scripts/validate-source.js', `import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(candidate));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(candidate);
  }
  return files;
}

for (const file of await collect(fileURLToPath(new URL('../src', import.meta.url)))) {
  const source = await readFile(file, 'utf8');
  if (/\\$bridge|backStep\\s*\\(/.test(source)) throw new Error('Unsupported raw Core API in generated source');
}
`)
      .addFile('scripts/validate-locales.js', `import { readFile } from 'node:fs/promises';

const catalogs = JSON.parse(await readFile(new URL('../src/app-messages.json', import.meta.url), 'utf8'));
const languages = Object.keys(catalogs);
if (languages.length !== 2 || !languages.includes('en') || !languages.includes('es')) throw new Error('Expected en/es catalogs');
const keys = Object.keys(catalogs.en);
if (keys.length === 0 || JSON.stringify(keys) !== JSON.stringify(Object.keys(catalogs.es))) throw new Error('Locale keys are not in parity');
for (const language of languages) for (const value of Object.values(catalogs[language])) if (typeof value !== 'string' || value.length === 0) throw new Error('Locale message is empty');
`);
  }
  if (options.localCli !== undefined) {
    plan = plan.addFile(`tools/${options.localCli.fileName}`, options.localCli.content);
  }
  return plan;
}

/**
 * Composes pure immutable capability declarations into the structural payload
 * currently owned by Task 4. No descriptor reads host state or writes disk.
 */
export function composeRecipe(profile, input = {}) {
  const options = assertOptions(input);
  const definition = profileRegistry.get(profile);
  if (definition === undefined || definition.kind !== options.kind) {
    throw typedError('INVALID_INPUT', { field: 'profile' });
  }
  const capabilities = [...definition.capabilities];
  if (options.e2e) {
    capabilities.push('e2e-playwright');
  }
  const declared = Object.freeze({ ...options, profile });
  let contribution = ScaffoldPlan.empty();
  for (const capability of capabilities) {
    contribution = contribution.merge(createCapability(capability, declared));
  }
  const profilePayload = declared.kind === 'app'
    ? createApplicationPayload(profile, declared)
    : declared.kind === 'component'
      ? createComponentPayload(declared)
      : ScaffoldPlan.empty();
  return structuralFiles(declared, capabilities, contribution.dependencies).merge(contribution).merge(profilePayload);
}
