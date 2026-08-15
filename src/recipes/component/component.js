import { componentCapabilityOrder } from '../profile-definition.js';

export const profileDefinition = Object.freeze({
  profile: 'component',
  kind: 'component',
  capabilities: componentCapabilityOrder
});

export const profile = profileDefinition.profile;
