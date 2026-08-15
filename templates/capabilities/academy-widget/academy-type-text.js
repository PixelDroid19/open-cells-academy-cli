export const academyTypeTextSource = `import { LitElement, html } from 'lit';

export class AcademyTypeText extends LitElement {
  static properties = { text: { type: String } };

  constructor() {
    super();
    this.text = '';
  }

  render() {
    return html\`<span part="text">\${this.text}</span>\`;
  }
}
`;
