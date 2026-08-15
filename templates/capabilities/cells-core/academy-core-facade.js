export const academyCoreFacadeSource = `const startedDocuments = new WeakMap();

function academyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isSafeIdentifier(value) {
  return isNonEmptyString(value) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function isAcademyChannel(channel) {
  if (typeof channel !== 'string') {
    return false;
  }
  const segments = channel.split(':');
  if (segments.length !== 4 || segments[0] !== 'academy') {
    return false;
  }
  return segments.slice(1).every(segment => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(segment) && !segment.startsWith('__oc_'));
}

function hasSupportedPublishOptions(options) {
  if (options === undefined) {
    return true;
  }
  if (!isObject(options)) {
    return false;
  }
  const keys = Object.keys(options);
  return keys.every(key => key === 'sessionStorage') && (options.sessionStorage === undefined || typeof options.sessionStorage === 'boolean');
}

function assertCoreMethod(core, name) {
  if (!isObject(core) || typeof core[name] !== 'function') {
    throw academyError('ACADEMY_CORE_INVALID_BINDING');
  }
}

function assertBrowser(browser) {
  if (
    !isObject(browser) ||
    !isObject(browser.document) ||
    typeof browser.document.createElement !== 'function' ||
    typeof browser.document.getElementById !== 'function' ||
    !isObject(browser.customElements) ||
    typeof browser.customElements.get !== 'function'
  ) {
    throw academyError('ACADEMY_CORE_INVALID_CONFIG');
  }
}

function validateBootstrap(browser, config) {
  assertBrowser(browser);
  if (!isObject(config) || config.debug !== false || !isSafeIdentifier(config.mainNode) || !Array.isArray(config.routes) || config.routes.length === 0 || !isSafeIdentifier(config.initialTemplate)) {
    throw academyError('ACADEMY_CORE_INVALID_CONFIG');
  }
  if (browser.document.getElementById(config.mainNode) === null) {
    throw academyError('ACADEMY_CORE_INVALID_CONFIG');
  }
  const routeNames = new Set();
  for (const route of config.routes) {
    if (
      !isObject(route) ||
      !isSafeIdentifier(route.name) ||
      !isNonEmptyString(route.path) ||
      typeof route.action !== 'function' ||
      !isNonEmptyString(route.component) ||
      routeNames.has(route.name) ||
      browser.customElements.get(route.component) === undefined
    ) {
      throw academyError('ACADEMY_CORE_INVALID_CONFIG');
    }
    routeNames.add(route.name);
  }
  if (!routeNames.has(config.initialTemplate)) {
    throw academyError('ACADEMY_CORE_INVALID_CONFIG');
  }
  return routeNames;
}

function assertRouteParams(params) {
  if (params !== undefined && !isObject(params)) {
    throw academyError('ACADEMY_CORE_INVALID_ROUTE_PARAMS');
  }
}

function assertStarted(browser) {
  const runtime = startedDocuments.get(browser.document);
  if (runtime === undefined) {
    throw academyError('ACADEMY_CORE_NOT_STARTED');
  }
  return runtime;
}

export function createAcademyCoreFacade(core, browser) {
  let subscriptionOwner;
  const channelSubscriptions = new Map();

  function reportSubscriptionCallbackError() {
    const error = academyError('ACADEMY_CORE_SUBSCRIPTION_CALLBACK_ERROR');
    queueMicrotask(() => {
      if (typeof browser.reportError === 'function') {
        browser.reportError(error);
        return;
      }
      if (typeof browser.window?.reportError === 'function') {
        browser.window.reportError(error);
        return;
      }
      if (typeof globalThis.reportError === 'function') {
        globalThis.reportError(error);
        return;
      }
      throw error;
    });
  }

  function startAcademyApp(config) {
    const routeNames = validateBootstrap(browser, config);
    assertCoreMethod(core, 'startApp');
    if (startedDocuments.has(browser.document) || (typeof core.getConfig === 'function' && core.getConfig() !== undefined)) {
      throw academyError('ACADEMY_CORE_ALREADY_STARTED');
    }
    core.startApp(config);
    startedDocuments.set(browser.document, { routeNames });
  }

  function navigate(routeName, params) {
    assertBrowser(browser);
    const runtime = assertStarted(browser);
    if (!isNonEmptyString(routeName) || !runtime.routeNames.has(routeName)) {
      throw academyError('ACADEMY_CORE_UNKNOWN_ROUTE');
    }
    assertRouteParams(params);
    assertCoreMethod(core, 'navigate');
    core.navigate(routeName, params);
  }

  function publish(channel, payload, options) {
    if (!isAcademyChannel(channel)) {
      throw academyError('ACADEMY_CORE_INVALID_CHANNEL');
    }
    if (!hasSupportedPublishOptions(options)) {
      throw academyError('ACADEMY_CORE_INVALID_PUBLISH_OPTIONS');
    }
    assertStarted(browser);
    assertCoreMethod(core, 'publish');
    core.publish(channel, payload, options);
  }

  function subscribe(channel, callback) {
    if (!isAcademyChannel(channel)) {
      throw academyError('ACADEMY_CORE_INVALID_CHANNEL');
    }
    if (typeof callback !== 'function') {
      throw academyError('ACADEMY_CORE_INVALID_SUBSCRIPTION');
    }
    assertStarted(browser);
    assertCoreMethod(core, 'subscribe');
    assertCoreMethod(core, 'unsubscribe');
    if (subscriptionOwner === undefined) {
      subscriptionOwner = browser.document.createElement('span');
    }
    let active = true;
    const receive = detail => {
      if (active) {
        try {
          callback(detail);
        } catch {
          reportSubscriptionCallbackError();
        }
      }
    };
    let channelSubscription = channelSubscriptions.get(channel);
    if (channelSubscription === undefined) {
      const callbacks = new Set();
      channelSubscription = {
        callbacks,
        coreSubscribed: false,
        deliveryCount: 0,
        hasLast: false,
        lastDetail: undefined,
        receive: detail => {
          if (!channelSubscription.coreSubscribed) {
            return;
          }
          channelSubscription.deliveryCount += 1;
          channelSubscription.hasLast = true;
          channelSubscription.lastDetail = detail;
          for (const receive of [...callbacks]) {
            receive(detail);
          }
        }
      };
      channelSubscriptions.set(channel, channelSubscription);
    }
    channelSubscription.callbacks.add(receive);
    if (channelSubscription.coreSubscribed) {
      if (channelSubscription.hasLast) {
        receive(channelSubscription.lastDetail);
      }
    } else {
      channelSubscription.coreSubscribed = true;
      const deliveryCountBeforeSubscription = channelSubscription.deliveryCount;
      core.subscribe(channel, subscriptionOwner, channelSubscription.receive);
      if (channelSubscription.hasLast && channelSubscription.deliveryCount === deliveryCountBeforeSubscription) {
        receive(channelSubscription.lastDetail);
      }
    }
    return function cleanup() {
      if (!active) {
        return;
      }
      active = false;
      channelSubscription.callbacks.delete(receive);
      if (channelSubscription.callbacks.size === 0) {
        channelSubscription.coreSubscribed = false;
        core.unsubscribe(channel, subscriptionOwner);
      }
    };
  }

  return Object.freeze({ startAcademyApp, navigate, publish, subscribe });
}
`;
