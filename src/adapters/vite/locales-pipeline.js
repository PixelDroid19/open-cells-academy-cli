import { PathPolicy, normalizeRelativePath } from '../../domain/path-policy.js';
import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { hasSystemCode, typedError } from '../../domain/workspace-session.js';

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isTypedError(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string';
}

function assertSession(session) {
  if (session === null || typeof session !== 'object' || typeof session.root !== 'string' || session.root.length === 0) {
    throw typedError('WORKSPACE_INVALID');
  }
}

function assertFilesystem(filesystem) {
  const required = ['joinPath', 'lstat', 'readFile', 'pathHasSymlink', 'realpath', 'isPathWithin'];
  if (filesystem === null || typeof filesystem !== 'object' || required.some(method => typeof filesystem[method] !== 'function')) {
    throw typedError('LOCALES_CONTEXT_INVALID');
  }
}

function assertRequest(request) {
  if (!isRecord(request) || !Object.isFrozen(request)) {
    throw typedError('LOCALES_REQUEST_INVALID');
  }
}

function normalizedRelativePath(value, field, { json = false } = {}) {
  let normalized;
  try {
    normalized = normalizeRelativePath(value).join('/');
  } catch (cause) {
    throw cause;
  }
  if (json && !normalized.endsWith('.json')) {
    throw typedError('LOCALES_CONFIG_INVALID', { field });
  }
  return normalized;
}

function normalizedPathList(value, field) {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field });
  }
  const normalized = value.map(item => normalizedRelativePath(item, field, { json: true }));
  return Object.freeze([...new Set(normalized)].sort(compareText));
}

function assertLocaleTag(value, field) {
  if (typeof value !== 'string' || !LOCALE_TAG.test(value)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field });
  }
  return value;
}

function normalizedLanguages(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'languages' });
  }
  const languages = value.map(language => assertLocaleTag(language, 'languages'));
  return Object.freeze([...new Set(languages)].sort(compareText));
}

function normalizedInputFileNames(value) {
  if (value === undefined) return Object.freeze(['locales']);
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !FILE_NAME.test(name))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'intlInputFileNames' });
  }
  return Object.freeze([...new Set(value)].sort(compareText));
}

function normalizedIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field });
  }
  return value;
}

function normalizeAppConfig(value) {
  if (!isRecord(value)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'config' });
  }
  const allowed = new Set(['enabledI18n', 'forTesting', 'intlFileName', 'intlFileVersion', 'intlInputFileNames', 'languages', 'useBundles', 'pagesPath', 'initialPages', 'initialBundle']);
  if (Object.keys(value).some(field => !allowed.has(field))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'config' });
  }
  if (value.enabledI18n !== undefined && typeof value.enabledI18n !== 'boolean') {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'enabledI18n' });
  }
  if (value.forTesting !== undefined && typeof value.forTesting !== 'boolean') {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'forTesting' });
  }
  if (value.useBundles !== undefined && typeof value.useBundles !== 'boolean') {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'useBundles' });
  }
  if (value.intlFileVersion !== undefined && value.intlFileVersion !== 1 && value.intlFileVersion !== 2) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'intlFileVersion' });
  }
  if (value.intlFileName !== undefined && (typeof value.intlFileName !== 'string' || !FILE_NAME.test(value.intlFileName))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'intlFileName' });
  }
  if (value.pagesPath !== undefined && typeof value.pagesPath !== 'string') {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'pagesPath' });
  }
  if (value.initialPages !== undefined && !Array.isArray(value.initialPages)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'initialPages' });
  }
  if (value.initialBundle !== undefined && !Array.isArray(value.initialBundle)) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'initialBundle' });
  }
  if (value.initialPages !== undefined && value.initialBundle !== undefined) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'initialPages' });
  }
  const useBundles = value.useBundles ?? false;
  const config = {
    enabledI18n: value.enabledI18n ?? true,
    intlFileName: value.intlFileName,
    intlFileVersion: value.intlFileVersion ?? 1,
    intlInputFileNames: normalizedInputFileNames(value.intlInputFileNames),
    languages: normalizedLanguages(value.languages),
    useBundles,
    pagesPath: normalizedRelativePath(value.pagesPath ?? 'pages', 'pagesPath'),
    initialPages: Object.freeze((value.initialPages ?? value.initialBundle ?? []).map(page => normalizedIdentifier(page, 'initialPages')).sort(compareText))
  };
  if (useBundles) {
    config.intlFileName = config.intlFileName ?? 'locales';
  }
  return Object.freeze(config);
}

