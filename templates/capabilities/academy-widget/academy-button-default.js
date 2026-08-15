export const academyButtonDefaultSource = `import { LitElement, html } from 'lit';

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

  render() {
    return html\`<button type="button" ?disabled=\${this.disabled}>\${this.text}</button>\`;
  }
}
`;
