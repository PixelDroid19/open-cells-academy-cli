import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { documentComponent } from '../../src/application/component/document-component.js';
import { MarkdownRenderer } from '../../src/adapters/cem/markdown-renderer.js';
import { CemAnalyzer } from '../../src/adapters/cem/cem-analyzer.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { createFakeAnalyzer } from '../fixtures/task-10-component-documentation/fake-analyzer.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-docs-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"docs-fixture","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

const LIT_COMPONENT_JS = `import { LitElement, html } from 'lit';

/**
 * A button component.
 *
 * @slot - Default slot.
 * @slot icon - Icon slot.
 *
 * @cssprop --academy-button-color - Button color.
 *
 * @csspart button - Inner button.
 *
 * @fires academy-action - Fired on action.
 */
export class AcademyButton extends LitElement {
  static properties = {
    label: { type: String, reflect: true },
    disabled: { type: Boolean }
  };

  /** Button label. */
  label = 'ok';

  disabled = false;

  /** Fires an action. */
  fireAction() {
    this.dispatchEvent(new CustomEvent('academy-action', { detail: this.label }));
  }

  render() {
    return html\`<button part="button"><slot></slot><slot name="icon"></slot></button>\`;
  }
}

customElements.define('academy-button', AcademyButton);
`;

const TYPED_COMPONENT_TS = `import { LitElement, html } from 'lit';

/** A typed badge component. */
export class AcademyBadge extends LitElement {
  /** @type {string} */
  declare text: string;

  /** @attr level - Severity level. */
  level: 'info' | 'warn' = 'info';

  fireChange(value: string) {
    this.dispatchEvent(new CustomEvent('academy-badge-change', { detail: value }));
  }

  render() {
    return html\`<span part="badge">\${this.text}</span>\`;
  }
}

customElements.define('academy-badge', AcademyBadge);
`;

function documentContext(session, filesystem, analyzer, overrides = {}) {
  return Object.freeze({ session, filesystem, analyzer, ...overrides });
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('red: document component writes a standards-conformant custom-elements.json and deterministic Markdown, idempotently', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/academy-button.js', LIT_COMPONENT_JS);
  await writeWorkspaceFile(root, 'src/academy-badge.ts', TYPED_COMPONENT_TS);
  const analyzer = createFakeAnalyzer();
  const result = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer)));

  assert.equal(result.destination, path.join(root, 'custom-elements.json'));
  const manifest = JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, '1.0.0');
  assert.ok(Array.isArray(manifest.modules));
  const buttonModule = manifest.modules.find(module => module.path.includes('academy-button'));
  const button = buttonModule.declarations.find(declaration => declaration.name === 'AcademyButton');
  assert.equal(button.tagName, 'academy-button');
  assert.equal(button.superclass.name, 'LitElement');
  assert.equal(button.events[0].name, 'academy-action');
  assert.equal(button.cssProperties[0].name, '--academy-button-color');
  assert.equal(button.cssParts[0].name, 'button');
  assert.deepEqual(button.slots.map(slot => slot.name), ['', 'icon']);
  assert.equal(button.members.find(member => member.name === 'label').attribute, 'label');

  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /academy-button/);
  assert.match(readme, /AcademyButton/);
  assert.match(readme, /--academy-button-color/);
  assert.match(readme, /academy-action/);
  assert.match(readme, /## CSS Shadow Parts/);
  assert.match(readme, /\| button \| Inner button\. \|/);

  const second = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer)));
  assert.equal(second.destination, path.join(root, 'custom-elements.json'));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8')), manifest);
  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), readme);
});

