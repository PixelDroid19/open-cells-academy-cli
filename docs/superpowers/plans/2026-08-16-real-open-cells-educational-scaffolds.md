# Real Open Cells Educational Scaffolds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate authentic, runnable Open Cells CLI 4 and CLI 5 applications and components while preserving the existing dual-runtime command adapters.

**Architecture:** Creation selects an explicit immutable scaffold generation (`"4"` or `"5"`) and composes a version-specific payload behind the existing atomic publication boundary. CLI 5 payloads use Bridge 4, static Lit pages, Vite, and Vitest; CLI 4 payloads retain Bridge 3 trees, `dist` generation, and legacy command vocabulary. Shared Academy teaching UI remains neutral and is labeled as an adapter rather than native framework API.

**Tech Stack:** Node.js >=22.12, JavaScript ESM, Lit 3, public `@open-cells/core` and `@open-cells/page-mixin`, Vite 7, Vitest 3, Web Test Runner compatibility, Sass, Playwright E2E, native `node:test` for CLI repository contracts.

## Global Constraints

- Preserve every existing build, serve, preview, test, locale, TUI, path-safety, and transaction behavior unless a task explicitly strengthens its contract.
- Generated code, tests, docs, package metadata, and commits use only neutral Open Cells and Academy terminology.
- Generated dependency specs use only the public npm registry or an owned local CLI tarball.
- `cellsVersion` accepts exactly `"4"` or `"5"`; omission means `"5"`.
- CLI 5-compatible Academy apps declare the public Open Cells packages `@open-cells/core:1.2.1`, `@open-cells/page-mixin:1.2.4`, and Lit 3. They never impersonate the unavailable private-name packages.
- CLI 4 and CLI 5 scaffold payloads remain separate; never combine Bridge 3 and Bridge 4 imports in one generated app.
- Existing destinations are rejected and project publication remains atomic, workspace-contained, and symlink-safe.
- CLI repository tests use sequential native `node --test`; generated-project acceptance uses only `cells app:*`, `cells component:*`, or `cells lit-component:*` commands.
- Every production edit follows a witnessed RED, minimal GREEN, focused regression, and independent review.

---

### Task 1: Versioned Creation Contract And Public Command Families

**Files:**
- Modify: `src/application/shared/create-scaffold.js`
- Modify: `src/recipes/compose-recipe.js`
- Modify: `src/cli/command-registry.js`
- Modify: `src/cli/parse-argv.js`
- Modify: `src/domain/tui/command-catalog.js`
- Modify: `src/cli/composition.js`
- Test: `test/integration/create-project.test.js`
- Test: `test/contract/cli-kernel.test.js`
- Test: `test/domain/command-catalog.test.js`
- Test: `test/contract/all-commands-process.test.js`

**Interfaces:**
- Produces: normalized recipe options `{ kind, name, profile, cellsVersion, e2e, installDeps, ... }` where `cellsVersion` is frozen and always present.
- Produces: executable command records for `component:serve` and every documented `lit-component:*` surface.
- Consumes: the existing `composeRecipe(profile, options)` and composition handlers without changing atomic publication.

- [ ] **Step 1: Write failing creation-schema tests**

Add cases equivalent to:

```js
const modern = await createApp({ scaffold: { name: 'modern-app', scaffold: 'blank' } }, context);
assert.equal(modern.ok, true);
assert.equal((await generated(root, 'modern-app')).declaration.cellsVersion, '5');

const legacy = await createApp({
  scaffold: { name: 'legacy-app', scaffold: 'web-app', cellsVersion: '4' }
}, context);
assert.equal(legacy.ok, true);
assert.equal((await generated(root, 'legacy-app')).declaration.cellsVersion, '4');

for (const invalid of [4, 5, '3', '4.9', '5.1', '']) {
  const result = await createApp({ scaffold: { name: `invalid-${String(invalid)}`, scaffold: 'blank', cellsVersion: invalid } }, context);
  assert.equal(result.ok, false);
}
```

- [ ] **Step 2: Run the RED**

Run:

```bash
node --test --test-concurrency=1 test/integration/create-project.test.js test/contract/cli-kernel.test.js test/domain/command-catalog.test.js
```

Expected: failures for unknown `cellsVersion` and absent CLI 4 command records.

