/**
 * Additional defence skills.
 *
 * The roll builder adds a target's Melee or Ranged Defence as setback dice when a weapon is rolled
 * with one of the stock combat skills (DiceHelpers.getDefenseDice). Tables that run other skills
 * as attacks - a Force power skill, a custom "Throwing" skill, a renamed combat skill in a custom
 * skill theme - had no way to opt those in. This is that opt-in: a world setting mapping skill keys
 * to "melee" or "ranged", edited from Configure Settings.
 *
 * A skill listed here faces defence whenever it is rolled against a targeted token, weapon or not.
 */
import { FFGFormApplication } from "../apps/ffg-form-application.js";

const SETTING = "additionalDefenseSkills";

/** The same key normalisation getDefenseDice uses, so both skill themes spell alike. */
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Skills the roll builder already treats as attacks. Kept in step with getDefenseDice. */
const NATIVE_DEFENSE_SKILLS = {
  rangedlight: "ranged",
  rangedheavy: "ranged",
  gunnery: "ranged",
  melee: "melee",
  brawl: "melee",
  lightsaber: "melee",
};

/**
 * @param {string} skillKey
 * @returns {?("melee"|"ranged")} the defence a stock combat skill faces, or null
 */
export function nativeDefenseKind(skillKey) {
  return NATIVE_DEFENSE_SKILLS[normalize(skillKey)] ?? null;
}

/**
 * @param {string} skillKey
 * @returns {?("melee"|"ranged")} the defence the GM has configured this skill to face, or null
 */
export function additionalDefenseKind(skillKey) {
  const key = normalize(skillKey);
  if (!key) return null;
  const stored = game.settings.get("starwarsffg", SETTING) ?? {};
  for (const kind of ["melee", "ranged"]) {
    const list = Array.isArray(stored[kind]) ? stored[kind] : [];
    if (list.some((entry) => normalize(entry) === key)) return kind;
  }
  return null;
}

export function registerDefenseSkillSettings() {
  game.settings.registerMenu("starwarsffg", SETTING, {
    name: game.i18n.localize("SWFFG.DefenseSkills.Settings.Name"),
    label: game.i18n.localize("SWFFG.DefenseSkills.Settings.Label"),
    hint: game.i18n.localize("SWFFG.DefenseSkills.Settings.Hint"),
    icon: "fa-solid fa-shield-halved",
    type: DefenseSkillsSettings,
    restricted: true,
  });
  game.settings.register("starwarsffg", SETTING, {
    name: SETTING,
    scope: "world",
    default: { melee: [], ranged: [] },
    config: false,
    type: Object,
  });
}

export default class DefenseSkillsSettings extends FFGFormApplication {
  static DEFAULT_OPTIONS = {
    id: "ffg-defense-skills",
    classes: ["starwarsffg", "ffg-defense-skills"],
    window: {
      title: "SWFFG.DefenseSkills.Settings.Title",
      resizable: true,
    },
    position: {
      width: 520,
      height: 600,
    },
    form: {
      closeOnSubmit: true,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/ffg-defense-skills.html",
    },
  };

  /**
   * Every skill the table could roll: the active skill theme, plus any skill that only exists on
   * an actor (skills added to a single sheet never reach CONFIG.FFG.skills).
   */
  _collectSkills() {
    const skills = new Map();
    const add = (key, skill) => {
      if (!key || skills.has(key)) return;
      const label = skill?.label ? game.i18n.localize(skill.label) : key;
      skills.set(key, { key, label, type: skill?.type ?? "" });
    };
    for (const [key, skill] of Object.entries(CONFIG.FFG.skills ?? {})) add(key, skill);
    for (const actor of game.actors) {
      for (const [key, skill] of Object.entries(actor.system?.skills ?? {})) add(key, skill);
    }
    return [...skills.values()].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  }

  async _prepareContext(_options) {
    // The form posts a row index rather than the skill key: keys are free text ("Ranged: Light",
    // or anything a GM typed into a custom skill) and would not survive being used as a field name.
    this._rows = this._collectSkills().map((skill, index) => {
      const native = nativeDefenseKind(skill.key);
      const configured = native ? null : additionalDefenseKind(skill.key);
      return {
        ...skill,
        index,
        native,
        nativeLabel: native ? game.i18n.localize(`SWFFG.DefenseSkills.Native.${native}`) : "",
        isNone: !configured,
        isMelee: configured === "melee",
        isRanged: configured === "ranged",
        search: `${skill.label} ${skill.key} ${skill.type}`.toLowerCase(),
      };
    });
    return { rows: this._rows };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector("input[data-defense-search]");
    const rows = [...this.element.querySelectorAll("tr[data-defense-row]")];
    search?.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      for (const row of rows) row.hidden = !!query && !row.dataset.search.includes(query);
    });
    this.element.querySelector("button[name='reset']")?.addEventListener("click", (event) => {
      event.preventDefault();
      for (const input of this.element.querySelectorAll("input[type='radio'][value='none']")) input.checked = true;
    });
  }

  /** @override */
  async _updateObject(_event, formData) {
    // See LanguageSettings: a submit that carries none of the fields means the form data never
    // reached us, not that every skill was cleared. Refuse to write rather than wipe the setting.
    if (!this._rows?.length || !Object.keys(formData).some((key) => key.startsWith("skill-"))) {
      CONFIG.logger?.warn?.("DefenseSkillsSettings: submit contained no skill fields; ignoring.");
      return;
    }
    const stored = { melee: [], ranged: [] };
    for (const row of this._rows) {
      const choice = formData[`skill-${row.index}`];
      if (choice === "melee" || choice === "ranged") stored[choice].push(row.key);
    }
    await game.settings.set("starwarsffg", SETTING, stored);
  }
}
