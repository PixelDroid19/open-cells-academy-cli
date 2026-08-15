export const widgetMixinSource = `function academyError(code) {
  const error = new Error('Academy widget error: ' + code);
  error.code = code;
  return error;
}

function eventTarget() {
  if (typeof globalThis.addEventListener !== 'function' || typeof globalThis.removeEventListener !== 'function') {
    return undefined;
  }
  return globalThis;
}

function assertEventName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw academyError('ACADEMY_WIDGET_EVENT_NAME_REQUIRED');
  }
  return value.trim();
}

function assertEventOptions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw academyError('ACADEMY_WIDGET_INVALID_EVENT_OPTIONS');
  }
  return value;
}

function hostEventName(host, eventName) {
  const localName = typeof host.localName === 'string' ? host.localName.trim() : '';
  if (localName.length === 0) {
    throw academyError('ACADEMY_WIDGET_HOST_NAME_REQUIRED');
  }
  return localName + '-' + eventName;
}

export function WidgetMixin(Base) {
  if (typeof Base !== 'function') {
    throw academyError('ACADEMY_WIDGET_INVALID_BASE');
  }
  return class extends Base {
    constructor(...args) {
      super(...args);
      this._academyLanguageUpdate = () => this.requestUpdate?.();
      this._academyLanguageListening = false;
    }

    connectedCallback() {
      super.connectedCallback?.();
      const target = eventTarget();
      if (target !== undefined && !this._academyLanguageListening) {
        target.addEventListener('language-update', this._academyLanguageUpdate);
        this._academyLanguageListening = true;
      }
    }

    disconnectedCallback() {
      const target = eventTarget();
      if (target !== undefined && this._academyLanguageListening) {
        target.removeEventListener('language-update', this._academyLanguageUpdate);
        this._academyLanguageListening = false;
      }
      super.disconnectedCallback?.();
    }

    t(key, params) {
      const intlMsg = globalThis.IntlMsg;
      if (intlMsg === undefined || typeof intlMsg.t !== 'function') {
        throw academyError('ACADEMY_I18N_NOT_INSTALLED');
      }
      return intlMsg.t(key, params);
    }

    emitEvent(name, detail, options = {}) {
      const eventName = hostEventName(this, assertEventName(name));
      if (typeof this.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') {
        throw academyError('ACADEMY_WIDGET_EVENT_UNAVAILABLE');
      }
      const eventOptions = assertEventOptions(options);
      return this.dispatchEvent(new globalThis.CustomEvent(eventName, {
        ...eventOptions,
        bubbles: eventOptions.bubbles ?? true,
        composed: eventOptions.composed ?? true,
        cancelable: eventOptions.cancelable ?? true,
        detail
      }));
    }
  };
}
`;
