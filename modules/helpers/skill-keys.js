import { AE_MODES } from "../config/ffg-active-effect-modes.js";

/**
 * The key, in the active skill list, of the skill a name stands for. Careers and specializations
 * store career skills by that key (their sheet's dropdown and the `system.skills.<key>.careerskill`
 * effect both use it), but the OggDude importer stored the OggDude name, which only matches a skill
 * list keyed by exactly those names: "Athletics " (trailing space), "Knowledge: Science" and
 * "Ranged: Light" match nothing in a list keyed Athletics, Knowledge-Science and Ranged-Light.
 * Names are compared with case, spaces and punctuation ignored, against each skill's key and then
 * its label.
 * @param {string} name
 * @returns {string|undefined} the skill key, or undefined when the list has no such skill
 */
export function systemSkillKey(name) {
  const squash = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const wanted = squash(name);
  if (!wanted) return undefined;
  const skills = Object.entries(CONFIG.FFG.skills ?? {});
  return skills.find(([key]) => squash(key) === wanted)?.[0]
    ?? skills.find(([, skill]) => squash(game.i18n.localize(skill?.label ?? "")) === wanted)?.[0];
}

/**
 * The career skill slot keys of a career or specialization, in order (careerSkill0, careerSkill1,
 * ...). Read from the item type's schema, so they follow the DataModel rather than a hard-coded
 * count.
 * @param {string} type - "career" or "specialization"
 * @returns {string[]}
 */
export function careerSkillSlots(type) {
  const fields = CONFIG.Item.dataModels?.[type]?.schema?.fields?.careerSkills?.fields ?? {};
  return Object.keys(fields).sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));
}

/**
 * The changes of a career's or specialization's "(inherent)" effect for its career skills: one per
 * slot, "(none)" for an empty one. Every writer of that effect goes through here, so the sheet, the
 * importer and the stat sync always build the same list and never fight over it.
 * @param {object} careerSkills - the item's `system.careerSkills`
 * @returns {object[]}
 */
export function careerSkillChanges(careerSkills) {
  return Object.keys(careerSkills ?? {})
    .filter((slot) => /^careerSkill\d+$/.test(slot))
    .sort((a, b) => parseInt(a.slice(11), 10) - parseInt(b.slice(11), 10))
    .map((slot) => {
      const skill = careerSkills[slot];
      return {
        key: skill && skill !== "(none)" ? `system.skills.${skill}.careerskill` : "(none)",
        mode: AE_MODES.ADD,
        value: true,
      };
    });
}
