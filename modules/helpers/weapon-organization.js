import GearOrganization from "./gear-organization.js";

/**
 * Weapon organization — the same user-defined collapsible-tab system the Gear
 * list has, applied to the Weapons list on the character sheet's Combat tab.
 * All behaviour lives in GearOrganization (whose statics reference `this`, so
 * they bind to this subclass when called through it); only the actor flag and
 * the localization namespace differ. Stored under
 * actor.flags.starwarsffg.weaponOrganization with the same shape.
 */
export default class WeaponOrganization extends GearOrganization {
  static FLAG = "weaponOrganization";
  static LOC = "SWFFG.WeaponOrganization";
}