- [ ] **Step 3: Normalize the version without changing publication**

Add `cellsVersion` to known app/component fields, normalize omission to `"5"`, reject every other value, and include it in `.open-cells-academy-recipe.json`. Keep `create()` lock, packing, and `applyPlanAtomically()` unchanged.

- [ ] **Step 4: Register executable compatibility commands**

Register and dispatch:

```text
component:serve
lit-component:create
lit-component:serve
lit-component:test
lit-component:lint
lit-component:locales
lit-component:documentation
```

`component:serve` and `lit-component:serve` share the proven component dev adapter after project-shape inspection. Test/lint/locales/documentation share their existing handlers. `lit-component:create` constructs a component request with `cellsVersion:"4"`, `componentBase:"lit1"|"lit3"`, name, namespace, E2E, and install flags.

- [ ] **Step 5: Run focused GREEN**

```bash
node --test --test-concurrency=1 test/integration/create-project.test.js test/contract/cli-kernel.test.js test/domain/command-catalog.test.js test/contract/all-commands-process.test.js
```

Expected: all command grammar, help, alias, dispatch, schema, and collision tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/application/shared/create-scaffold.js src/recipes/compose-recipe.js src/cli/command-registry.js src/cli/parse-argv.js src/domain/tui/command-catalog.js src/cli/composition.js test/integration/create-project.test.js test/contract/cli-kernel.test.js test/domain/command-catalog.test.js test/contract/all-commands-process.test.js
git commit -m "feat(create): select Open Cells scaffold generation"
```

### Task 2: Authentic CLI 5 / Bridge 4 Application Payload

**Files:**
- Create: `src/recipes/app/bridge4-app-payload.js`
- Create: `templates/apps/bridge4/bridge4-sources.js`
- Modify: `src/recipes/app/app-payload.js`
- Modify: `src/recipes/capabilities/index.js`
- Modify: `src/recipes/compose-recipe.js`
- Test: `test/integration/bridge4-app-scaffold.test.js`
- Test: `test/integration/app-scaffold-lifecycle.test.js`

**Interfaces:**
- Consumes: normalized `cellsVersion:"5"`, existing app profile and local CLI artifact.
- Produces: `createBridge4ApplicationPayload(profile, options): ScaffoldPlan`.
- Produces: real `app/config`, `app/scripts`, `app/pages`, `app/data-managers`, `app/tpls`, `app/styles`, `app/locales-app`, and `test/unit` trees.

- [ ] **Step 1: Write structural RED tests**

Assert all CLI 5 profiles include the documented tree, dependency ranges, and route/page contracts:

```js
const files = fileMap(composeRecipe('web-app', { kind: 'app', name: 'routes-academy', cellsVersion: '5' }));
for (const required of [
  'app/config/dev.js',
  'app/config/prod.js',
  'app/tpls/index.tpl',
  'app/scripts/app.js',
  'app/scripts/app-module.js',
  'app/scripts/app-routes.js',
  'app/scripts/lit-initial-components.js',
  'app/scripts/lit-components.js',
  'app/pages/catalog-page/catalog-page.js',
  'app/pages/lesson-page/lesson-page.js',
  'app/data-managers/lesson-data-manager.js',
  'app/locales-app/locales.json',
  'test/unit/routes.test.js',
  'test/unit/channels.test.js'
]) assert.equal(files.has(required), true, required);
```

Assert `package.json` declares the public Open Cells Core/Page Mixin packages and does not expose the former Academy facade as native Bridge API.

- [ ] **Step 2: Run structural RED**

```bash
node --test --test-concurrency=1 test/integration/bridge4-app-scaffold.test.js test/integration/app-scaffold-lifecycle.test.js
```

Expected: required real Cells app files and dependencies are absent.

- [ ] **Step 3: Implement the Bridge 4 payload boundary**

Keep string/template material in `templates/apps/bridge4/bridge4-sources.js`; keep validation, profile branching, and `ScaffoldPlan` composition in `bridge4-app-payload.js`. Dispatch from the existing app payload only when `cellsVersion === "5"`.

Generate `startApp`, immutable routes with async `action`, `PageMixin(LitElement)` pages, named navigation with params, first-level template elements, and page lifecycle hooks.

- [ ] **Step 4: Implement app-owned channels and data manager**

Generate a channel contract for one public Academy progress channel. The catalog page publishes a documented payload; the lesson page subscribes on entry and unsubscribes on leave. Generate a nonvisual data manager with explicit loading, success, error, and cancellation events using local fixture data only.

- [ ] **Step 5: Implement real locales and tests**

Generate root app locales plus `test/unit/<config>/locales.json`. Every visible string uses the generated i18n surface. Generated tests assert routes, params, enter/leave cleanup, late latest-value delivery, data-manager states, and EN/ES parity.

- [ ] **Step 6: Run GREEN and existing app regression**

```bash
node --test --test-concurrency=1 test/integration/bridge4-app-scaffold.test.js test/integration/app-scaffold-lifecycle.test.js test/integration/app-runtime-capabilities.test.js
```

Expected: new Bridge 4 contract and existing profile/runtime regressions pass.

- [ ] **Step 7: Commit**

```bash
git add src/recipes/app/bridge4-app-payload.js templates/apps/bridge4/bridge4-sources.js src/recipes/app/app-payload.js src/recipes/capabilities/index.js src/recipes/compose-recipe.js test/integration/bridge4-app-scaffold.test.js test/integration/app-scaffold-lifecycle.test.js
git commit -m "feat(scaffold): generate Bridge 4 learning apps"
```

### Task 3: Authentic CLI 4 / Bridge 3 Application Payload

**Files:**
- Create: `src/recipes/app/bridge3-app-payload.js`
- Create: `templates/apps/bridge3/bridge3-sources.js`
- Modify: `src/recipes/app/app-payload.js`
- Modify: `src/recipes/compose-recipe.js`
- Test: `test/integration/bridge3-app-scaffold.test.js`
- Test: `test/integration/legacy-app-serve.test.js`

**Interfaces:**
- Consumes: normalized `cellsVersion:"4"` and existing app profile.
- Produces: `createBridge3ApplicationPayload(profile, options): ScaffoldPlan` with no Bridge 4 imports.
- Reuses: the proven legacy `app:serve` dist builder and runtime adapter.

- [ ] **Step 1: Write Bridge-family isolation RED tests**

Assert a version-4 plan contains CLI 4 config/templates/scripts/styles/locales/tests and Bridge 3 dependency ranges, while no generated file imports `startBridge` or Page Mixin major 2. Assert a version-5 plan has the inverse dependency/runtime contract.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 test/integration/bridge3-app-scaffold.test.js test/integration/legacy-app-serve.test.js
```

