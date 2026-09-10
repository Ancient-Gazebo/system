import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

/**
 * Temporary skill / characteristic substitution for a check.
 *
 * A number of talents let a character roll a weapon with a skill or a characteristic other than the
 * one printed on it - "use Mechanics for its rolls instead until the end of the encounter", a
 * lightsaber form that swaps Brawn for Willpower, and so on. Editing the weapon (or the actor's
 * skill) to do that is destructive and easy to forget to undo, so the substitution lives here
 * instead, in three layers:
 *
 *  1. per-roll        - the two dropdowns in the roll dialog, stored nowhere.
 *  2. per-weapon      - `flags.starwarsffg.rollOverride`, in force until it is explicitly cleared.
 *  3. saved profiles  - `flags.starwarsffg.rollProfiles`, named (skill, characteristic) pairs the
 *                       user can re-apply with one click.
 *
 * Both live in FLAGS rather than `system.*` deliberately: the DataModels are generated from
 * template.json (see modules/datamodels/README.md), so a `system` field would have to be added
 * there and regenerated, and any path not in the schema is pruned on the next save. Flags are
 * outside the schema and survive untouched.
 *
 * The skill and the characteristic are independent on purpose. The Mechanics talent above reads
 * "you must still use the base characteristic for the weapon", i.e. take Mechanics' RANK but keep
 * the weapon's own characteristic - which is only expressible if the two are separate choices.
 * A null value means "follow the default" (the weapon's skill; that skill's characteristic).
 *
 * What an override deliberately does NOT touch: the weapon's damage. Damage adds
 * `system.characteristic.value` in Actor#_applyCharacteristicDamage, which stays on the weapon's
 * own characteristic no matter what the check is rolled with.
 */
export default class RollProfiles {
  /** Item flag holding the currently active override. */
  static OVERRIDE_FLAG = "rollOverride";
  /** Item flag holding the list of saved, re-applicable profiles. */
  static PROFILES_FLAG = "rollProfiles";

  /**
   * The "no override" value.
   *
   * Written in place of deleting the flag: `unsetFlag` issues a `-=key` deletion, and V14's
   * mergeObject silently drops those, which would leave a stale override in place with no error.
   * Explicit nulls are ordinary values and always land.
   */
  static get EMPTY_OVERRIDE() {
    return { skill: null, characteristic: null };
  }

  /**
   * The override currently stored on an item, or null when there is none.
   * @param {Item|object} item
   * @returns {?{skill: ?string, characteristic: ?string}}
   */
  static getOverride(item) {
    const override = item?.flags?.starwarsffg?.[this.OVERRIDE_FLAG];
    if (!override) return null;
    if (!override.skill && !override.characteristic) return null;
    return override;
  }

  /**
   * Store (or clear) an item's override.
   * @param {Item} item
   * @param {{skill: ?string, characteristic: ?string}} selection
   */
  static async setOverride(item, { skill = null, characteristic = null } = {}) {
    if (!item?.setFlag) return;
    if (!skill && !characteristic) return this.clearOverride(item);
    return item.setFlag("starwarsffg", this.OVERRIDE_FLAG, { skill: skill || null, characteristic: characteristic || null });
  }

  /**
   * Clear an item's override. See EMPTY_OVERRIDE for why this writes nulls instead of unsetting.
   * @param {Item} item
   */
  static async clearOverride(item) {
    if (!item?.setFlag) return;
    if (!this.getOverride(item)) return;
    return item.setFlag("starwarsffg", this.OVERRIDE_FLAG, this.EMPTY_OVERRIDE);
  }

  /**
   * The saved profiles on an item.
   * @param {Item|object} item
   * @returns {Array<{id: string, label: string, skill: ?string, characteristic: ?string}>}
   */
  static getProfiles(item) {
    const profiles = item?.flags?.starwarsffg?.[this.PROFILES_FLAG];
    return Array.isArray(profiles) ? profiles : [];
  }

  /**
   * Add a named profile to an item (replacing one of the same name).
   * @param {Item} item
   * @param {{label: string, skill: ?string, characteristic: ?string}} profile
   */
  static async saveProfile(item, { label, skill = null, characteristic = null }) {
    if (!item?.setFlag || !label) return;
    const profiles = this.getProfiles(item).filter((p) => p.label !== label);
    profiles.push({ id: foundry.utils.randomID(), label, skill: skill || null, characteristic: characteristic || null });
    // The whole array is written back: array values replace rather than merge, so this needs no
    // deletion syntax to drop the entry it replaced.
    return item.setFlag("starwarsffg", this.PROFILES_FLAG, profiles);
  }

  /**
   * Remove a saved profile from an item.
   * @param {Item} item
   * @param {string} id
   */
  static async deleteProfile(item, id) {
    if (!item?.setFlag) return;
    const profiles = this.getProfiles(item).filter((p) => p.id !== id);
    return item.setFlag("starwarsffg", this.PROFILES_FLAG, profiles);
  }