test('red: document component supports --noMd, a custom md file, and a custom manifest path', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/academy-button.js', LIT_COMPONENT_JS);
  const analyzer = createFakeAnalyzer();

  const noMd = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer), {
    options: Object.freeze({ noMd: true })
  }));
  await assert.rejects(lstat(path.join(root, 'README.md')), error => error?.code === 'ENOENT');
  assert.equal(noMd.destination, path.join(root, 'custom-elements.json'));

  const customMd = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer), {
    options: Object.freeze({ mdFile: 'docs/COMPONENTS.md' })
  }));
  const readme = await readFile(path.join(root, 'docs', 'COMPONENTS.md'), 'utf8');
  assert.match(readme, /academy-button/);

  const customManifest = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer), {
    options: Object.freeze({ manifestPath: 'docs/custom-elements.json', noMd: true })
  }));
  assert.equal(customManifest.destination, path.join(root, 'docs', 'custom-elements.json'));
  assert.equal(JSON.parse(await readFile(path.join(root, 'docs', 'custom-elements.json'), 'utf8')).schemaVersion, '1.0.0');
});

test('red: document component rejects traversal and absolute targets and a symlinked manifest destination', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/academy-button.js', LIT_COMPONENT_JS);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-docs-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const analyzer = createFakeAnalyzer();

  await assertCode(documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer), {
    options: Object.freeze({ mdFile: '../escape.md' })
  })), 'PATH_INVALID');
  await assertCode(documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer), {
    options: Object.freeze({ manifestPath: '/abs/custom-elements.json' })
  })), 'PATH_INVALID');

  await symlink(outside, path.join(root, 'custom-elements.json'));
  await assert.rejects(documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer))), error => {
    assert.ok(['DOC_MANIFEST_DEST_INVALID', 'DOC_SOURCE_INVALID', 'PATH_CHANGED', 'PATH_OUTSIDE_WORKSPACE', 'PATH_INVALID'].includes(error?.code));
    return true;
  });
});

test('red: document component propagates analyzer failure as a typed error without partial publication', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/academy-button.js', 'malformed ((){;\n');
  const analyzer = createFakeAnalyzer({ fail: true });
  await writeWorkspaceFile(root, 'custom-elements.json', '{"schemaVersion":"1.0.0","modules":[]}\n');

  await assertCode(documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer))), 'DOC_ANALYZER_FAILED');
  assert.equal(await readFile(path.join(root, 'custom-elements.json'), 'utf8'), '{"schemaVersion":"1.0.0","modules":[]}\n');
});

test('red: document component handles inheritance, examples, and malformed code without crashing and without partial publication', async t => {
  const { filesystem, root, session } = await workspace(t);
  const base = `import { LitElement } from 'lit';\n/**\n * Base element.\n */\nexport class BaseElement extends LitElement {\n  /** A shared property. */\n  shared = true;\n}\n`;
  const child = `import { BaseElement } from './base.js';\n/**\n * Child element.\n *\n * @example <my-child shared></my-child>\n */\nexport class MyChild extends BaseElement {\n  /** Child only. */\n  childOnly = 1;\n}\ncustomElements.define('my-child', MyChild);\n`;
  await writeWorkspaceFile(root, 'src/base.js', base);
  await writeWorkspaceFile(root, 'src/child.js', child);
  const analyzer = createFakeAnalyzer();
  const result = await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer)));
  const manifest = JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8'));
  const childModule = manifest.modules.find(module => module.path.includes('child'));
  assert.ok(childModule);
  const childDecl = childModule.declarations.find(declaration => declaration.name === 'MyChild');
  assert.equal(childDecl.superclass.name, 'BaseElement');
  assert.equal(childDecl.tagName, 'my-child');
  assert.equal(childDecl.customElement, true);
  assert.equal(result.destination, path.join(root, 'custom-elements.json'));

  const malformed = await workspace(t);
  await writeWorkspaceFile(malformed.root, 'src/broken.js', 'export class Broken { (() { not valid (;\n');
  await writeWorkspaceFile(malformed.root, 'custom-elements.json', '{"schemaVersion":"1.0.0","modules":[]}\n');
  const fakeAnalyzer = createFakeAnalyzer();
  const malformedResult = await documentComponent(documentContext(malformed.session, malformed.filesystem, new CemAnalyzer(fakeAnalyzer)));
  assert.equal(malformedResult.destination, path.join(malformed.root, 'custom-elements.json'));
  const malformedManifest = JSON.parse(await readFile(path.join(malformed.root, 'custom-elements.json'), 'utf8'));
  assert.equal(malformedManifest.schemaVersion, '1.0.0');
  assert.ok(Array.isArray(malformedManifest.modules));
  const md = await readFile(path.join(malformed.root, 'README.md'), 'utf8');
  assert.match(md, /No components were found/);
});