Expected: version 4 currently receives the modern Academy payload.

- [ ] **Step 3: Implement neutral Bridge 3 source templates**

Generate `app/tpls/index.tpl`, config, bootstrap/module/routes, initial/deferred imports, Composer mock, Sass, locales, resources, vendor, pages, and test sources. Preserve the CLI 4 observable build inputs without copying private visual packages, endpoints, analytics, or business logic.

- [ ] **Step 4: Prove fresh dist generation and watch rebuild**

Extend legacy serve integration to materialize the newly generated version-4 app, build `dist`, serve `/dist/`, navigate its initial teaching route, modify an owned page source, and observe rebuilt output without losing the prior dist on failure.

- [ ] **Step 5: Run GREEN**

```bash
node --test --test-concurrency=1 test/integration/bridge3-app-scaffold.test.js test/integration/legacy-app-serve.test.js test/integration/app-toolchain.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/recipes/app/bridge3-app-payload.js templates/apps/bridge3/bridge3-sources.js src/recipes/app/app-payload.js src/recipes/compose-recipe.js test/integration/bridge3-app-scaffold.test.js test/integration/legacy-app-serve.test.js
git commit -m "feat(scaffold): generate Bridge 3 compatibility apps"
```

### Task 4: Complete Modern Open Cells Component Payload

**Files:**
- Modify: `src/recipes/component/component-payload.js`
- Modify: `src/recipes/compose-recipe.js`
- Test: `test/integration/component-scaffold-lifecycle.test.js`
- Test: `test/contract/all-commands-process.test.js`

**Interfaces:**
- Consumes: normalized component request with `cellsVersion:"5"`.
- Produces: documented modern component source, SCSS/CSS-JS, demo, locales, unit tests, exports, README, and CEM material.

