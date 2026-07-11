import GearOrganization from "./gear-organization.js";

/**
 * Ability organization — the same user-defined collapsible-tab system the Gear
 * and Weapon lists have, applied to the Abilities list on the actor sheet.
 * All behaviour lives in GearOrganization (whose statics reference `this`, so
 * they bind to this subclass when called through it); only the actor flag and
 * the localization namespace differ. Stored under
 * actor.flags.starwarsffg.abilityOrganization with the same shape.
 */
export default class AbilityOrganization extends GearOrganization {
  static FLAG = "abilityOrganization";
  static LOC = "SWFFG.AbilityOrganization";
}
