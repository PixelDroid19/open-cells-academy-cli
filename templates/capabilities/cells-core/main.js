export const cellsCoreClientEntrypoint = `if (typeof globalThis.window !== 'object' || typeof globalThis.window.document !== 'object') {
  const error = new Error('The Academy Core runtime is browser-only and cannot run during SSR or prerendering');
  error.code = 'ACADEMY_CORE_BROWSER_ONLY';
  throw error;
}

const [
  { createOpenCellsClient },
  { createDataManager },
  { loadMessages }
] = await Promise.all([
  import('./runtime/open-cells-client.js'),
  import('./runtime/data-manager.js'),
  import('./capabilities/i18n/messages.js')
]);
const academyRuntime = createOpenCellsClient(window);

export function startAcademyApp(config) {
  return academyRuntime.startAcademyApp(config);
}

export function navigate(routeName, params) {
  return academyRuntime.navigate(routeName, params);
}

export function publish(channel, payload, options) {
  return academyRuntime.publish(channel, payload, options);
}

export function subscribe(channel, callback) {
  return academyRuntime.subscribe(channel, callback);
}

export { createDataManager, loadMessages };
`;