- [ ] **Step 1: Write missing-tree RED tests**

Assert generated modern components include `demo/basic.html`, `demo/demo-build.js`, a root `index.html`, SCSS plus matching `.css.js`, root/demo/test locales, package `exports`, and generated documentation scripts. Assert `index.js` exports without registration and `<tag>.js` performs registration.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 test/integration/component-scaffold-lifecycle.test.js test/contract/all-commands-process.test.js
```

- [ ] **Step 3: Implement missing documented artifacts**

Extend the existing neutral Academy component instead of replacing its proven WidgetMixin/i18n/scoped behavior. Clearly label WidgetMixin and neutral UI as Academy teaching adapters. Preserve public event details and locale parity.

- [ ] **Step 4: Align coverage with documented contract**

Keep the existing stricter 100 percent generated-source gate and document that it exceeds the public 80 percent minimum. Ensure `component:test`, `component:test --coverage`, and `component:test --wtr` resolve through the CLI.

- [ ] **Step 5: Run GREEN**

```bash
node --test --test-concurrency=1 test/integration/component-scaffold-lifecycle.test.js test/contract/all-commands-process.test.js test/integration/test-commands.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/recipes/component/component-payload.js src/recipes/compose-recipe.js test/integration/component-scaffold-lifecycle.test.js test/contract/all-commands-process.test.js
git commit -m "feat(scaffold): complete modern Cells components"
```

### Task 5: CLI 4 Polymer And Lit Component Profiles

**Files:**
- Create: `src/recipes/component/legacy-component-payload.js`
- Create: `src/recipes/component/legacy-component-profiles.js`
- Modify: `src/recipes/compose-recipe.js`
- Modify: `src/application/shared/create-scaffold.js`
- Test: `test/integration/legacy-component-scaffold.test.js`
- Test: `test/contract/all-commands-process.test.js`

**Interfaces:**
- Consumes: `cellsVersion:"4"`, `componentBase:"lit1"|"lit3"`, or a Polymer profile name.
- Produces: separate immutable payloads for Polymer `component`/`behavior`/`data-manager`/`theme` and CLI 4 Lit 1/Lit 3.

- [ ] **Step 1: Write version/profile validation RED tests**

Reject Polymer profile names with version 5, invalid component bases, missing hyphens, invalid namespaces, and destination collisions. Prove valid CLI 4 Lit and Polymer requests select distinct trees.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 test/integration/legacy-component-scaffold.test.js test/integration/create-project.test.js test/contract/all-commands-process.test.js
```

- [ ] **Step 3: Implement CLI 4 Lit payloads**

Generate Lit 1 and Lit 3 manifests and documented root/src/demo/test/locales/SCSS/CSS-JS files. Keep runtime code neutral and public-registry compatible. Generated README commands use `lit-component:*`.

- [ ] **Step 4: Implement Polymer profile payloads**

Generate minimal executable Polymer component, behavior, data-manager, and theme trees with separate templates. Do not mix Polymer imports into Lit payloads. Generated README commands use `component:*`.

- [ ] **Step 5: Run GREEN**

```bash
node --test --test-concurrency=1 test/integration/legacy-component-scaffold.test.js test/integration/create-project.test.js test/contract/all-commands-process.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/recipes/component/legacy-component-payload.js src/recipes/component/legacy-component-profiles.js src/recipes/compose-recipe.js src/application/shared/create-scaffold.js test/integration/legacy-component-scaffold.test.js test/integration/create-project.test.js test/contract/all-commands-process.test.js
git commit -m "feat(scaffold): add CLI 4 component profiles"
```

### Task 6: Generated Lifecycle, TUI, Help, And Documentation Integration

**Files:**
- Modify: `src/application/tui/workspace-inspector.js`
- Modify: `src/application/tui/tui-controller.js`
- Modify: `src/adapters/terminal/terminal-renderer.js`
- Modify: `src/i18n/en.js`
- Modify: `src/i18n/es.js`
- Modify: `README.md`
- Test: `test/integration/workspace-inspector.test.js`
- Test: `test/integration/tui-supervisor-serve.test.js`
- Test: `test/domain/terminal-renderer.test.js`
- Test: `test/integration/public-install-lifecycle.test.js`

