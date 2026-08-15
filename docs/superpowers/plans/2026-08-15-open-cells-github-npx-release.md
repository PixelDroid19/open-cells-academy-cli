# OpenCells Academy CLI GitHub and npx Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `cli/` as `PixelDroid19/open-cells-academy-cli` and prove that users can install it from GitHub or invoke it ephemerally to create runnable OpenCells apps and components.

**Architecture:** Keep the existing standalone ESM CLI and `cells` binary, align every package identity boundary on `open-cells-academy-cli`, and add a repository-level release contract around the existing package-self safety adapter. GitHub is the first distribution channel; the same package metadata remains ready for a later public npm release.

**Tech Stack:** Node.js 22.12+, npm package/exec, GitHub, native `node:test`, Vite, Lit, OpenCells Core.

## Global Constraints

- The public repository is `PixelDroid19/open-cells-academy-cli` on `main`.
- The npm package identity is `open-cells-academy-cli`; the executable remains `cells`.
- Public tracked files mention only OpenCells-facing behavior and contain no development-machine paths or private/comparison repository names.
- Dependencies and lockfile entries resolve only from the public npm registry.
- No unrelated local file is staged, deleted, or published.
- Every behavior change follows a witnessed RED then GREEN cycle.
- A material implementation requires independent review before push.

---

### Task 1: Public release contract

**Files:**
- Create: `test/security/public-release.test.js`
- Modify: `test/security/release-gates.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: repository root and npm package metadata.
- Produces: a deterministic `node:test` gate for public identity, tracked text, repository metadata, public registry URLs, and package allowlist.

- [ ] **Step 1: Write the failing public identity test**

Assert that `package.json`, `package-lock.json`, and `package-self-manifest.json`
all name `open-cells-academy-cli`; that `private` is absent; that repository,
license, homepage, bugs, and publish metadata are present; and that the bin is
exactly `{ cells: 'bin/cells.js' }`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-concurrency=1 test/security/public-release.test.js
```

Expected: FAIL on the current private package identity.

- [ ] **Step 3: Add tracked-tree release assertions**

Enumerate repository text while excluding `.git`, dependencies, build output,
coverage, and ignored historical local artifacts. Assert absence of absolute
development paths, private registries/scopes, credentials, and comparison
repository names. Assert all resolved lockfile URLs use
`https://registry.npmjs.org/`.

- [ ] **Step 4: Keep historical local-only artifacts untracked**

Add exact ignore entries for historical design/evidence and the local external
compatibility fixture. Do not use broad ignores that hide current source,
templates, public tests, or release documentation.

- [ ] **Step 5: Commit the gate**

```bash
git add .gitignore test/security/public-release.test.js test/security/release-gates.test.js
git commit -m "test: define public OpenCells release gate"
```

### Task 2: Public package identity and self-packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `package-self-manifest.json`
- Modify: `src/adapters/node/package-self.js`
- Modify: `test/integration/cli-tarball-dependency.test.js`
- Create: `LICENSE`

**Interfaces:**
- Consumes: package manifest schema and `NodePackageSelf.packSelf()`.
- Produces: `open-cells-academy-cli@0.1.0`, tarball filename `open-cells-academy-cli-0.1.0.tgz`, executable `cells`, and Apache-2.0 licensing metadata.

- [ ] **Step 1: Extend tarball tests for the new identity**

Change expected package/tarball identity to `open-cells-academy-cli@0.1.0` and
assert that packed metadata includes license, repository, homepage, bugs, and
public `publishConfig` without `private`.

- [ ] **Step 2: Run focused tarball tests and verify RED**

```bash
node --test --test-concurrency=1 test/integration/cli-tarball-dependency.test.js test/security/public-release.test.js
```

Expected: FAIL on the old package identity and private metadata.

- [ ] **Step 3: Align manifests and package-self constants**

Set version `0.1.0`, public metadata, the GitHub URLs, and the Apache-2.0
license. Remove private-name enumeration from archive scanning; retain generic
credential, private-host, unsafe-path, and executable validation.

- [ ] **Step 4: Refresh the lockfile without changing dependency versions**

```bash
npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org
```

Verify every `resolved` URL is public.

- [ ] **Step 5: Add the Apache-2.0 license text**

Create `LICENSE` from the standard Apache License 2.0 text and include it in the
package `files` allowlist and self-pack source allowlist.

- [ ] **Step 6: Run focused tests and commit**

```bash
node --test --test-concurrency=1 test/integration/cli-tarball-dependency.test.js test/security/public-release.test.js
git add package.json package-lock.json package-self-manifest.json LICENSE src/adapters/node/package-self.js test/integration/cli-tarball-dependency.test.js
git commit -m "feat: make the OpenCells CLI installable"
```

### Task 3: Newcomer documentation and clean public tree