  /**
   * Resolve the (skill, characteristic) pair a check should actually roll.
   *
   * Precedence: an explicit per-roll selection (the roll dialog's dropdowns) replaces the stored
   * override wholesale - the dialog is seeded FROM the stored override, so once the user touches it
   * their choice is the whole answer, including choosing "default" to undo the stored value.
   *
   * @param {object} actorData       the actor's `system` data (or a sheet getData()'s `data`)
   * @param {Item|object} [item]     the item being rolled, if any
   * @param {?object} [explicit]     `{skill, characteristic}` chosen for this roll only
   * @param {?string} [baseSkillKey] the skill the roll started from, for non-item rolls
   * @returns {{skill: ?string, characteristic: ?string, baseSkill: ?string, overridden: boolean}}
   */
  static resolve(actorData, item, explicit = null, baseSkillKey = null) {
    const baseSkill = item?.system?.skill?.value || baseSkillKey || null;
    const source = explicit ?? this.getOverride(item) ?? {};
    const skill = source.skill || baseSkill;
    // The characteristic falls back to the RESOLVED skill's own characteristic, so leaving it on
    // "default" while swapping the skill performs a full swap; pinning it is what expresses
    // "different skill, same characteristic".
    const characteristic = source.characteristic || actorData?.skills?.[skill]?.characteristic || null;
    return {
      skill,
      characteristic,
      baseSkill,
      overridden: Boolean(source.skill || source.characteristic),
    };
  }

