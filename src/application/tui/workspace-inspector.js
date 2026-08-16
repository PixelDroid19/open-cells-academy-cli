import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { testRunnerForManifest } from '../../domain/test-runner-policy.js';

async function appConfigFiles(configRoot, relative = '') {
  const entries = await readdir(path.join(configRoot, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await appConfigFiles(configRoot, child));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      files.push(child);
    }
  }
  return files;
}

function preferredConfig(configs, names) {
  for (const name of names) {
    const match = configs.find(config => path.posix.basename(config) === name);
    if (match !== undefined) return match;
  }
  return configs[0];
}

/**
 * Non-destructively inspects a workspace directory to determine its OpenCells project type and configuration.
 * @param {string} cwd
 * @returns {Promise<Readonly<{name: string, type: 'app' | 'component' | 'unknown', root: string, defaultAppConfig?: string}>>}
 */
export async function inspectWorkspace(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  let manifest = null;

  try {
    const manifestContent = await readFile(path.join(root, 'package.json'), 'utf8');
    manifest = JSON.parse(manifestContent);
  } catch {}

  const name = manifest?.name || path.basename(root);

  // Check if App
  try {
    const appDirStat = await stat(path.join(root, 'app'));
    if (appDirStat.isDirectory()) {
      let appConfigs = [];
      try {
        appConfigs = (await appConfigFiles(path.join(root, 'app', 'config'))).sort();
      } catch {}
      const defaultAppConfig = preferredConfig(appConfigs, ['dev.js', 'web-dev.js']);
      const defaultBuildConfig = preferredConfig(appConfigs, ['prod.js', 'web-prod.js']) ?? defaultAppConfig;

      return Object.freeze({
        name,
        type: 'app',
        root,
        testRunner: testRunnerForManifest(manifest),
        appConfigs: Object.freeze(appConfigs),
        defaultAppConfig,
        defaultBuildConfig
      });
    }
  } catch {}

  // Check if Component
  try {
    const demoDirStat = await stat(path.join(root, 'demo'));
    if (demoDirStat.isDirectory()) {
      return Object.freeze({
        name,
        type: 'component',
        root,
        testRunner: testRunnerForManifest(manifest)
      });
    }
  } catch {}

  try {
    const recipeContent = await readFile(path.join(root, '.open-cells-academy-recipe.json'), 'utf8');
    const recipe = JSON.parse(recipeContent);
    if (recipe.kind === 'app') {
      return Object.freeze({
        name,
        type: 'app',
        root,
        testRunner: testRunnerForManifest(manifest),
        appConfigs: Object.freeze([]),
        defaultAppConfig: undefined,
        defaultBuildConfig: undefined
      });
    }
    if (recipe.kind === 'component') {
      return Object.freeze({
        name,
        type: 'component',
        root,
        testRunner: testRunnerForManifest(manifest)
      });
    }
  } catch {}

  return Object.freeze({
    name,
    type: 'unknown',
    root
  });
}