**Files:**
- Replace: `README.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: neutral fixture names in public tests that contain private branding.

**Interfaces:**
- Consumes: supported CLI command registry and generated scaffold contracts.
- Produces: exact GitHub install, npx, app lifecycle, component lifecycle, i18n, scoped-elements, events, and contribution instructions.

- [ ] **Step 1: Add README assertions to the release test**

Assert the documented GitHub global install, ephemeral npm exec command, app
create/build/dev/preview commands, component create/test/build-demo/dev commands,
and OpenCells educational patterns.

- [ ] **Step 2: Run the public release test and verify RED**

Expected: FAIL because the current README documents only a checkout-local wrapper.

- [ ] **Step 3: Write the OpenCells-only README and notices**

Use executable commands, relative scaffold examples, non-endorsement wording,
and the exact supported lifecycle. Keep third-party facts limited to verified
public OpenCells dependencies.

- [ ] **Step 4: Neutralize public test fixtures**

Rename component fixture names/classes to `academy-*`/`Academy*`; express
security assertions generically. Preserve test behavior.

- [ ] **Step 5: Run docs, syntax, and release gates; commit**

```bash
node --test --test-concurrency=1 test/security/public-release.test.js test/security/release-gates.test.js test/integration/component-toolchain.test.js
git add README.md THIRD_PARTY_NOTICES.md test
git commit -m "docs: add the OpenCells Academy quick start"
```

### Task 4: Real local package and npx lifecycle

**Files:**
- Create: `test/integration/public-install-lifecycle.test.js`
- Modify: `package.json` only if a non-mutating release script is required.

**Interfaces:**
- Consumes: `npm pack` tarball.
- Produces: clean-directory proof for global-style install and ephemeral
`npm exec --package=<tarball> -- cells ...` app/component creation.

- [ ] **Step 1: Write the failing lifecycle contract**

The test packs the current project to an owned temporary directory, installs the
tarball with scripts disabled and the public registry, invokes the installed
`cells --version`/`--help`, then invokes npm exec from an empty directory to
create one blank app and one educational component from inline JSON scaffold
objects. It asserts local CLI dependencies and required generated files.

- [ ] **Step 2: Run and verify RED against old identity/documentation contract**

```bash
node --test --test-concurrency=1 test/integration/public-install-lifecycle.test.js
```

- [ ] **Step 3: Implement only the missing packaging boundary**

Correct package/bin inference, executable mode, packed metadata, or scaffold
self-dependency as demonstrated by the RED. Do not add a second CLI wrapper.

- [ ] **Step 4: Run the Cells-native generated-project gates**

Use the installed project-local binary:

```bash
./node_modules/.bin/cells app:test
./node_modules/.bin/cells app:build -c prod.js
./node_modules/.bin/cells component:test --coverage
./node_modules/.bin/cells component:build:demo
```

- [ ] **Step 5: Commit lifecycle coverage**

```bash
git add test/integration/public-install-lifecycle.test.js package.json src
git commit -m "test: verify packaged project creation"
```

### Task 5: Independent review and GitHub publication

**Files:**
- Review all tracked files and final commits.

**Interfaces:**
- Consumes: clean reviewed `main` and authenticated `gh` account.
- Produces: public GitHub repository, pushed `main`, and fresh installation proof from the remote URL.

- [ ] **Step 1: Run the full bounded release matrix**

Run all public contract/domain/security tests and integration tests that do not
depend on external unpublished fixtures. Run syntax checks, `npm pack --dry-run
--json`, public URL scan, repository reference scan, and process/port/residue
checks.

- [ ] **Step 2: Request independent adversarial review**

The reviewer inspects package identity, tarball contents, GitHub/npx commands,
tracked references, license/notices, generated self-dependency, and lifecycle
evidence. Resolve every material finding and rerun affected gates.

- [ ] **Step 3: Verify exact commit scope**

```bash
git status -sb
git log --oneline --decorate --max-count=10
git ls-files
node --test --test-concurrency=1 test/security/public-release.test.js
```

The release test owns the neutral forbidden-pattern set so private names never
need to appear in a shell command or commit message.

- [ ] **Step 4: Create and push the public GitHub repository**

```bash
gh repo create PixelDroid19/open-cells-academy-cli --public --source=. --remote=origin --push --description "Educational OpenCells CLI for creating runnable apps and Lit components"
```

- [ ] **Step 5: Verify installation from GitHub**

From a new owned temporary directory:

```bash
npm install --global https://github.com/PixelDroid19/open-cells-academy-cli/releases/download/v0.1.0/open-cells-academy-cli-0.1.0.tgz
npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- cells --version
npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- cells app:create --scaffold '{"name":"github-academy-app","scaffold":"blank"}'
```

Assert the app exists, contains the local CLI tarball/dependency, and the command
leaves no server or install process running.

- [ ] **Step 6: Report publication**

Return repository URL, branch, commit IDs, exact installation/npx commands,
validation counts, assumptions, and any npm-registry action still pending.