  /**
   * The skill choices for a dropdown, drawn from the actor so the world's skill theme and any
   * custom skills are included.
   * @param {object} actorData
   * @param {?string} [selected]
   */
  static skillChoices(actorData, selected = null) {
    return Object.entries(actorData?.skills ?? {})
      .map(([key, skill]) => ({
        key,
        label: skill?.label ? game.i18n.localize(skill.label) : key,
        selected: key === selected,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * The characteristic choices for a dropdown.
   * @param {?string} [selected]
   */
  static characteristicChoices(selected = null) {
    return Object.entries(CONFIG.FFG.characteristics ?? {}).map(([key, characteristic]) => ({
      key,
      label: characteristic?.label ? game.i18n.localize(characteristic.label) : key,
      selected: key === selected,
    }));
  }

  /**
   * Human-readable label for a skill key, using the actor's own entry when it has one (custom
   * skills only exist there) and CONFIG otherwise.
   * @param {object} actorData
   * @param {?string} key
   */
  static skillLabel(actorData, key) {
    if (!key) return "";
    const label = actorData?.skills?.[key]?.label ?? CONFIG.FFG.skills?.[key]?.label;
    return label ? game.i18n.localize(label) : key;
  }

  /**
   * Human-readable label for a characteristic key.
   * @param {?string} key
   */
  static characteristicLabel(key) {
    if (!key) return "";
    const label = CONFIG.FFG.characteristics?.[key]?.label;
    return label ? game.i18n.localize(label) : key;
  }

  /**
   * The short "Mechanics / Agility" badge text for an item's active override, or "" when it has
   * none. Only the parts that actually differ from the default are named.
   * @param {object} actorData
   * @param {Item|object} item
   */
  static badgeLabel(actorData, item) {
    const override = this.getOverride(item);
    if (!override) return "";
    const resolved = this.resolve(actorData, item);
    const parts = [];
    if (override.skill) parts.push(this.skillLabel(actorData, resolved.skill));
    if (override.characteristic) parts.push(this.characteristicLabel(resolved.characteristic));
    return parts.join(" / ");
  }

  /**
   * Open the per-weapon override editor: pick a saved profile or a skill/characteristic pair, choose
   * how long it lasts, and optionally save the pair as a new profile.
   * @param {Actor} actor
   * @param {Item} item
   */
  static async prompt(actor, item) {
    if (!actor || !item) return;
    const actorData = actor.system ?? {};
    const stored = this.getOverride(item) ?? {};
    const resolved = this.resolve(actorData, item);

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/starwarsffg/templates/actors/dialogs/ffg-roll-profile.html",
      {
        itemName: item.name,
        skills: this.skillChoices(actorData, stored.skill),
        characteristics: this.characteristicChoices(stored.characteristic),
        autoSkillLabel: game.i18n.format("SWFFG.RollProfile.DefaultSkill", { skill: this.skillLabel(actorData, resolved.baseSkill) }),
        autoCharacteristicLabel: game.i18n.format("SWFFG.RollProfile.DefaultCharacteristic", { characteristic: this.characteristicLabel(resolved.characteristic) }),
        profiles: this.getProfiles(item).map((profile) => ({
          id: profile.id,
          label: profile.label,
          summary: this.profileSummary(actorData, profile),
        })),
      }
    );

    const readSelection = (dialog) => {
      const html = $(dialog.element);
      return {
        skill: html.find(".roll-profile-skill").val() || null,
        characteristic: html.find(".roll-profile-characteristic").val() || null,
        saveAs: (html.find(".roll-profile-save-as").val() || "").trim(),
      };
    };

    await DialogV2.wait({
      window: { title: game.i18n.format("SWFFG.RollProfile.DialogTitle", { name: item.name }) },
      classes: ["dialog", "starwarsffg"],
      position: { width: 420 },
      content,
      render: (event, dialog) => this._activateProfileDialog(actorData, item, dialog),
      buttons: [
        {
          action: "apply",
          icon: "fas fa-check",
          label: game.i18n.localize("SWFFG.RollProfile.Apply"),
          default: true,
          callback: async (event, button, dialog) => {
            const selection = readSelection(dialog);
            if (selection.saveAs) {
              await this.saveProfile(item, { label: selection.saveAs, skill: selection.skill, characteristic: selection.characteristic });
            }
            await this.setOverride(item, selection);
          },
        },
        {
          action: "clear",
          icon: "fas fa-times-circle",
          label: game.i18n.localize("SWFFG.RollProfile.Clear"),
          callback: async () => this.clearOverride(item),
        },
        {
          action: "cancel",
          icon: "fas fa-times",
          label: game.i18n.localize("SWFFG.Cancel"),
        },
      ],
      rejectClose: false,
    });
  }

  /**
   * Wire the override editor's live behaviour: loading a saved profile into the two dropdowns,
   * deleting a profile, and keeping the "(default - X)" characteristic option honest as the skill
   * selection changes.
   *
   * Done here rather than in the template because the ApplicationV2 render pipeline assigns
   * innerHTML, which never executes an inline script tag.
   */
  static _activateProfileDialog(actorData, item, dialog) {
    const html = $(dialog?.element);
    if (!html.length) return;

    const skillSelect = html.find(".roll-profile-skill");
    const characteristicSelect = html.find(".roll-profile-characteristic");

    const syncDefaultCharacteristic = () => {
      const resolved = this.resolve(actorData, item, { skill: skillSelect.val() || null, characteristic: null });
      const option = characteristicSelect.find("option[value='']")[0];
      if (option) {
        option.textContent = game.i18n.format("SWFFG.RollProfile.DefaultCharacteristic", {
          characteristic: this.characteristicLabel(resolved.characteristic),
        });
      }
    };

    skillSelect.on("change", syncDefaultCharacteristic);
    syncDefaultCharacteristic();

    const profileSelect = html.find(".roll-profile-load");
    const deleteButton = html.find(".roll-profile-delete");

    profileSelect.on("change", (event) => {
      // Delete acts on the selected profile, so it is only live while one is selected - "None" is a
      // valid selection that means "leave the dropdowns alone", not a profile that can be deleted.
      deleteButton.prop("disabled", !event.currentTarget.value);
      const profile = this.getProfiles(item).find((p) => p.id === event.currentTarget.value);
      if (!profile) return;
      skillSelect.val(profile.skill ?? "");
      characteristicSelect.val(profile.characteristic ?? "");
      syncDefaultCharacteristic();
    });

    deleteButton.on("click", async (event) => {
      // The button lives inside DialogV2's form; type="button" in the template keeps a click from
      // submitting it, and preventDefault covers any browser that ignores that.
      event.preventDefault();
      const id = profileSelect.val();
      if (!id) return;
      const profile = this.getProfiles(item).find((p) => p.id === id);
      await this.deleteProfile(item, id);
      // The dialog is not re-rendered by the item update, so its own copy of the list is pruned by
      // hand rather than left showing a profile that no longer exists.
      profileSelect.find("option").filter((index, el) => el.value === id).remove();
      profileSelect.val("");
      deleteButton.prop("disabled", true);
      if (profile?.label) {
        ui.notifications.info(game.i18n.format("SWFFG.RollProfile.ProfileDeleted", { label: profile.label }));
      }
      // Nothing is left to pick from: drop the row so the dialog does not show an empty picker.
      if (!profileSelect.find("option").filter((index, el) => !!el.value).length) {
        profileSelect.closest(".roll-profile-row").remove();
      }
    });
  }

  /**
   * "Lightsaber / Willpower"-style summary of a saved profile, for the profile picker.
   * @param {object} actorData
   * @param {{skill: ?string, characteristic: ?string}} profile
   */
  static profileSummary(actorData, profile) {
    const parts = [];
    if (profile?.skill) parts.push(this.skillLabel(actorData, profile.skill));
    if (profile?.characteristic) parts.push(this.characteristicLabel(profile.characteristic));
    return parts.join(" / ");
  }
}
