import { readFile } from 'node:fs/promises';
import path from 'node:path';

function extractTagName(source) {
  const match = /customElements\.define\(\s*['"]([^'"]+)['"]/.exec(source);
  return match?.[1];
}

function extractClassName(source) {
  const match = /export\s+class\s+([A-Za-z0-9_]+)\s+extends/.exec(source) || /class\s+([A-Za-z0-9_]+)\s+extends/.exec(source);
  return match?.[1];
}

function extractSuperclass(source) {
  const match = /extends\s+([A-Za-z0-9_]+)/.exec(source);
  return match?.[1];
}

function extractDescription(source) {
  const block = /\/\*\*\s*\n([\s\S]*?)\*\/\s*(?:export\s+)?(?:declare\s+)?class/.exec(source);
  if (block === null) return '';
  const lines = block[1].split('\n').map(line => line.replace(/^\s*\*\s?/, '').trim()).filter(Boolean);
  const nonTag = lines.filter(line => !line.startsWith('@'));
  return nonTag.join(' ').trim();
}

function extractMembers(source, className) {
  const members = [];
  const propertyMatch = /static\s+properties\s*=\s*\{([\s\S]*?)\};/.exec(source);
  if (propertyMatch !== null) {
    for (const match of propertyMatch[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*\{([\s\S]*?)\}/g)) {
      const name = match[1];
      const options = match[2];
      const reflect = /reflect:\s*true/.test(options);
      const attribute = reflect ? name : undefined;
      members.push({ kind: 'field', name, type: { text: 'any' }, ...(attribute === undefined ? {} : { attribute, reflects: true }) });
    }
  }
  for (const match of source.matchAll(/\*\*\s*([A-Za-z0-9 _]+)\.\s*\n\s*\*\/\s+([A-Za-z0-9_]+)\s*=\s*([^;\n]+)/g)) {
    const name = match[2];
    const value = match[3].trim();
    const description = match[1].trim();
    if (members.some(member => member.name === name)) continue;
    members.push({ kind: 'field', name, type: { text: typeof value === 'string' && value[0] === "'" ? 'string' : 'boolean' }, default: value, ...(description ? { description } : {}) });
  }
  for (const match of source.matchAll(/\/\*\*\s*([A-Za-z0-9 ]+)\.\s*\n\s*\*\/\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g)) {
    const name = match[2];
    const description = match[1].trim();
    if (members.some(member => member.name === name)) continue;
    members.push({ kind: 'method', name, ...(description ? { description } : {}) });
  }
  if (className !== undefined && !members.some(member => member.name === 'render')) {
    if (/render\(\)\s*\{/.test(source)) members.push({ kind: 'method', name: 'render' });
  }
  return members;
}

function extractEvents(source) {
  const events = [];
  for (const match of source.matchAll(/@fires\s+([A-Za-z0-9_-]+)\s*-\s*([^\n]+)/g)) {
    events.push({ name: match[1], type: { text: 'Event' }, description: match[2].trim() });
  }
  for (const match of source.matchAll(/dispatchEvent\(new CustomEvent\(['"]([^'"]+)['"]/g)) {
    if (!events.some(event => event.name === match[1])) events.push({ name: match[1], type: { text: 'CustomEvent' } });
  }
  return events;
}

function extractSlots(source) {
  const slots = [];
  const block = /\/\*\*\s*\n([\s\S]*?)\*\/\s*(?:export\s+)?(?:declare\s+)?class/.exec(source);
  if (block !== null) {
    for (const match of block[1].matchAll(/@slot\s+([^\n]*)/g)) {
      let rest = match[1].trim();
      if (rest.startsWith('- ')) {
        slots.push({ name: '', description: rest.slice(2).trim() });
        continue;
      }
      const dash = rest.indexOf(' - ');
      if (dash === -1) {
        slots.push({ name: rest, description: '' });
        continue;
      }
      const name = rest.slice(0, dash).trim();
      slots.push({ name, description: rest.slice(dash + 3).trim() });
    }
  }
  if (slots.length === 0 && /<slot/.test(source)) slots.push({ name: '', description: '' });
  return slots;
}

function extractCssProperties(source) {
  const cssProperties = [];
  const block = /\/\*\*\s*\n([\s\S]*?)\*\/\s*(?:export\s+)?(?:declare\s+)?class/.exec(source);
  if (block !== null) {
    for (const match of block[1].matchAll(/@cssprop(?:erty)?\s+(--[A-Za-z0-9-]+)\s*-\s*([^\n]+)/g)) {
      cssProperties.push({ name: match[1], description: match[2].trim() });
    }
  }
  return cssProperties;
}

function extractCssParts(source) {
  const cssParts = [];
  const block = /\/\*\*\s*\n([\s\S]*?)\*\/\s*(?:export\s+)?(?:declare\s+)?class/.exec(source);
  if (block !== null) {
    for (const match of block[1].matchAll(/@csspart\s+([A-Za-z0-9-]+)\s*-\s*([^\n]+)/g)) {
      cssParts.push({ name: match[1], description: match[2].trim() });
    }
  }
  return cssParts;
}

function declarationFor(source) {
  const className = extractClassName(source);
  const tagName = extractTagName(source);
  if (className === undefined) return undefined;
  const declaration = {
    kind: 'class',
    name: className,
    ...(extractDescription(source) ? { description: extractDescription(source) } : {})
  };
  const superclass = extractSuperclass(source);
  if (superclass !== undefined) declaration.superclass = { name: superclass, ...(superclass === 'LitElement' ? { package: 'lit' } : {}) };
  const members = extractMembers(source, className);
  if (members.length > 0) declaration.members = members;
  const attributes = members.filter(member => member.kind === 'field' && member.attribute !== undefined)
    .map(member => ({ name: member.attribute, type: member.type, default: member.default, fieldName: member.name }));
  if (attributes.length > 0) declaration.attributes = attributes;
  const events = extractEvents(source);
  if (events.length > 0) declaration.events = events;
  const slots = extractSlots(source);
  if (slots.length > 0) declaration.slots = slots;
  const cssProperties = extractCssProperties(source);
  if (cssProperties.length > 0) declaration.cssProperties = cssProperties;
  const cssParts = extractCssParts(source);
  if (cssParts.length > 0) declaration.cssParts = cssParts;
  if (tagName !== undefined) {
    declaration.tagName = tagName;
    declaration.customElement = true;
  }
  return declaration;
}

/**
 * Minimal public-API-shaped fake for @custom-elements-manifest/analyzer's
 * `create({ modules, plugins, context })`. It reads each module's source file
 * and derives a realistic manifest, mirroring the schema the public analyzer
 * emits. The source layout mirrors the real analyzer contract so the adapter
 * is unchanged when the real package is injected in Task 13/15/16.
 */
export function createFakeAnalyzer({ fail = false } = {}) {
  return {
    ts: {
      ScriptTarget: { ESNext: 99 },
      ScriptKind: { JS: 1, TS: 2 },
      createSourceFile(fileName, source, scriptTarget, setParentNodes, scriptKind) {
        return Object.freeze({ fileName, scriptTarget, scriptKind });
      }
    },
    async create({ modules }) {
      if (fail) throw new Error('fake-cem-analyzer-failure');
      const manifest = { schemaVersion: '1.0.0', readme: '', modules: [] };
      for (const module of modules) {
        const relative = typeof module.fileName === 'string' ? module.fileName : String(module.fileName ?? '');
        let source = '';
        try {
          source = await readFile(relative, 'utf8');
        } catch {
          source = '';
        }
        const moduleDoc = { kind: 'javascript-module', path: relative, declarations: [], exports: [] };
        const declaration = declarationFor(source);
        if (declaration !== undefined) moduleDoc.declarations.push(declaration);
        if (declaration?.tagName !== undefined) {
          moduleDoc.exports.push({
            kind: 'custom-element-definition',
            name: declaration.tagName,
            declaration: { name: declaration.name, module: relative }
          });
        }
        manifest.modules.push(moduleDoc);
      }
      return manifest;
    }
  };
}

export async function readFixtureManifest(root) {
  return JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8'));
}
