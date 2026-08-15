export const scopedHostsSource = `import '@webcomponents/scoped-custom-element-registry';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/html-element.js';

const scopedChildTag = 'academy-scoped-child';

function resolveHostBase(hostBase) {
  return hostBase ?? globalThis.HTMLElement ?? class {};
}

export function createScopedRouteHosts({ childConstructor, routeTag, hostBase } = {}) {
  if (typeof childConstructor !== 'function' || typeof routeTag !== 'string' || routeTag.length === 0) {
    throw new TypeError('Invalid scoped route host configuration');
  }
  class Host extends ScopedElementsMixin(resolveHostBase(hostBase)) {
    static scopedElements = { [scopedChildTag]: childConstructor };

    connectedCallback() {
      if (this.shadowRoot !== null && this.shadowRoot !== undefined) return;
      const shadowRoot = this.attachShadow({ mode: 'open' });
      shadowRoot.append(shadowRoot.createElement(scopedChildTag));
    }
  }
  return Object.freeze({ childTag: scopedChildTag, routeTag, Host });
}

export function defineScopedRouteHosts({ globalRegistry = globalThis.customElements, hosts } = {}) {
  if (!globalRegistry || typeof globalRegistry.define !== 'function' || !Array.isArray(hosts)) {
    throw new TypeError('Invalid global route host registry');
  }
  for (const { routeTag, Host } of hosts) {
    if (globalRegistry.get?.(routeTag) === undefined) globalRegistry.define(routeTag, Host);
  }
  return hosts;
}
`;
