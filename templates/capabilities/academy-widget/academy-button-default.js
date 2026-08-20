export const academyButtonDefaultSource = `import { LitElement, css, html } from 'lit';

export class AcademyButtonDefault extends LitElement {
  static properties = {
    text: { type: String },
    disabled: { type: Boolean, reflect: true }
  };

  constructor() {
    super();
    this.text = '';
    this.disabled = false;
  }

  static styles = css\`
    :host { display: block; }
    button {
      width: 100%;
      min-height: 3rem;
      border: 0;
      border-radius: .9rem;
      padding: .75rem 1.25rem;
      background: #0f172a;
      color: #fff;
      font: 700 .9rem/1 "Plus Jakarta Sans", system-ui, sans-serif;
      cursor: pointer;
      transition: background 150ms ease, transform 150ms ease, box-shadow 150ms ease;
    }
    button:hover:not(:disabled) { background: #1e293b; box-shadow: 0 8px 18px -10px rgb(15 23 42 / 70%); }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:focus-visible { outline: 3px solid #7dd3fc; outline-offset: 3px; }
    button:disabled { cursor: not-allowed; opacity: .5; }
  \`;

  render() {
    return html\`<button type="button" ?disabled=\${this.disabled}>\${this.text}</button>\`;
  }
}
`;
