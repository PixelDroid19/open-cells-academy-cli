export const openCellsClientSource = `import { getConfig, navigate, publish, startApp, subscribe, unsubscribe } from '@open-cells/core';
import { createAcademyCoreFacade } from './academy-core-facade.js';

function bindBrowser(targetWindow) {
  return {
    window: targetWindow,
    document: targetWindow.document,
    customElements: targetWindow.customElements,
    history: targetWindow.history
  };
}

export function createOpenCellsClient(targetWindow = window) {
  const core = { getConfig, startApp, navigate, publish, subscribe, unsubscribe };
  return createAcademyCoreFacade(core, bindBrowser(targetWindow));
}
`;