test('red: document component exposes events with detail and preserves declarations across multiple modules deterministically', async t => {
  const { filesystem, root, session } = await workspace(t);
  const first = `import { LitElement } from 'lit';\n/**\n * First element.\n *\n * @fires first-changed - Fired with detail.\n */\nexport class FirstEl extends LitElement {\n  /** @type {string} */\n  value = 'a';\n  fire() { this.dispatchEvent(new CustomEvent('first-changed', { detail: this.value })); }\n}\ncustomElements.define('first-el', FirstEl);\n`;
  const second = `import { LitElement } from 'lit';\n/** Second element. */\nexport class SecondEl extends LitElement {}\ncustomElements.define('second-el', SecondEl);\n`;
  await writeWorkspaceFile(root, 'src/first.js', first);
  await writeWorkspaceFile(root, 'src/second.js', second);
  const analyzer = createFakeAnalyzer();
  await documentComponent(documentContext(session, filesystem, new CemAnalyzer(analyzer)));
  const manifest = JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8'));
  assert.equal(manifest.modules.length, 2);
  const tags = manifest.modules.flatMap(module => (module.declarations ?? []).filter(d => d.tagName !== undefined).map(d => d.tagName));
  assert.deepEqual(tags.sort(), ['first-el', 'second-el']);
  const firstModule = manifest.modules.find(module => module.path.includes('first'));
  const event = firstModule.declarations[0].events[0];
  assert.equal(event.name, 'first-changed');
  assert.match(event.description, /detail/);
});

test('red: component documentation rejects a non-frozen context and an invalid analyzer before any side effect', async t => {
  const { filesystem, session } = await workspace(t);
  await assertCode(documentComponent({ session, filesystem, analyzer: { analyze() {} } }), 'DOC_REQUEST_INVALID');
  await assertCode(documentComponent(Object.freeze({ session, filesystem, analyzer: null })), 'DOC_ANALYZER_INVALID');
  await assertCode(documentComponent(Object.freeze({ session, filesystem, analyzer: { analyze() {} }, options: { noMd: 'yes' } })), 'DOC_REQUEST_INVALID');
});

test('red: markdown renderer is deterministic and escapes user content', async t => {
  const renderer = new MarkdownRenderer();
  const manifest = {
    schemaVersion: '1.0.0',
    readme: '',
    modules: [
      {
        kind: 'javascript-module',
        path: 'src/x.js',
        declarations: [
          {
            kind: 'class',
            name: 'XEl',
            description: 'Desc <script>alert(1)</script>',
            tagName: 'x-el',
            customElement: true,
            members: [
              { kind: 'field', name: 'evil', type: { text: 'string' }, default: '\'x\'', description: 'A <b>prop</b>' },
              { kind: 'method', name: 'go' }
            ],
            attributes: [{ name: 'evil', type: { text: 'string' } }],
            events: [{ name: 'x-go', description: 'Fires <i>go</i>' }],
            slots: [{ name: '', description: 'Default' }],
            cssProperties: [{ name: '--x-color', description: 'Color' }],
            cssParts: [{ name: 'inner', description: 'Inner' }]
          }
        ],
        exports: []
      }
    ]
  };
  const markdown = renderer.render(manifest);
  const again = renderer.render(manifest);
  assert.equal(markdown, again);
  assert.match(markdown, /x-el/);
  assert.doesNotMatch(markdown, /<script>alert\(1\)<\/script>/);
  assert.match(markdown, /&#60;script&#62;/);
});
