import { lintProject } from '../shared/lint-project.js';

export function lintApp(context) {
  return lintProject(context, 'app');
}
