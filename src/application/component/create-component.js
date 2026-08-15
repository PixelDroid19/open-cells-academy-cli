import { createComponentProject } from '../shared/create-scaffold.js';

export async function createComponent(request, context) {
  return createComponentProject(request, context);
}
