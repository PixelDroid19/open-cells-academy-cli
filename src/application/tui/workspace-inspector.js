import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { testRunnerForManifest } from '../../domain/test-runner-policy.js';

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
        const configEntries = await readdir(path.join(root, 'app', 'config'));
        appConfigs = configEntries.filter(file => file.endsWith('.js') || file.endsWith('.mjs')).sort();
      } catch {}
      const defaultAppConfig = appConfigs.includes('dev.js') ? 'dev.js' : appConfigs[0];
      const defaultBuildConfig = appConfigs.includes('prod.js') ? 'prod.js' : defaultAppConfig;

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
