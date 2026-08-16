# OpenCells Legacy Application Runtime Design

## Goal

Make the public OpenCells CLI run established Cells applications that use `app/index.html`, nested configuration files under `app/config/<market>/`, generated runtime configuration, application locales, and Sass-derived assets. Delivery is phased: serve first, then build, test, and locales.

## Compatibility Contract

- `cells app:serve -c co/web-dev.js` is a legacy alias of `cells app:dev -c co/web-dev.js`.
- `-c` accepts a relative JavaScript module path below `app/config/`, including nested market folders.
- Absolute paths, traversal, symlinks, non-regular files, and identity changes are rejected before configuration evaluation.
- CLI options override server values supplied by the selected application configuration.
- `CELLS_LITE_DEVELOPER`, `NODE_OPTIONS`, and other caller environment values reach the owned child runtime unchanged.
- The CLI never shells out to another Cells CLI and never requires a globally installed compatibility package.
- Runtime-generated configuration, templates, locales, and Sass outputs stay workspace-contained and use owned, validated publication paths.
- DEV and QA may run on different caller-selected ports and must close all owned processes after SIGINT or SIGTERM.

## Architecture

### Command normalization

The parser normalizes `app:serve` to the canonical immutable `app:dev` command before normal command parsing. Help keeps `app:dev` canonical and documents the compatibility alias.

### Trusted nested configuration

`config-loader.js` gains a nested relative-path resolver rooted at `app/config`. The resolver validates every segment, rejects symbolic links, captures file and ancestor identities, imports the selected CommonJS or ESM configuration, and revalidates identities after evaluation. The normalized result retains an immutable full legacy payload in addition to the existing server/app/locales/build projections.

### Legacy runtime adapter

A focused Vite adapter contribution builds the established application runtime without mutating source configuration or templates:

1. Select `app/` as the Vite root.
2. Provide the selected configuration when the application imports `app/config/app.config.js`.
3. Render `app/tpls/index.tpl` in memory when it exists; otherwise serve the existing `app/index.html`.
4. Materialize locale outputs through the existing locale planning/publishing boundary and expose them to the app runtime.
5. Compile application Sass through the existing Sass compiler boundary and watch valid source files.
6. Preserve Vite HMR, local URL reporting, strict-port behavior, and owned shutdown.

Generated Academy applications continue through their existing root-layout path. Legacy mode is selected only for an `app/` layout with a trusted application configuration and without an Academy application recipe marker.

### Later phases

- `app:build`: reuse the same configuration/template/locales/Sass preparation and atomically publish `build/<config-name>/` with resources, vendor assets, manifest, and locales.
- `app:test`: detect the application test contract, preserve WTR compatibility when declared, and keep test/coverage artifacts project-local.
- `app:locales`: expose the established locale aggregation contract directly, including nested config selection and bundle/per-language modes.

## Error Handling

- Unsupported alias or option errors remain parser errors.
- Invalid configuration paths return `CONFIG_INVALID` without exposing file contents.
- Runtime preparation failures return typed application errors and do not leave partial generated files.
- Port conflicts remain explicit when `--strictPort` is supplied.
- Shutdown failure is reported once and never becomes an unhandled rejection.

## Verification

Each phase starts with a causal RED test and ends with focused and regression GREEN runs. Serve acceptance requires two fresh real runs using the DEV and QA configurations, HTTP 200 for `/` and the Vite client, configuration-specific runtime evidence, an HMR event, exact SIGINT shutdown, and confirmed port release. Existing unrelated servers are never terminated.

## Non-goals

- No delegation to an external CLI executable.
- No source-specific compatibility hacks.
- No rewriting application-owned configuration or template files in place.
- No changes to the external acceptance application source.
