import { fail, ok } from '../../domain/outcome.js';

/**
 * Maps a package manager result to the application outcome vocabulary.
 */
export async function installProject(request, context) {
  if (context === null || typeof context !== 'object' || context.packageManager === null || typeof context.packageManager?.install !== 'function') {
    return fail('INVALID_INPUT', 'invalidInput');
  }
  try {
    const installed = await context.packageManager.install(request, context.session);
    return ok({ tool: installed.tool, mode: installed.mode, result: installed.result });
  } catch (cause) {
    return fail(cause?.code ?? 'TOOL_FAILED', 'installFailed', {}, undefined, cause);
  }
}