function cloneJson(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneJson));
  }
  if (isRecord(value)) {
    const copy = {};
    for (const key of Object.keys(value).sort(compareText)) {
      copy[key] = cloneJson(value[key]);
    }
    return Object.freeze(copy);
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw typedError('LOCALES_JSON_INVALID');
}

function translationRecord(value) {
  if (!isRecord(value)) {
    throw typedError('LOCALES_JSON_INVALID');
  }
  return cloneJson(value);
}

function stableJson(value) {
  return `${JSON.stringify(cloneJson(value), null, 2)}\n`;
}

function sourceFileName(relativePath) {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1, -'.json'.length);
}

function decodeLocaleDocument(relativePath, contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw typedError('LOCALES_JSON_INVALID', { path: relativePath }, cause);
  }
  if (!isRecord(parsed)) {
    throw typedError('LOCALES_JSON_INVALID', { path: relativePath });
  }
  const fileName = sourceFileName(relativePath);
  if (LOCALE_TAG.test(fileName)) {
    return Object.freeze([[fileName, translationRecord(parsed)]]);
  }
  const entries = Object.entries(parsed).sort(([left], [right]) => compareText(left, right));
  if (entries.some(([language, translations]) => !LOCALE_TAG.test(language) || !isRecord(translations))) {
    throw typedError('LOCALES_JSON_INVALID', { path: relativePath });
  }
  return Object.freeze(entries.map(([language, translations]) => Object.freeze([language, translationRecord(translations)])));
}

async function readLocaleSource(session, filesystem, relativePath, { optional = false } = {}) {
  const normalized = normalizedRelativePath(relativePath, 'localeFile', { json: true });
  const raw = filesystem.joinPath(session.root, ...normalized.split('/'));
  let status;
  try {
    status = await filesystem.lstat(raw);
  } catch (cause) {
    if (optional && hasSystemCode(cause, 'ENOENT')) {
      return undefined;
    }
    throw typedError('LOCALES_SOURCE_INVALID', { path: normalized }, cause);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw typedError('LOCALES_SOURCE_INVALID', { path: normalized });
  }
  try {
    if (await filesystem.pathHasSymlink(raw)) {
      throw typedError('LOCALES_SOURCE_INVALID', { path: normalized });
    }
  } catch (cause) {
    if (isTypedError(cause)) {
      throw cause;
    }
    throw typedError('LOCALES_SOURCE_INVALID', { path: normalized }, cause);
  }
  const policy = new PathPolicy(session, filesystem);
  try {
    await policy.resolveRead(normalized);
  } catch (cause) {
    if (cause?.code === 'PATH_INVALID' || cause?.code === 'PATH_OUTSIDE_WORKSPACE') {
      throw cause;
    }
    throw typedError('LOCALES_SOURCE_INVALID', { path: normalized }, cause);
  }
  let contents;
  try {
    contents = await filesystem.readFile(raw, 'utf8');
  } catch (cause) {
    throw typedError('LOCALES_SOURCE_INVALID', { path: normalized }, cause);
  }
  return Object.freeze({ path: normalized, locales: decodeLocaleDocument(normalized, contents) });
}

async function readRequiredSources(session, filesystem, paths) {
  const sources = [];
  for (const path of paths) {
    sources.push(await readLocaleSource(session, filesystem, path));
  }
  return Object.freeze(sources);
}

function mergeRecords(...records) {
  const merged = {};
  for (const record of records) {
    if (record === undefined) {
      continue;
    }
    for (const key of Object.keys(record).sort(compareText)) {
      merged[key] = record[key];
    }
  }
  return cloneJson(merged);
}

function mergeSources(sources) {
  const merged = new Map();
  for (const source of sources) {
    for (const [language, translations] of source.locales) {
      merged.set(language, mergeRecords(merged.get(language), translations));
    }
  }
  return merged;
}

function nonEmptyLanguages(locales, languages = undefined) {
  const selected = languages ?? [...locales.keys()].sort(compareText);
  const result = new Map();
  for (const language of selected) {
    const translations = locales.get(language);
    if (translations !== undefined && Object.keys(translations).length > 0) {
      result.set(language, translations);
    }
  }
  return result;
}

function baseLanguage(language) {
  return language.split(/[-_]/, 1)[0];
}

