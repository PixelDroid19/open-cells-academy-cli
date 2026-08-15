import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/"/g, '&#34;');
}

function text(value) {
  if (typeof value === 'string') return escapeText(value);
  if (isRecord(value) && typeof value.text === 'string') return escapeText(value.text);
  return '';
}

function line(value) {
  return `${value}\n`;
}

function heading(level, textValue) {
  return `${'#'.repeat(level)} ${escapeText(textValue)}\n\n`;
}

function code(value) {
  return `\`\`\`\n${String(value ?? '')}\n\`\`\`\n`;
}

function table(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map((header, index) => escapeText(row[index] ?? '')).join(' | ')} |`);
  return [headerLine, separator, ...body, ''].join('\n');
}

function assertManifest(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest.modules)) {
    throw typedError('CEM_MANIFEST_INVALID');
  }
}

function declarationRows(modulePath, declarations) {
  const rows = [];
  for (const declaration of declarations ?? []) {
    if (declaration?.kind !== 'class' && declaration?.kind !== 'mixin') continue;
    rows.push([
      declaration.tagName ?? '',
      declaration.name ?? '',
      declaration.superclass?.name ?? '',
      modulePath,
      declaration.description ?? ''
    ]);
  }
  return rows;
}

/**
 * Deterministic Academy Markdown renderer for a Custom Elements Manifest.
 * User-authored descriptions and names are HTML-escaped; output is stable for
 * identical manifests and drops no discovered metadata.
 */
export class MarkdownRenderer {
  render(manifest) {
    assertManifest(manifest);
    const output = [];
    const components = [];
    for (const module of manifest.modules) {
      if (!isRecord(module) || !Array.isArray(module.declarations)) continue;
      for (const declaration of module.declarations) {
        if (!isRecord(declaration) || (declaration.kind !== 'class' && declaration.kind !== 'mixin')) continue;
        components.push(Object.freeze({ module, declaration }));
      }
    }

    if (components.length === 0) {
      output.push(line('# Component documentation'));
      output.push(line('\nNo components were found in the analyzed sources.\n'));
      return output.join('');
    }

    output.push(line('# Component documentation'));
    output.push(line('This documentation is generated from the component source by the Academy CLI.\n'));
    output.push(line('## Components'));
    output.push(line(''));
    const rows = [];
    for (const component of components) {
      rows.push([
        component.declaration.tagName ?? component.declaration.name ?? '',
        component.declaration.name ?? '',
        component.declaration.superclass?.name ?? '',
        component.module.path ?? '',
        component.declaration.description ?? ''
      ]);
    }
    output.push(table(['Tag', 'Class', 'Extends', 'Module', 'Description'], rows));
    output.push(line(''));

    for (const component of components) {
      const { declaration } = component;
      output.push(heading(2, declaration.name ?? declaration.tagName ?? 'Component'));
      if (declaration.description) {
        output.push(line(escapeText(declaration.description)));
        output.push(line(''));
      }
      if (declaration.superclass) {
        output.push(line(`Extends: \`${escapeText(declaration.superclass.name ?? '')}\``));
        output.push(line(''));
      }

      const attributes = (declaration.attributes ?? []).filter(isRecord);
      if (attributes.length > 0) {
        output.push(heading(3, 'Attributes'));
        output.push(table(['Name', 'Type', 'Default', 'Description'], attributes.map(attribute => [
          attribute.name ?? '',
          text(attribute.type),
          attribute.default ?? '',
          attribute.description ?? ''
        ])));
        output.push(line(''));
      }

      const properties = (declaration.members ?? []).filter(member => isRecord(member) && member.kind === 'field');
      if (properties.length > 0) {
        output.push(heading(3, 'Properties'));
        output.push(table(['Name', 'Type', 'Default', 'Reflects', 'Description'], properties.map(property => [
          property.name ?? '',
          text(property.type),
          property.default ?? '',
          property.reflects === true ? 'yes' : 'no',
          property.description ?? ''
        ])));
        output.push(line(''));
      }

      const methods = (declaration.members ?? []).filter(member => isRecord(member) && member.kind === 'method');
      if (methods.length > 0) {
        output.push(heading(3, 'Methods'));
        output.push(table(['Name', 'Description'], methods.map(method => [method.name ?? '', method.description ?? ''])));
        output.push(line(''));
      }

      const events = (declaration.events ?? []).filter(isRecord);
      if (events.length > 0) {
        output.push(heading(3, 'Events'));
        output.push(table(['Name', 'Type', 'Description'], events.map(event => [event.name ?? '', text(event.type), event.description ?? ''])));
        output.push(line(''));
      }

      const slots = (declaration.slots ?? []).filter(isRecord);
      if (slots.length > 0) {
        output.push(heading(3, 'Slots'));
        output.push(table(['Name', 'Description'], slots.map(slot => [slot.name === '' ? '(default)' : slot.name ?? '', slot.description ?? ''])));
        output.push(line(''));
      }

      const cssProperties = (declaration.cssProperties ?? []).filter(isRecord);
      if (cssProperties.length > 0) {
        output.push(heading(3, 'CSS Custom Properties'));
        output.push(table(['Name', 'Description'], cssProperties.map(property => [property.name ?? '', property.description ?? ''])));
        output.push(line(''));
      }

      const cssParts = (declaration.cssParts ?? []).filter(isRecord);
      if (cssParts.length > 0) {
        output.push(heading(3, 'CSS Shadow Parts'));
        output.push(table(['Name', 'Description'], cssParts.map(part => [part.name ?? '', part.description ?? ''])));
        output.push(line(''));
      }

      const examples = (declaration.examples ?? []).filter(isRecord);
      if (examples.length > 0) {
        output.push(heading(3, 'Examples'));
        for (const example of examples) {
          if (example.description) {
            output.push(line(escapeText(example.description)));
            output.push(line(''));
          }
          if (typeof example.code === 'string') output.push(code(example.code));
        }
        output.push(line(''));
      }
    }
    return output.join('');
  }
}
