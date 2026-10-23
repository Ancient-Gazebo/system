import DiceHelpers from "./dice-helpers.js";
import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

/** The skills the rules name for the check. */
const SKILLS = ["Cool", "Discipline"];
/** Actor flag remembering the skill rolled last time, so the dialog opens on it. */
const SKILL_FLAG = "strainRecoverySkill";
/** Message flag marking the check's card. */
const FLAG = "strainRecovery";
/** Radio value for the "Other Skill" row, which reads its skill from the dropdown. */
const OTHER = "__other";

/**
 * End-of-encounter strain recovery, behind the strain box's Recover Strain button: a Simple (-) Cool
 * or Discipline check, each net success removing one strain. A character whose talent lets them
 * recover with another skill picks it from the dialog's Other Skill row.
 *
 * The check goes through the ordinary roll dialog, so boost dice and the like can still be added by
 * hand, and the strain comes off as soon as it is rolled. Advantage is left on the card for Spend
 * Results, as on any other check.
 */
export default class StrainRecovery {
  /**
   * Ask which skill to roll, then open the roll dialog for it.
   * @param {Actor} actor
   */
  static async open(actor) {
    if (!actor?.isOwner) return;
    if (actor.verifyEditModeIsNotEnabled && !actor.verifyEditModeIsNotEnabled()) return;
    const strain = actor.system?.stats?.strain;
    if (!(Number(strain?.value) > 0)) {
      return ui.notifications.info(game.i18n.format("SWFFG.StrainRecovery.NoStrain", { name: actor.name }));
    }

    const skills = actor.system?.skills ?? {};
    const label = (key) => (skills[key]?.label ? game.i18n.localize(skills[key].label) : key);
    const pools = {};
    for (const key of SKILLS.filter((key) => skills[key])) pools[key] = await this.pool(actor, key);

    const others = Object.keys(skills)
      .filter((key) => !SKILLS.includes(key))
      .map((key) => ({ key, label: label(key) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const selected = this.defaultSkill(actor, pools);
    const otherSelected = !(selected in pools);
    for (const other of others) other.selected = other.key === selected;

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/starwarsffg/templates/actors/dialogs/ffg-strain-recovery.html",
      {
        current: game.i18n.format("SWFFG.StrainRecovery.Current", { value: strain.value, max: strain.max ?? 0 }),
        choices: Object.keys(pools).map((key) => ({ key, label: label(key), selected: key === selected })),
        others,
        other: OTHER,
        otherSelected,
      }
    );

    // The Roll button answers with an object: a callback returning nothing makes `wait` resolve
    // with the button's action name instead, which would be mistaken for a skill.
    const answer = await DialogV2.wait({
      window: { title: game.i18n.localize("SWFFG.StrainRecovery.Title"), icon: "fas fa-spa" },
      classes: ["dialog", "starwarsffg"],
      position: { width: 380 },
      content,
      render: (event, dialog) => this._activateDialog(actor, pools, dialog),
      buttons: [
        {
          action: "roll",
          icon: "fas fa-dice-d20",
          label: game.i18n.localize("SWFFG.StrainRecovery.Roll"),
          default: true,
          callback: (event, button, dialog) => {
            const element = dialog.element;
            const choice = element.querySelector(`input[name="strainRecoverySkill"]:checked`)?.value;
            return { skill: choice === OTHER ? element.querySelector(".strain-recovery-other")?.value || null : choice ?? null };
          },
        },
        {
          action: "cancel",
          icon: "fas fa-times",
          label: game.i18n.localize("SWFFG.Cancel"),
        },
      ],
      rejectClose: false,
    });
    if (answer?.skill) await this.roll(actor, answer.skill);
  }

  /**
   * The pool a skill rolls for the check: its usual dice and skill modifiers, no difficulty.
   * @param {Actor} actor
   * @param {string} skill
   */
  static async pool(actor, skill) {
    return (await DiceHelpers.assemblePool({ actorData: actor.system, baseSkillKey: skill, baseDifficulty: 0 })).dicePool;
  }

  /**
   * The skill the dialog opens on: the one rolled last time, else whichever of Cool and Discipline
   * expects more successes (Cool on a tie). Counting proficiency dice alone is not enough: one
   * proficiency and two ability dice beat two proficiency dice.
   * @param {Actor} actor
   * @param {Object<string, DicePoolFFG>} pools
   */
  static defaultSkill(actor, pools) {
    const remembered = actor.getFlag("starwarsffg", SKILL_FLAG);
    if (remembered && actor.system?.skills?.[remembered]) return remembered;
    let best = null;
    for (const key of Object.keys(pools)) {
      if (!best || this.expectedSuccesses(pools[key]) > this.expectedSuccesses(pools[best])) best = key;
    }
    return best ?? Object.keys(actor.system?.skills ?? {})[0] ?? null;
  }

  /**
   * Average successes a difficulty-free pool rolls, net of the failures its setback dice and
   * symbols add. Per die: proficiency 10/12 (triumph included), ability 5/8, boost 2/6, setback -2/6.
   * @param {DicePoolFFG} pool
   */
  static expectedSuccesses(pool) {
    const n = (value) => Number(value) || 0;
    const { setback } = pool.resolveSetback();
    return (
      (n(pool.proficiency) * 10) / 12 +
      (n(pool.ability) * 5) / 8 +
      (n(pool.boost) - n(setback)) / 3 +
      n(pool.success) + n(pool.triumph) - n(pool.failure) - n(pool.despair)
    );
  }

  /**
   * Draw each row's dice, and keep the Other Skill row's dice (and its radio) following its dropdown.
   * Wired here because the ApplicationV2 render pipeline never runs a template's inline script.
   */
  static _activateDialog(actor, pools, dialog) {
    const element = dialog?.element;
    if (!element) return;
    for (const [key, pool] of Object.entries(pools)) {
      const target = element.querySelector(`.strain-recovery-pool[data-skill="${key}"]`);
      if (target) pool.renderPreview(target);
    }

    const select = element.querySelector(".strain-recovery-other");
    const otherPool = element.querySelector(`.strain-recovery-pool[data-skill="${OTHER}"]`);
    const showOther = async () => {
      if (!select?.value || !otherPool) return;
      const pool = await this.pool(actor, select.value);
      otherPool.replaceChildren();
      pool.renderPreview(otherPool);
    };
    select?.addEventListener("change", () => {
      const radio = element.querySelector(`input[name="strainRecoverySkill"][value="${OTHER}"]`);
      if (radio) radio.checked = true;
      showOther();
    });
    showOther();
  }

  /**
   * Open the roll dialog for the check.
   * @param {Actor} actor
   * @param {string} skill
   */
  static async roll(actor, skill) {
    const assemble = async (overrides) =>
      DiceHelpers.assemblePool({ actorData: actor.system, baseSkillKey: skill, overrides, baseDifficulty: 0 });
    const rolled = await assemble(null);
    const label = game.i18n.localize(rolled.label);
    const sheetData = await actor.sheet.getData();

    await DiceHelpers.displayRollDialog(
      sheetData,
      rolled.dicePool,
      `${game.i18n.localize("SWFFG.Rolling")} ${label}`,
      rolled.label,
      { name: label, type: "skill" },
      game.i18n.localize("SWFFG.StrainRecovery.Flavor"),
      undefined,
      {
        profile: DiceHelpers.buildProfileOptions(actor.system, null, rolled, assemble),
        messageFlags: { [FLAG]: { actorUuid: actor.uuid, skill } },
        onRolled: (message, roll) => this._onRolled(actor, skill, message, roll),
      }
    );
  }

  /** Take the successes off the actor's strain and say so in chat. */
  static async _onRolled(actor, skill, message, roll) {
    actor = (await foundry.utils.fromUuid(actor.uuid)) ?? actor;
    const successes = Math.max(0, Number((roll ?? message.rolls?.[0])?.ffg?.success) || 0);
    const before = Math.max(0, Number(actor.system?.stats?.strain?.value) || 0);
    const after = Math.max(0, before - successes);

    const update = {};
    if (after !== before) update["system.stats.strain.value"] = after;
    if (actor.getFlag("starwarsffg", SKILL_FLAG) !== skill) update[`flags.starwarsffg.${SKILL_FLAG}`] = skill;
    if (!foundry.utils.isEmpty(update)) await actor.update(update);

    const text =
      after === before
        ? game.i18n.localize("SWFFG.StrainRecovery.NoneRecovered")
        : game.i18n.format("SWFFG.StrainRecovery.Recovered", { amount: before - after, from: before, to: after });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<i>${text}</i>`,
      // a check rolled privately reports privately
      whisper: message?.whisper ?? [],
    });
  }
}
