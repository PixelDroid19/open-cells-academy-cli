# OpenCells Academy CLI GitHub and npx Release Design

**Date:** 2026-08-15
**Status:** Approved for implementation
**Repository:** `PixelDroid19/open-cells-academy-cli`
**Package:** `open-cells-academy-cli`
**Executable:** `cells`

## Purpose

Publish the educational Cells command-line interface as a standalone public
GitHub repository that can create runnable OpenCells applications and Lit
components without requiring a preinstalled global command.

The public project must be self-contained, use public npm dependencies, describe
only OpenCells-facing behavior, and contain no local-machine paths or references
to private, historical, or comparison repositories.

## Distribution contract

The GitHub repository root is the current `cli/` directory. The package exposes
one executable:

```json
{
  "name": "open-cells-academy-cli",
  "bin": {
    "cells": "bin/cells.js"
  }
}
```

Users can choose either workflow:

```bash
npm install --global github:PixelDroid19/open-cells-academy-cli
cells --help
```

```bash
npx --yes --package=github:PixelDroid19/open-cells-academy-cli \
  cells app:create --scaffold app.json
```

The package will also be ready for a later public npm release as
`open-cells-academy-cli`, enabling `npx open-cells-academy-cli ...`. Publishing
to the npm registry is a separate external release action because it requires
public-registry credentials and package ownership.

## Public repository boundary

The repository contains the executable, source, templates, public tests,
documentation, lockfile, license, notices, and package metadata needed to build,
validate, and use the CLI. It excludes dependencies, generated output, local
evidence, machine-specific configuration, and historical implementation plans.

Every tracked text file must pass a release scan that rejects:

- absolute paths from the development machine;
- names or URLs of comparison or private repositories;
- private package scopes, registries, credentials, tokens, or internal hosts;
- claims that the package is private or usable only through a checkout-local
  wrapper.

OpenCells package names and public registry URLs are allowed. Generic security
rules must be expressed generically rather than enumerating private names.

## Package metadata

`package.json`, `package-lock.json`, and `package-self-manifest.json` use the
same name and version. The package is public and includes:

- an Apache-2.0 license;
- a concise OpenCells educational description;
- GitHub repository, issue, and homepage URLs;
- public keywords;
- a public npm `publishConfig`;
- the existing Node engine floor and `cells` bin;
- a `prepack` release gate that cannot mutate project source.

Generated applications and components continue to receive a project-local CLI
tarball, but their dependency points to `open-cells-academy-cli` and their
scripts resolve the local `cells` binary.

## Documentation

The root README is a newcomer-first guide covering:

1. prerequisites;
2. GitHub global installation;
3. one-shot `npx` usage;
4. app creation and its `test`, `build`, `dev`, and `preview` lifecycle;
5. component creation and its `test --coverage`, `build:demo`, and `dev`
   lifecycle;
6. the educational contracts: `WidgetMixin(ScopedElementsMixin(LitElement))`,
   scoped elements, `emitEvent`, `this.t`, EN/ES catalogs, and IntlMsg loading;
7. troubleshooting and contribution commands.

Documentation does not claim official OpenCells ownership or compatibility
beyond behavior verified by this repository.

## Verification

Release acceptance requires fresh evidence for all of the following:

1. package identity and public metadata are consistent;
2. the tracked-tree forbidden-reference scan returns no matches;
3. `npm pack --dry-run --json` contains only the intended allowlist;
4. a real tarball installs in a clean temporary directory;
5. the installed `cells --version` and `cells --help` work;
6. `npm exec --package=<tarball> -- cells app:create` creates an application;
7. `npm exec --package=<tarball> -- cells component:create` creates a component;
8. the generated projects resolve their local CLI and pass the bounded native
   Cells lifecycle gates already owned by this repository;
9. no test/server/install process, port, or temporary fixture remains;
10. an independent reviewer finds no material publication or npx defect.

After these gates pass, initialize `cli/` as the standalone Git root, commit only
the reviewed public tree with neutral OpenCells-focused messages, create the
public GitHub repository, push `main`, and verify installation from the pushed
GitHub URL in a new temporary directory.

## Non-goals

- Publishing to npm before public-registry credentials are verified.
- Claiming endorsement by the OpenCells maintainers.
- Preserving internal evidence files or historical comparison tests in the
  public Git history.
- Expanding the command surface beyond the currently supported Cells lifecycle.
