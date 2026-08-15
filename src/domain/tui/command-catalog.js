import { createCommandRegistry } from '../../cli/command-registry.js';

const ALIAS_MAP = Object.freeze(
  new Map([
    ['lit-component:serve', 'component:dev'],
    ['lit-components:serve', 'component:dev'],
    ['lit-component:test', 'component:test'],
    ['lit-component:documentation', 'component:documentation'],
    ['lit-component:locales', 'component:locales'],
    ['lit-component:build:demo', 'component:build:demo'],
    ['lit-component:lint', 'component:lint']
  ])
);

const SHORTCUTS = Object.freeze({
  'app:dev': 's',
  'component:dev': 's',
  'app:test': 'u',
  'component:test': 'u',
  'app:build': 'b',
  'component:build:demo': 'b',
  'app:lint': null,
  'component:lint': null,
  'app:locales': 'i',
  'component:locales': 'i',
  'component:documentation': 'd',
  'app:preview': 'p',
  'app:create': '+',
  'component:create': '+',
  'app:install': null,
  'component:install': null,
  'app:changelog': null,
  'component:changelog': null,
  'component:sass': null
});

function deriveCategory(name) {
  if (name.startsWith('app:')) return 'app';
  if (name.startsWith('component:') || name.startsWith('lit-component:')) return 'component';
  return 'shared';
}

function buildCatalog() {
  const registry = createCommandRegistry();
  const list = [];
  for (const [name, definition] of registry.entries()) {
    const aliases = [];
    for (const [alias, canonical] of ALIAS_MAP.entries()) {
      if (canonical === name) {
        aliases.push(alias);
      }
    }
    list.push(
      Object.freeze({
        name,
        aliases: Object.freeze(aliases),
        summaryKey: definition.summaryKey,
        category: deriveCategory(name),
        shortcut: SHORTCUTS[name] ?? null,
        requiresWorkspace: definition.requiresWorkspace ?? true,
        options: definition.options ?? Object.freeze([])
      })
    );
  }
  return Object.freeze(list);
}

const CATALOG = buildCatalog();

/**
 * Returns the immutable list of all 19 canonical commands with metadata and compatibility aliases.
 * @returns {ReadonlyArray<Readonly<object>>}
 */
export function getCommandCatalog() {
  return CATALOG;
}

/**
 * Resolves a command by its canonical name or legacy alias.
 * @param {string} nameOrAlias
 * @returns {Readonly<object> | undefined}
 */
export function findCommand(nameOrAlias) {
  if (typeof nameOrAlias !== 'string' || nameOrAlias.length === 0) {
    return undefined;
  }
  const canonicalName = ALIAS_MAP.get(nameOrAlias) ?? nameOrAlias;
  return CATALOG.find(item => item.name === canonicalName);
}

/**
 * Filters the command catalog by search query and workspace compatibility.
 * @param {ReadonlyArray<Readonly<object>>} catalog
 * @param {string} query
 * @param {'app' | 'component' | 'all'} workspaceType
 * @returns {ReadonlyArray<Readonly<object>>}
 */
export function filterCommands(catalog, query = '', workspaceType = 'all') {
  const cleanQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const filtered = catalog.filter(item => {
    if (workspaceType === 'app' && item.category !== 'app' && item.category !== 'shared') {
      return false;
    }
    if (workspaceType === 'component' && item.category !== 'component' && item.category !== 'shared') {
      return false;
    }
    if (cleanQuery.length === 0) {
      return true;
    }
    return (
      item.name.toLowerCase().includes(cleanQuery) ||
      item.aliases.some(alias => alias.toLowerCase().includes(cleanQuery)) ||
      (item.shortcut !== null && item.shortcut.toLowerCase() === cleanQuery)
    );
  });
  return Object.freeze(filtered);
}