function overlayBaseAndVariants(componentLocales, appLocales, languages) {
  const available = new Set([...componentLocales.keys(), ...appLocales.keys()]);
  const selected = languages ?? [...available].sort(compareText);
  const output = new Map();
  for (const language of selected) {
    const base = baseLanguage(language);
    const merged =
      language === base
        ? mergeRecords(componentLocales.get(language), appLocales.get(language))
        : mergeRecords(componentLocales.get(base), appLocales.get(base), componentLocales.get(language), appLocales.get(language));
    if (Object.keys(merged).length > 0) {
      output.set(language, merged);
    }
  }
  return output;
}

function reducedPayload(locales) {
  const languages = [...locales.keys()].sort(compareText);
  const keys = [...new Set(languages.flatMap(language => Object.keys(locales.get(language))))].sort(compareText);
  const texts = [];
  const textIndexes = new Map();
  const compacted = {};
  for (const language of languages) {
    for (const key of Object.keys(locales.get(language)).sort(compareText)) {
      const value = locales.get(language)[key];
      if (typeof value !== 'string') {
        throw typedError('LOCALES_CONFIG_INVALID', { field: 'intlFileVersion' });
      }
      if (!textIndexes.has(value)) {
        textIndexes.set(value, texts.length);
        texts.push(value);
      }
    }
  }
  for (const key of keys) {
    const translations = [];
    for (const language of languages) {
      const value = locales.get(language)[key];
      if (value === undefined) {
        translations.push(null);
        continue;
      }
      if (typeof value !== 'string') {
        throw typedError('LOCALES_CONFIG_INVALID', { field: 'intlFileVersion' });
      }
      translations.push(textIndexes.get(value));
    }
    compacted[key] = translations.every(index => index !== null && index === translations[0]) ? translations[0] : translations;
  }
  const payload = compactLocaleKeys(compacted);
  payload.langs = languages;
  payload.texts = texts;
  payload.version = 2;
  return payload;
}

function compactLocaleKeys(values) {
  const result = {};
  for (const key of Object.keys(values).sort(compareText)) {
    const parts = key.split(/([._-])/).filter(Boolean);
    let current = result;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = index % 2 === 0 && index + 1 < parts.length - 1 ? `${parts[index]}${parts[index + 1]}` : parts[index];
      if (current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];
      if (index % 2 === 0 && index + 1 < parts.length - 1) {
        index += 1;
      }
    }
    current[parts.at(-1)] = values[key];
  }
  return result;
}

function combinedPayload(locales, version) {
  const document = Object.fromEntries([...locales.entries()].sort(([left], [right]) => compareText(left, right)));
  return version === 2 ? reducedPayload(new Map(Object.entries(document))) : document;
}

function planWithFile(plan, path, value) {
  return plan.addFile(path, stableJson(value));
}

function legacyPlan(locales, config) {
  let plan = ScaffoldPlan.empty();
  if (locales.size === 0) {
    return plan;
  }
  if (config.enabledI18n) {
    for (const [language, translations] of [...locales.entries()].sort(([left], [right]) => compareText(left, right))) {
      plan = planWithFile(plan, `dist/locales/${language}.json`, translations);
    }
  }
  if (config.intlFileName !== undefined) {
    plan = planWithFile(plan, `dist/locales/${config.intlFileName}.json`, combinedPayload(locales, config.intlFileVersion));
  }
  return plan;
}

function normalizedPageEntries(value) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageEntries' });
  }
  const entries = [];
  for (const [page, module] of Object.entries(value)) {
    entries.push(Object.freeze({ page: normalizedIdentifier(page, 'pageEntries'), module: normalizedIdentifier(module, 'pageEntries') }));
  }
  return Object.freeze(entries.sort((left, right) => compareText(left.page, right.page)));
}

function normalizedPageModules(moduleMap) {
  if (!isRecord(moduleMap) || Object.keys(moduleMap).length === 0) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageModules' });
  }
  const modules = new Map();
  for (const [name, value] of Object.entries(moduleMap)) {
    const moduleName = normalizedIdentifier(name, 'pageModules');
    if (!isRecord(value)) {
      throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageModules' });
    }
    if (value.imports !== undefined && !Array.isArray(value.imports)) {
      throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageModules.imports' });
    }
    const imports = Object.freeze((value.imports ?? []).map(item => normalizedIdentifier(item, 'pageModules.imports')).sort(compareText));
    modules.set(moduleName, Object.freeze({ imports, localeFiles: normalizedPathList(value.localeFiles, 'pageModules.localeFiles') }));
  }
  for (const module of modules.values()) {
    if (module.imports.some(imported => !modules.has(imported))) {
      throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageModules.imports' });
    }
  }
  return modules;
}

