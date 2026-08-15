import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const BROKEN_MARKER = /;\s*;|=\s*;|\(\s*\)\s*;/;

function isError(ruleId) {
  return ruleId === 'syntax-error' || ruleId === 'no-const-assign' || ruleId === 'broken';
}

function messageFor(source, filePath) {
  if (BROKEN_MARKER.test(source)) {
    return {
      ruleId: 'syntax-error',
      message: 'Unexpected token (syntax-error)',
      severity: 2,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
      filePath
    };
  }
  if (source.includes('TODO')) {
    return {
      ruleId: 'no-warning-comments',
      message: 'Unexpected comment (no-warning-comments)',
      severity: 1,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 2,
      filePath
    };
  }
  return undefined;
}

async function listSourceFiles(root) {
  const files = [];
  async function visit(directory, relative) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist' || entry.name === 'build') continue;
        await visit(candidate, childRelative);
        continue;
      }
      if (/\.(js|mjs|html)$/.test(entry.name)) files.push(candidate);
    }
  }
  await visit(root, '');
  return files;
}

/**
 * Minimal public-API-shaped fake for ESLint v9's FlatESLint. It mirrors the
 * constructor options and `lintFiles` result shape so the adapter is unchanged
 * when the real ESLint package is injected in Task 13/15/16.
 */
export function createFakeEslint({ fixable = false, configFailure = false, lintFailure = false } = {}) {
  const instances = [];
  const fake = {
    instances,
    failureLog: [],
    get instanceCount() {
      return instances.length;
    },
    get lastInstance() {
      return instances.at(-1);
    },
    ESLint: class {
      constructor(options) {
        if (configFailure) {
          const error = new Error('eslint-config-secret');
          error.code = 'CONFIG_LOAD_FAILED';
          throw error;
        }
        this.options = options;
        instances.push(this);
      }

      async lintFiles(patterns) {
        if (lintFailure) {
          const error = new Error('eslint-lint-secret');
          error.code = 'LINT_FAILED_TOOL';
          throw error;
        }
        this.lintPatterns = patterns;
        const root = this.options?.cwd;
        const results = [];
        for (const file of await listSourceFiles(root)) {
          const source = await readFile(file, 'utf8');
          const message = messageFor(source, file);
          const messages = message === undefined ? [] : [message];
          const errorCount = messages.filter(m => m.severity === 2).length;
          const fixableErrorCount = fixable && errorCount > 0 ? 1 : 0;
          results.push({
            filePath: file,
            errorCount,
            warningCount: messages.filter(m => m.severity === 1).length,
            fatalErrorCount: 0,
            fixableErrorCount,
            fixableWarningCount: 0,
            messages,
            output: undefined,
            source,
            usedDeprecatedRules: []
          });
        }
        return results;
      }
    }
  };
  return fake;
}
