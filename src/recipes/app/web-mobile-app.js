import { applicationCapabilityOrder } from '../profile-definition.js';

export const profileDefinition = Object.freeze({
  profile: 'web-mobile-app',
  kind: 'app',
  capabilities: applicationCapabilityOrder
});

export const profile = profileDefinition.profile;