function reachablePageSources(entry, modules) {
  const visited = new Set();
  const sources = new Map();
  function visit(name, direct) {
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    const module = modules.get(name);
    for (const imported of module.imports) {
      visit(imported, false);
    }
    for (const localeFile of module.localeFiles) {
      sources.set(localeFile, direct ? 'page' : sources.get(localeFile) ?? 'component');
    }
  }
  visit(entry, true);
  return sources;
}

function sourcesForBundle(pageSources, initialPages) {
  const usage = new Map();
  for (const [page, sources] of pageSources) {
    for (const path of sources.keys()) {
      const pages = usage.get(path) ?? new Set();
      pages.add(page);
      usage.set(path, pages);
    }
  }
  const initial = new Set();
  const unique = new Map();
  for (const [path, pages] of usage) {
    if ([...pages].some(page => initialPages.has(page)) || pages.size > 1) {
      initial.add(path);
      continue;
    }
    const [page] = pages;
    const files = unique.get(page) ?? new Set();
    files.add(path);
    unique.set(page, files);
  }
  return Object.freeze({ initial, unique });
}

function mergeForBundle(paths, pageSources, pageNames, sourceByPath, appLocales, config, { includeAppKeys } = {}) {
  const componentSources = [];
  const pageSourcesToMerge = [];
  for (const path of [...paths].sort(compareText)) {
    const isPageSource = pageNames.some(page => pageSources.get(page)?.get(path) === 'page');
    const source = sourceByPath.get(path);
    if (isPageSource) {
      pageSourcesToMerge.push(source);
    } else {
      componentSources.push(source);
    }
  }
  const componentLocales = mergeSources(componentSources);
  const pageLocales = mergeSources(pageSourcesToMerge);
  const merged = new Map();
  const available = new Set([...componentLocales.keys(), ...appLocales.keys(), ...pageLocales.keys()]);
  const languages = config.languages ?? [...available].sort(compareText);
  for (const language of languages) {
    const component = componentLocales.get(language);
    const app = appLocales.get(language);
    const page = pageLocales.get(language);
    let value = mergeRecords(component);
    if (app !== undefined) {
      value = includeAppKeys
        ? mergeRecords(value, app)
        : mergeRecords(value, Object.fromEntries(Object.keys(app).filter(key => Object.hasOwn(value, key)).map(key => [key, app[key]])));
    }
    value = mergeRecords(value, page);
    if (Object.keys(value).length > 0) {
      merged.set(language, value);
    }
  }
  return merged;
}

async function bundlePlan(session, filesystem, config, appSources, entries, modules) {
  if (config.initialPages.some(page => !entries.some(entry => entry.page === page))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'initialPages' });
  }
  if (entries.some(entry => !modules.has(entry.module))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'pageEntries' });
  }
  const pageSources = new Map(entries.map(entry => [entry.page, reachablePageSources(entry.module, modules)]));
  const allPaths = [...new Set([...pageSources.values()].flatMap(sources => [...sources.keys()]))].sort(compareText);
  const readSources = await readRequiredSources(session, filesystem, allPaths);
  const sourceByPath = new Map(readSources.map(source => [source.path, source]));
  const appLocales = mergeSources(appSources);
  const bundles = sourcesForBundle(pageSources, new Set(config.initialPages));
  let plan = ScaffoldPlan.empty();
  const initialLocales = mergeForBundle(bundles.initial, pageSources, config.initialPages, sourceByPath, appLocales, config, {
    includeAppKeys: true
  });
  if (initialLocales.size > 0) {
    plan = planWithFile(plan, `dist/locales/${config.intlFileName}.json`, combinedPayload(initialLocales, config.intlFileVersion));
  }
  for (const entry of entries) {
    const paths = bundles.unique.get(entry.page);
    if (paths === undefined) {
      continue;
    }
    const locales = mergeForBundle(paths, pageSources, [entry.page], sourceByPath, appLocales, config, { includeAppKeys: false });
    if (locales.size > 0) {
      plan = planWithFile(
        plan,
        `dist/${config.pagesPath}/${entry.page}-page/locales/${config.intlFileName}.json`,
        combinedPayload(locales, config.intlFileVersion)
      );
    }
  }
  return plan;
}

function assertFrozenDependencyNode(node) {
  if (!isRecord(node) || !Object.isFrozen(node) || typeof node.name !== 'string' || node.name.length === 0 || !Array.isArray(node.dependencies) || !Object.isFrozen(node.dependencies)) {
    throw typedError('LOCALES_TREE_INVALID');
  }
  normalizedRelativePath(node.root, 'dependencyTree.root');
}

