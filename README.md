# OpenCells Academy CLI

`open-cells-academy-cli` is an educational command-line interface for creating
runnable OpenCells applications and Lit components. Generated projects include
a project-local `cells` executable, public dependencies, English and Spanish
catalogs, tests, and development/build configuration.

This is an independent learning project. It is not an official OpenCells
distribution and does not claim endorsement by the OpenCells maintainers.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- Git for installation directly from GitHub

## Install from GitHub

Install the CLI globally:

```bash
npm install --global https://github.com/PixelDroid19/open-cells-academy-cli/releases/download/v0.1.0/open-cells-academy-cli-0.1.0.tgz
cells --version
cells --help
```

Or run it once without a global installation:

```bash
npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- cells --help
```

The equivalent `npx` form is:

```bash
npx --yes --package=github:PixelDroid19/open-cells-academy-cli cells --help
```

After a future npm registry release, the shorter command will be:

```bash
npx open-cells-academy-cli --help
```

## Interactive terminal

Run `cells` with no command, or explicitly run `cells tui`, from an interactive
terminal to open the Academy TUI. It is a command launcher and local task
supervisor; direct commands such as `cells component:test --coverage` keep
their existing non-interactive behavior.

```bash
cells
cells tui --no-animation
cells --language es tui
```

The TUI uses these shortcuts: `s` serve, `r` restart the active server, `u`
unit tests, `c` coverage, `e` E2E, `b` build, `p` preview, `i` locales, `d`
component documentation, `+` create, `o` open a ready local URL, `l` filter
logs, `/` search, `Tab` switch panels, `PgUp`/`PgDn` page logs, `Esc` cancel,
and `q` quit. `Ctrl-C` always restores the terminal and stops tasks owned by
the TUI.

The TUI is deliberately disabled for pipes, CI, and `TERM=dumb`; both `cells`
and `cells tui` print static localized help and exit successfully in those
environments. `NO_COLOR` removes renderer colors.

Legacy component aliases remain supported and resolve to their canonical
commands: `lit-component:serve` and `lit-components:serve` map to
`component:dev`; `lit-component:test`, `:documentation`, `:locales`,
`:build:demo`, and `:lint` map to the corresponding `component:*` command.

On POSIX, owned TUI tasks use an isolated process group. The Windows tree
cleanup seam is unit-tested with an injected `taskkill` operation; a physical
Windows runtime/Job Object validation is still pending, so this project does
not claim that level of Windows cleanup verification yet.

## Create an application

Create an empty directory and save this as `app.json`:

```json
{
  "name": "my-cells-app",
  "scaffold": "academy-app",
  "e2e": false
}
```

Run the generator from that directory:

```bash
cells app:create --scaffold app.json
cd my-cells-app
npm install --ignore-scripts --registry=https://registry.npmjs.org
```

Use the project-local Cells lifecycle:

```bash
cells app:test
cells app:build -c prod.js
cells app:dev -c dev.js --no-open --host 127.0.0.1 --port 8137
cells app:preview -c prod.js --host 127.0.0.1 --port 8138
```

Available application profiles are `blank`, `web-app`, `web-mobile-app`, and
`academy-app`. The Academy profile contains guided examples for routing,
publish/subscribe, data management, local APIs, scoped custom elements, events,
and i18n.

### Run an established Cells application

Applications with the established `app/` layout can select nested configuration
files below `app/config`. `app:serve` is retained as an alias of `app:dev`:

```bash
CELLS_LITE_DEVELOPER=true NODE_OPTIONS=--max_old_space_size=8192 \
  cells app:serve -c market/web-dev.js --host 127.0.0.1 --port 8001 --no-open
```

The selected configuration is provided to both module-based applications that
import `app/config/app.config.js` and older bootstrap-based applications that
read `window.AppConfig`. Template and configuration responses are generated in
memory; the CLI does not overwrite the application's `index.html`, bootstrap,
or generated config source while serving. Changes to the selected configuration
trigger a full Vite refresh.

The same nested profile is accepted by the remaining application lifecycle:

```bash
cells app:build -c market/web-dev.js
cells app:test
cells app:locales -c market/web-dev.js
```

`app:build` publishes to `build/market/web-dev`, including local scripts still
referenced by the generated HTML and the locale catalogs selected by the
configuration. `app:test` runs only tests owned by the application (never tests
inside vendored components or `node_modules`) and detects Web Test Runner when
the project declares it; otherwise it uses Vitest. A project with no owned unit
tests reports that condition instead of executing dependency tests. Running
`cells` in an interactive terminal discovers nested profiles such as
`market/web-dev.js` and makes them selectable from the TUI.

## Create a component

Save this as `component.json` in an empty directory:

```json
{
  "name": "academy-learning-card",
  "namespace": "academy",
  "e2e": false
}
```

Create and install it:

```bash
cells component:create --scaffold component.json
cd academy-learning-card
npm install --ignore-scripts --registry=https://registry.npmjs.org
```

Run the component lifecycle:

```bash
cells component:test --coverage
cells component:build:demo
cells component:dev --no-open --host 127.0.0.1 --port 8141
cells component:documentation
cells component:locales
```

The generated component teaches these contracts directly in its source:

```js
export class AcademyLearningCard extends WidgetMixin(ScopedElementsMixin(LitElement)) {
  static get scopedElements() {
    return {
      ...super.scopedElements,
      'academy-type-text': AcademyTypeText,
      'academy-button-default': AcademyButtonDefault,
    };
  }

  announceContinuation() {
    this.emitEvent('continue', { component: 'academy-learning-card' });
  }

  render() {
    return html`<academy-type-text>${this.t('academy-learning-card-title')}</academy-type-text>`;
  }
}
```

All component-owned visible text goes through `this.t(...)`. Identical EN/ES
catalogs are generated for runtime, demo, and tests. The demo initializes
`IntlMsg` before importing the component and waits for
`IntlMsg.loadUrlResourcesComplete` before rendering translated content.

## One-shot project creation

You can create a project directly with the GitHub package:

```bash
npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- \
  cells app:create --scaffold app.json

npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- \
  cells component:create --scaffold component.json
```

## Contributing

Install dependencies from the public registry and run the Cells-owned test
surfaces directly:

```bash
npm install --ignore-scripts --registry=https://registry.npmjs.org
node --test --test-concurrency=1 test/contract/*.test.js test/domain/*.test.js test/security/*.test.js
node --test --test-concurrency=1 test/integration/public-install-lifecycle.test.js
npm pack --dry-run --json --ignore-scripts
```

Please report issues at
[github.com/PixelDroid19/open-cells-academy-cli/issues](https://github.com/PixelDroid19/open-cells-academy-cli/issues).

## License

Apache-2.0. Third-party package facts are recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
