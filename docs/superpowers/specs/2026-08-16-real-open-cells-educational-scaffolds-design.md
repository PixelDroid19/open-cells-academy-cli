# Real Open Cells Educational Scaffolds Design

## Objective

Academy must generate authentic Open Cells applications and components that
teach the project structure, runtime boundaries, command vocabulary, and
development lifecycle used by Open Cells CLI 4 and CLI 5 projects.

The existing CLI runtime already operates both project families. This change
does not replace the working build, serve, test, locale, or TUI adapters. It
changes creation so a new learner receives a real Open Cells project rather
than a parallel Academy-only application architecture.

## Source Authority

- Public Open Cells documentation defines Bridge, routing, page lifecycle,
  channels, component APIs, internationalization, and testing semantics.
- CLI 4 and CLI 5 generated trees define filenames, dependency families,
  command spelling, configuration lookup, build roots, and test locations.
- Academy-owned UI elements remain visually neutral and never claim
  compatibility with an unrelated design system.

Generated files, documentation, comments, tests, and commits use only neutral
Open Cells and Academy terminology.

## Versioned Scaffold Selection

The existing `--scaffold` JSON object gains an optional `cellsVersion` field:

```json
{
  "name": "learning-app",
  "scaffold": "web-app",
  "cellsVersion": "5"
}
```

Accepted values are `"4"` and `"5"`; omission selects `"5"`. Interactive
creation asks for the target generation. The selected value is recorded in
`.open-cells-academy-recipe.json` and is never inferred from dependency
versions after publication.

Application profiles remain `blank`, `web-app`, `web-mobile-app`, and
`academy-app`. CLI 5 component creation emits the modern Lit profile. CLI 4
compatibility additionally exposes Polymer `component`, `behavior`,
`data-manager`, and `theme` profiles plus Lit 1 and Lit 3 through
`lit-component:create`.

Creation rejects an existing destination and publishes the complete project
atomically. Optional E2E material remains an overlay over the selected base.

## CLI 5 / Bridge 4 Application Contract

The default app is Bridge 4, Lit, ESM, and Vite. Its minimum tree is:

```text
app/
  config/dev.js
  config/prod.js
  data-managers/lesson-data-manager.js
  pages/catalog-page/catalog-page.js
  pages/lesson-page/lesson-page.js
  scripts/app.js
  scripts/app-module.js
  scripts/app-routes.js
  scripts/lit-initial-components.js
  scripts/lit-components.js
  styles/main.scss
  tpls/index.tpl
  locales-app/locales.json
  resources/
  vendor/
test/
  unit/
  e2e/                 # only when requested
```

The manifest uses compatible public releases of `@cells/cells-bridge` major
4 and `@cells/cells-page-mixin` major 2. `app/scripts/app.js` calls
`startBridge({ routes, mainNode, ...cells_properties, appConfig })`.

Routes are immutable records with `path`, `name`, `component`, and an async
`action` that imports the declared page. Pages extend
`CellsPageMixin(LitElement)`, end in `-page`, and render an Open Cells template
as their first-level element. Navigation uses route names and object params.

The teaching flow contains a catalog page at `/`, a lesson page at
`/lesson/:lessonId`, a public DOM event from catalog UI to its page, named
navigation with params, data loading in `onPageEnter()`, and subscription
cleanup in `onPageLeave()`. The data manager owns fixture/API orchestration;
pages own presentation and navigation.

## CLI 4 / Bridge 3 Application Contract

CLI 4 scaffolds are a distinct generated family because Bridge 3 and Bridge 4
are not runtime-compatible. A CLI 4 app uses the documented Bridge 3
dependency family, application templates, page definitions, configuration,
Composer mocks, Sass, locales, and development `dist` output.

`cells app:serve -c dev.js` performs this observable lifecycle:

```text
clean → template → composer-mocks → locales → sass → autoprefixer → copy
→ lit-element-bundles → eslint → htmllint → dependencies
→ in-app-elements → launch
```

Development serves `/dist/`. Production output remains under
`build/<config>/<build-kind>`. CLI 4 scaffolds do not import Bridge 4 APIs or
claim Bridge 4 compatibility.

## Application Channels And State

Pub/Sub is taught in app pages, not injected into standalone components.

