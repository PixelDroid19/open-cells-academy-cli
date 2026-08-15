import { typedError } from '../../domain/workspace-session.js';
import { MarkdownRenderer } from '../../adapters/cem/markdown-renderer.js';
import { DocsWriter } from '../../adapters/cem/docs-writer.js';

const DEFAULT_MANIFEST_PATH = 'custom-elements.json';
const DEFAULT_MD_FILE = 'README.md';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAnalyzer(analyzer) {
  if (analyzer === null || typeof analyzer !== 'object' || typeof analyzer.analyze !== 'function') {
    throw typedError('DOC_ANALYZER_INVALID');
  }
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.filesystem === undefined) {
    throw typedError('DOC_REQUEST_INVALID');
  }
  assertAnalyzer(context.analyzer);
  if (context.options !== undefined && !isRecord(context.options)) throw typedError('DOC_REQUEST_INVALID');
  const options = Object.freeze({ ...(context.options ?? {}) });
  if (options.noMd !== undefined && typeof options.noMd !== 'boolean') throw typedError('DOC_REQUEST_INVALID');
  if (options.manifestPath !== undefined && typeof options.manifestPath !== 'string') throw typedError('DOC_REQUEST_INVALID');
  if (options.mdFile !== undefined && typeof options.mdFile !== 'string') throw typedError('DOC_REQUEST_INVALID');
  return Object.freeze({
    session: context.session,
    filesystem: context.filesystem,
    analyzer: context.analyzer,
    options
  });
}

function targetValue(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) throw typedError('DOC_REQUEST_INVALID');
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Generates component documentation from the component sources: a
 * standards-conformant `custom-elements.json` and an optional deterministic
 * Markdown file. Each output is published atomically by the docs writer with
 * owned backup and rollback; traversal/absolute/symlink targets are rejected
 * before any write.
 */
export async function documentComponent(context) {
  const normalized = normalizedContext(context);
  const writer = new DocsWriter(normalized.session, normalized.filesystem);
  const manifestPath = targetValue(normalized.options.manifestPath, DEFAULT_MANIFEST_PATH);
  const mdFile = targetValue(normalized.options.mdFile, DEFAULT_MD_FILE);
  const noMd = normalized.options.noMd === true;

  await writer.validateTarget(manifestPath);
  if (!noMd) await writer.validateTarget(mdFile);

  const manifest = await normalized.analyzer.analyze(normalized.session);
  const manifestJson = stableJson(manifest);

  const manifestExists = await writer.exists(manifestPath);
  const manifestPublished = await writer.write(manifestPath, manifestJson, { replace: manifestExists });

  if (noMd) {
    return manifestPublished;
  }

  const markdown = new MarkdownRenderer().render(manifest);
  const mdExists = await writer.exists(mdFile);
  try {
    const mdPublished = await writer.write(mdFile, markdown, { replace: mdExists });
    return Object.freeze({ destination: manifestPublished.destination, readme: mdPublished.destination });
  } catch (cause) {
    if (cause?.code === 'DOC_REQUEST_INVALID' || cause?.code === 'PATH_INVALID' || cause?.code === 'DOC_DEST_INVALID' || cause?.code === 'DESTRUCTIVE_ROOT') {
      throw cause;
    }
    throw typedError('DOC_MD_FAILED', { target: mdFile }, cause);
  }
}
