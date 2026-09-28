import GearOrganization from "./gear-organization.js";

/**
 * Armour organization — the same user-defined collapsible-tab system the Gear,
 * Weapon and Ability lists have, applied to the Armour list on the Combat tab.
 * All behaviour lives in GearOrganization (whose statics reference `this`, so
 * they bind to this subclass when called through it); only the actor flag and
 * the localization namespace differ. Stored under
 * actor.flags.starwarsffg.armorOrganization with the same shape.
 */
export default class ArmorOrganization extends GearOrganization {
  static FLAG = "armorOrganization";
  static LOC = "SWFFG.ArmorOrganization";
}
