import { applicationCapabilityOrder } from '../profile-definition.js';

export const profileDefinition = Object.freeze({
  profile: 'web-app',
  kind: 'app',
  capabilities: applicationCapabilityOrder
});

export const profile = profileDefinition.profile;
