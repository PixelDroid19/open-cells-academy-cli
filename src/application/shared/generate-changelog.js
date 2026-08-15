import { fail, ok } from '../../domain/outcome.js';

const PRESETS = new Set(['angular', 'conventionalcommits']);
const SUBJECT = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const BREAKING = /^BREAKING(?: |-)?CHANGE:\s*(.+)$/gim;

function escapeMarkdown(value) {
  return value.replace(/[\\`*_[\]()<>]/g, '\\$&');
}

function classify(commit) {
  const match = SUBJECT.exec(commit.subject);
  const breaking = [];
  if (match?.[3] === '!') {
    breaking.push(match[4]);
  }
  for (const found of commit.body.matchAll(BREAKING)) {
    breaking.push(found[1].trim());
  }
  const item = { text: match?.[4] ?? commit.subject, hash: commit.shortHash };
  return Object.freeze({
    feature: match?.[1] === 'feat' ? item : undefined,
    fix: match?.[1] === 'fix' ? item : undefined,
    other:
      match === null
        ? item
        : match[1] !== 'feat' && match[1] !== 'fix'
          ? { text: commit.subject, hash: commit.shortHash }
          : undefined,
    breaking: Object.freeze(breaking.map(text => Object.freeze({ text, hash: commit.shortHash })))
  });
}

function renderItems(items) {
  return items.map(item => `- ${escapeMarkdown(item.text)} (${item.hash})`).join('\n');
}

function section(title, items) {
  if (items.length === 0) {
    return '';
  }
  return `### ${title}\n${renderItems(items)}\n`;
}

function render(commits, preset, date) {
  const features = [];
  const fixes = [];
  const breaking = [];
  const other = [];
  for (const commit of commits) {
    const classified = classify(commit);
    if (classified.feature !== undefined) {
      features.push(classified.feature);
    }
    if (classified.fix !== undefined) {
      fixes.push(classified.fix);
    }
    if (classified.other !== undefined) {
      other.push(classified.other);
    }
    breaking.push(...classified.breaking);
  }
  return [
    `## ${date}\n<!-- open-cells-academy: preset=${preset} -->`,
    section('Features', features).trimEnd(),
    section('Bug Fixes', fixes).trimEnd(),
    section('Breaking Changes', breaking).trimEnd(),
    section('Other Changes', other).trimEnd()
  ].filter(Boolean).join('\n\n').concat('\n');
}

/**
 * Renders Academy-owned conventional history through injected Git and document
 * ports, preserving pre-existing document bytes in append mode.
 */
export async function generateChangelog(request, context) {
  if (
    request === null ||
    typeof request !== 'object' ||
    !PRESETS.has(request.preset) ||
    typeof request.full !== 'boolean' ||
    typeof request.name !== 'string' ||
    context === null ||
    typeof context !== 'object' ||
    typeof context.git?.readConventionalCommits !== 'function' ||
    typeof context.documents?.writeAtomically !== 'function' ||
    typeof context.documents?.readVersioned !== 'function' ||
    typeof context.clock !== 'function'
  ) {
    return fail('INVALID_INPUT', 'invalidInput');
  }
  try {
    const commits = await context.git.readConventionalCommits(context.session);
    const now = context.clock();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
      throw new TypeError('clock must return a valid Date');
    }
    const generated = render(commits, request.preset, now.toISOString().slice(0, 10));
    let content = generated;
    let expectedVersion;
    if (!request.full) {
      const existing = await context.documents.readVersioned(context.session, request.name);
      expectedVersion = existing.version;
      content = existing.content.length === 0 ? generated : `${existing.content}${existing.content.endsWith('\n') ? '\n' : '\n\n'}${generated}`;
    }
    await context.documents.writeAtomically(context.session, request.name, content, {
      replace: true,
      expectedVersion
    });
    return ok({ name: request.name, preset: request.preset, full: request.full, commitCount: commits.length });
  } catch (cause) {
    return fail(cause?.code ?? 'TOOL_FAILED', 'changelogFailed', {}, undefined, cause);
  }
}