**Interfaces:**
- Consumes: generated recipe metadata and project-shape evidence.
- Produces: TUI/help commands appropriate to selected scaffold generation while retaining direct compatibility commands.

- [ ] **Step 1: Write project-detection RED tests**

Materialize one recipe from each generation and assert the inspector reports Bridge family, command vocabulary, config candidates, test runner choices, locale locations, and build roots without reading outside the workspace.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 test/integration/workspace-inspector.test.js test/integration/tui-supervisor-serve.test.js test/domain/terminal-renderer.test.js
```

- [ ] **Step 3: Integrate command presentation and dispatch**

Show current and compatibility commands with generation labels. TUI serve/build/test/locales actions select the command/config appropriate to the inspected project. Direct CLI commands remain valid regardless of TUI detection.

- [ ] **Step 4: Update public docs**

Document empty-directory creation, `cellsVersion`, each generated tree, current versus compatibility commands, Bridge-family isolation, Cells-native tests, and the neutral teaching-adapter boundary.

- [ ] **Step 5: Run GREEN**

```bash
node --test --test-concurrency=1 test/integration/workspace-inspector.test.js test/integration/tui-supervisor-serve.test.js test/domain/terminal-renderer.test.js test/integration/public-install-lifecycle.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/application/tui/workspace-inspector.js src/application/tui/tui-controller.js src/adapters/terminal/terminal-renderer.js src/i18n/en.js src/i18n/es.js README.md test/integration/workspace-inspector.test.js test/integration/tui-supervisor-serve.test.js test/domain/terminal-renderer.test.js test/integration/public-install-lifecycle.test.js
git commit -m "feat(tui): expose Open Cells project generations"
```

### Task 7: Fresh-Project Acceptance, Release, And Installation

**Files:**
- Create: `test/integration/real-cells-scaffold-acceptance.test.js`
- Modify: `test/security/public-release.test.js`
- Modify: `test/security/release-gates.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: every versioned recipe and command family from Tasks 1-6.
- Produces: fresh project lifecycle evidence and a public tarball containing all recipe sources.

- [ ] **Step 1: Add a bounded acceptance matrix**

Create projects from empty directories for CLI 5 app profiles, CLI 4 app profiles, CLI 5 component with/without E2E, CLI 4 Lit 1/Lit 3, and one Polymer component. Assert exact recipe metadata and trees before dependency installation.

- [ ] **Step 2: Execute Cells-native lifecycles sequentially**

For each applicable project, run its local packed CLI command with a verified free port and exact cleanup:

```text
cells app:dev -c dev.js
cells app:serve -c dev.js
cells app:build -c prod.js
cells app:test
cells app:test --wtr
cells app:locales -c dev.js
cells component:dev
cells component:test
cells component:test --coverage
cells component:test --wtr
cells component:locales
cells component:documentation
cells lit-component:serve
cells lit-component:test
cells lit-component:locales
cells lit-component:documentation
```

Skip a command only when the generated family's public contract does not define it; encode that absence explicitly in the acceptance table.

- [ ] **Step 3: Add browser acceptance**

Prove initial route, named navigation, direct deep link, browser back, channel replay, unsubscribe after leave, EN/ES switching, component demo interaction, HMR, and clean SIGINT shutdown. Capture screenshots only as supporting evidence.

- [ ] **Step 4: Run repository regression and release gates**

```bash
node --test --test-concurrency=1 test/contract/*.test.js test/domain/*.test.js test/integration/*.test.js test/security/*.test.js
npm run verify:release
npm pack --dry-run --json
```

Expected: zero failures, no private registry/identity/path matches, no stage/lock/process/port residue, and every new recipe file in the tarball manifest.

- [ ] **Step 5: Install and verify the packed CLI**

Install the exact produced tarball globally, confirm `cells --version`, repeat one CLI 5 app creation, one CLI 4 app creation, and one component creation, then remove only owned temporary projects and release artifacts.

- [ ] **Step 6: Commit**

```bash
git add test/integration/real-cells-scaffold-acceptance.test.js test/security/public-release.test.js test/security/release-gates.test.js README.md
git commit -m "test(release): verify real Open Cells scaffolds"
```
