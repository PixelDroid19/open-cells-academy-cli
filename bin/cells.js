#!/usr/bin/env node

import { createCommandRegistry } from '../src/cli/command-registry.js';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgv } from '../src/cli/parse-argv.js';
import { renderHelp } from '../src/cli/render-help.js';
import { renderOutcome } from '../src/cli/render-outcome.js';
import { fail } from '../src/domain/outcome.js';

export const VERSION = '0.1.0';

/**
 * Composes the dependency-free kernel. Individual task owners install a real
 * dispatch function later; until then parsed commands fail visibly rather than
 * pretending that a command has completed work.
 *
 * @param {{dispatch?: (request: Readonly<object>) => Promise<object> | object, registry?: ReadonlyMap<string, Readonly<object>>}} [dependencies]
 * @returns {{run: (argv: string[], context?: {env?: Record<string, string | undefined>, locale?: string}) => Promise<{stdout: string, stderr: string, exitCode: number}>}}
 */
export function createCli({ dispatch, registry = createCommandRegistry() } = {}) {
  const dispatchCommand =
    dispatch ??
    (request =>
      fail(
        'NOT_IMPLEMENTED',
        'not_implemented',
        { command: request.command.name },
        'not_implemented_remediation'
      ));

  return Object.freeze({
    async run(argv, context = {}) {
      let parsed;
      try {
        parsed = parseArgv(argv, registry, context);
      } catch (cause) {
        return renderOutcome(fail('INTERNAL_ERROR', 'internal_error', {}, 'internal_error_remediation', cause), 'en');
      }

      if (!parsed.ok) {
        return renderOutcome(parsed, parsed.language);
      }

      if (parsed.action === 'version') {
        return { stdout: `${VERSION}\n`, stderr: '', exitCode: 0 };
      }

      if (parsed.action === 'help') {
        return { stdout: renderHelp(registry, parsed.language, parsed.command), stderr: '', exitCode: 0 };
      }

      try {
        const outcome = await dispatchCommand(parsed);
        return renderOutcome(outcome, parsed.language);
      } catch (cause) {
        return renderOutcome(
          fail('INTERNAL_ERROR', 'internal_error', {}, 'internal_error_remediation', cause),
          parsed.language
        );
      }
    }
  });
}

async function main() {
  const { resolveDispatch } = await import('../src/cli/composition.js');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const candidateRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const { dispatch } = resolveDispatch({
    cwd: process.cwd(),
    env: process.env,
    candidateRoot,
    createRequireFrom: createRequire
  });
  const cli = createCli({ dispatch });
  const result = await cli.run(process.argv.slice(2), { env: process.env });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

async function isEntrypoint() {
  if (typeof process.argv[1] !== 'string' || process.argv[1].length === 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (await isEntrypoint()) {
  await main();
}
