import { typedError } from '../../domain/workspace-session.js';

export const POLYMER_PROFILES = Object.freeze(['component', 'behavior', 'data-manager', 'theme']);
export const LIT_BASES = Object.freeze(['lit1', 'lit3']);

const polymerSet = new Set(POLYMER_PROFILES);
const litSet = new Set(LIT_BASES);

export function assertLegacyComponentProfile(options) {
  if (options?.cellsVersion !== '4') {
    throw typedError('INVALID_INPUT', { field: 'cellsVersion' });
  }
  const hasPolymer = options.componentProfile !== undefined;
  const hasLit = options.componentBase !== undefined;
  if (hasPolymer === hasLit) {
    throw typedError('INVALID_INPUT', { field: 'componentBase' });
  }
  if (hasPolymer && (!polymerSet.has(options.componentProfile) || typeof options.componentProfile !== 'string')) {
    throw typedError('INVALID_INPUT', { field: 'componentProfile' });
  }
  if (hasLit && (!litSet.has(options.componentBase) || typeof options.componentBase !== 'string')) {
    throw typedError('INVALID_INPUT', { field: 'componentBase' });
  }
  return Object.freeze({
    componentBase: hasLit ? options.componentBase : undefined,
    componentProfile: hasPolymer ? options.componentProfile : undefined
  });
}

export function isPolymerProfile(value) {
  return typeof value === 'string' && polymerSet.has(value);
}

export function isLitBase(value) {
  return typeof value === 'string' && litSet.has(value);
}