- App-owned channel names live in one channel-contract module.
- Generated source never publishes to `__bridge*` or `__oc*` names.
- The publisher emits one documented payload shape.
- The consumer subscribes during page entry and unsubscribes during page
  leave.
- Tests prove latest-value delivery, no delivery after leave, and stable
  navigation state.
- Route params carry one-off navigation data instead of retained global state.

The previous Academy facade remains supported for already generated projects,
but new real Open Cells profiles never present its callback-cleanup API as the
native Bridge or Open Cells Core signature.

## Modern Component Contract

CLI 5 `component:create` generates a publishable Lit component:

```text
demo/
  basic.html
  demo.js
  demo-build.js
  index.html
  locales/locales.json
locales/locales.json
src/
  ExampleComponent.js
  example-component.scss
  example-component.css.js
test/unit/
  example-component.test.js
  locales/locales.json
index.js
example-component.js
index.html
custom-elements.json
README.md
package.json
```

`index.js` exports the class without global registration. The tag entry point
registers it. Package exports expose both surfaces. Template dependencies are
imported as classes and registered in `static scopedElements`.

Component-owned text uses `this.t(...)`; slotted content remains the caller's
localization responsibility. `IntlMsg` is installed before the component in
demos and tests. Tests await `loadUrlResourcesComplete` and `updateComplete`.
Locale keys remain in parity across root, demo, and test catalogs. SCSS is the
visual source and `.css.js` is the runtime style module.

Properties carry data down and public events carry interactions up. The
feature/widget profile also teaches an Academy-owned `WidgetMixin`, prefixed
`emitEvent(...)`, and scoped neutral UI elements. These are explicitly labeled
as teaching adapters, not native Bridge or design-system APIs.

## CLI 4 Component Contracts

The CLI exposes these historical commands as executable surfaces:

- `component:create`, `component:serve`, `component:test`, `component:lint`,
  `component:documentation`, `component:install`, and `component:changelog`
  for Polymer-era profiles.
- `lit-component:create`, `lit-component:serve`, `lit-component:test`,
  `lit-component:lint`, `lit-component:locales`, and
  `lit-component:documentation` for CLI 4 Lit profiles.

CLI 5 commands remain canonical for modern generated components. Compatibility
commands select the existing lifecycle adapter from project shape; they are
not help-only aliases.

## Testing And Locales

Generated app and component tests live under `test/unit`. Modern projects use
Vitest browser mode by default and retain `--wtr`. Legacy projects use their
documented runner selection.

The minimum generated tests prove route imports, initial and named navigation,
params, browser back, direct deep links, page enter/leave cleanup, retained
channel delivery, data-manager loading/success/error/cancellation, English and
Spanish rendering, scoped registration, public event semantics, documentation
generation, and rejection of reserved-channel publication.

Coverage meets the public Open Cells minimum of 80 percent for statements,
branches, functions, and lines. Academy may keep a stricter 100 percent gate
for small teaching modules when the generated manifest and README state it.

## Command And Help Contract

Root help groups current and compatibility vocabulary without hiding either.
Generated READMEs show only Cells-native commands for their selected family:
modern apps use `app:dev`; legacy apps use `app:serve`; modern components use
`component:*`; CLI 4 Lit components use `lit-component:*`.

## Safety And Release Contract

- Dependencies resolve only through the public npm registry or owned local
  package artifacts.
- Generated files contain no private registry, credential, absolute local
  path, or private product identity.
- Creation, build, locales, and test materialization remain workspace-contained
  and symlink-safe.
- Existing destination content is never overwritten.
- Generated docs make no unrelated design-system compatibility claims.
- The public tarball contains every recipe needed for offline self-scaffolding.

## Completion Evidence

Completion requires fresh empty-directory creation of all four CLI 5 app
profiles, CLI 4 `blank`/`web-app`/`web-mobile-app`, a CLI 5 component with and
without E2E, CLI 4 Lit 1 and Lit 3 components, and one CLI 4 Polymer profile.

Each applicable project must pass its Cells-native serve/build/test/locales or
documentation lifecycle. Browser evidence must prove route navigation, channel
state, language switching, HMR, and clean shutdown. Release evidence must prove
the globally installed and packed CLI create identical project structures.