function dependencyOrder(tree) {
  if (!Array.isArray(tree) || !Object.isFrozen(tree)) {
    throw typedError('LOCALES_TREE_INVALID');
  }
  const visited = new Set();
  const ordered = [];
  function visit(node) {
    assertFrozenDependencyNode(node);
    const root = normalizedRelativePath(node.root, 'dependencyTree.root');
    const identity = `${node.name}\u0000${root}`;
    if (visited.has(identity)) {
      return;
    }
    visited.add(identity);
    for (const child of [...node.dependencies].sort((left, right) => compareText(`${left?.name ?? ''}\u0000${left?.root ?? ''}`, `${right?.name ?? ''}\u0000${right?.root ?? ''}`))) {
      visit(child);
    }
    ordered.push(Object.freeze({ name: node.name, root }));
  }
  for (const node of [...tree].sort((left, right) => compareText(`${left?.name ?? ''}\u0000${left?.root ?? ''}`, `${right?.name ?? ''}\u0000${right?.root ?? ''}`))) {
    visit(node);
  }
  return Object.freeze(ordered);
}

/**
 * Plans app locale outputs from explicit, workspace-relative JSON inputs.
 * The caller owns publication, which lets later composition publish this plan
 * in the same transaction as other generated outputs.
 */
export async function planAppLocales({ session, filesystem, request }) {
  assertSession(session);
  assertFilesystem(filesystem);
  assertRequest(request);
  if (request.config === undefined) {
    return ScaffoldPlan.empty();
  }
  const allowed = new Set(['config', 'componentLocaleFiles', 'appLocaleFiles', 'pageEntries', 'pageModules', 'replaceOutput', 'signal']);
  if (request.replaceOutput !== undefined && typeof request.replaceOutput !== 'boolean') {
    throw typedError('LOCALES_REQUEST_INVALID');
  }
  if (Object.keys(request).some(field => !allowed.has(field))) {
    throw typedError('LOCALES_REQUEST_INVALID');
  }
  const config = normalizeAppConfig(request.config);
  if (!config.enabledI18n) {
    return ScaffoldPlan.empty();
  }
  const componentPaths = normalizedPathList(request.componentLocaleFiles, 'componentLocaleFiles');
  const appPaths = normalizedPathList(request.appLocaleFiles, 'appLocaleFiles');
  const bundle = config.useBundles
    ? Object.freeze({ entries: normalizedPageEntries(request.pageEntries), modules: normalizedPageModules(request.pageModules) })
    : undefined;
  const appSources = await readRequiredSources(session, filesystem, appPaths);
  if (config.useBundles) {
    return bundlePlan(session, filesystem, config, appSources, bundle.entries, bundle.modules);
  }
  const componentSources = await readRequiredSources(session, filesystem, componentPaths);
  const merged = overlayBaseAndVariants(mergeSources(componentSources), mergeSources(appSources), config.languages);
  return legacyPlan(nonEmptyLanguages(merged), config);
}

/**
 * Plans component demo and unit locale catalogs from a frozen public
 * dependency tree. The tree is deliberately injected: this adapter never
 * invokes a package manager or creates a dependency helper artifact.
 */
export async function planComponentLocales({ session, filesystem, request, dependencyTree }) {
  assertSession(session);
  assertFilesystem(filesystem);
  assertRequest(request);
  if (Object.keys(request).some(field => field !== 'ownLocaleFile' && field !== 'signal')) {
    throw typedError('LOCALES_REQUEST_INVALID');
  }
  const ownLocaleFile = request.ownLocaleFile === undefined ? 'locales/locales.json' : normalizedRelativePath(request.ownLocaleFile, 'ownLocaleFile', { json: true });
  const nodes = dependencyOrder(dependencyTree);
  const sources = [];
  for (const node of nodes) {
    const source = await readLocaleSource(session, filesystem, `${node.root}/locales/locales.json`, { optional: true });
    if (source !== undefined) {
      sources.push(source);
    }
  }
  const own = await readLocaleSource(session, filesystem, ownLocaleFile, { optional: true });
  if (own !== undefined) {
    sources.push(own);
  }
  const locales = nonEmptyLanguages(mergeSources(sources));
  if (locales.size === 0) {
    return ScaffoldPlan.empty();
  }
  const output = combinedPayload(locales, 1);
  return planWithFile(planWithFile(ScaffoldPlan.empty(), 'demo/locales/locales.json', output), 'test/unit/locales/locales.json', output);
}
