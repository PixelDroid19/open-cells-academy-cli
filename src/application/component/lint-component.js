import { lintProject } from '../shared/lint-project.js';

export function lintComponent(context) {
  return lintProject(context, 'component');
}
