export function testRunnerForManifest(manifest) {
  const scripts = manifest?.scripts;
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return 'vitest';
  const usesWtr = Object.entries(scripts).some(([name, command]) => {
    if (!name.startsWith('test') || typeof command !== 'string') return false;
    return name.split(':').includes('wtr') || /(?:^|\s)--wtr(?:\s|$)/.test(command) || /(?:^|[\s/])web-test-runner(?:\s|$)/.test(command);
  });
  return usesWtr ? 'wtr' : 'vitest';
}
