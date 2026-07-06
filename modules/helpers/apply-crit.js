/**
 * Apply Crit chat button — gathers the crit context from the attack (target,
 * Vicious quality, the target's existing crits / Durable talent) and opens the
 * system's Critical Roller (helpers/critical-roller.js) in apply mode: the
 * roller's modifier interface drives a draw from the world's Critical
 * RollTable and the resulting crit item is embedded on the target.
 * Crit-ing a minion kills one outright instead (RAW).
 */
import { applyToTargetActor } from "./gm-bridge.js";
import { promptSetupCriticalTables } from "./crit-tables.js";
import CriticalRollerFFG from "./critical-roller.js";

export class ApplyCrit {
  /**
   * Called from the renderChatMessage hook. Enforces visibility (button is
   * removed for users who are neither GM nor the message author, matching Apply
   * Damage), computes crit eligibility from the roll's advantages/triumphs vs the
   * weapon's critical rating, sets the disabled attribute and tooltip when
   * ineligible, and binds the click handler.
   * @param {ChatMessage} message — the live ChatMessage instance.
   * @param {jQuery} html — the rendered chat-message element wrapped in jQuery.
   */
  static bindChatMessage(message, html) {
    const button = html.find(".ffg-apply-crit")[0];
    if (!button) return;

    // Visible to the attack's roller (message author) and GMs only. Non-owning
    // clicks still forward to the active GM via gm-bridge, so this is a UI
    // consistency gate (matching Apply Damage), not a permission boundary.
    const authorId = message.author?.id ?? message.user;
    if (game.user.id !== authorId && !game.user.isGM) {
      button.remove();
      return;
    }

    const roll = message.rolls?.[0];
    const itemSystem = roll?.data?.system;
    const critAdjusted = Number(itemSystem?.crit?.adjusted) || 0;
    const critValue = Number(itemSystem?.crit?.value) || 0;
    const critRating = critAdjusted !== 0 ? critAdjusted : critValue;
    const advantages = Number(roll?.ffg?.advantage) || 0;
    const triumphs = Number(roll?.ffg?.triumph) || 0;
    const eligible = critRating > 0 && (advantages >= critRating || triumphs > 0);

    if (!eligible) {
      button.disabled = true;
      button.title = game.i18n.localize("SWFFG.ApplyCrit.NotEligibleTooltip");
    }

    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (button.disabled) return;
      ApplyCrit.show(message);
    });
  }

  /**
   * Resolve the target, gather the auto-fill modifier values, and open the
   * Critical Roller in apply mode (which rolls, draws from the table, and
   * embeds the result on the target).
   * @param {ChatMessage} message
   */
  static async show(message) {
    const itemData = message.rolls?.[0]?.data;
    if (!itemData) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.ItemMissing"));
      return;
    }
    const itemSystem = itemData.system || {};

    const targets = [...game.user.targets];
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.NoTarget"));
      return;
    }
    const target = targets[0];
    const a = target.actor;
    const type = a?.type;
    if (!["character", "nemesis", "minion", "rival", "vehicle"].includes(type)) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.UnsupportedActor"));
      return;
    }

    // Linked vs unlinked actor resolution (mirrors the macro).
    const isLinked = target.document.actorLink === true;
    const realActor = isLinked ? game.actors.get(a.id) : a;

    if (type === "minion") {
      try {
        const ok = await applyToTargetActor(realActor, { type: "kill-minion" });
        if (!ok) return;
      } catch (err) {
        CONFIG.logger?.warn?.("ApplyCrit: kill minion failed", err);
        ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.TargetGone"));
      }
      return;
    }

    // Existing Critical on Target: count of embedded crit items (+10 each in the roller).
    const existingCrits = realActor.items.filter(
      (i) => i.type === "criticalinjury" || i.type === "criticaldamage"
    ).length;

    // Durable ranks (−10 each). Lookup differs for linked (talentList) vs unlinked (items).
    let durableRanks = 0;
    if (isLinked) {
      const durable = realActor.talentList?.find(
        (t) => (t.name || "").toLowerCase() === "durable"
      );
      durableRanks = Number(durable?.rank) || 0;
    } else {
      const durableItem = realActor.items.find(
        (i) => (i.name || "").toLowerCase() === "durable"
      );
      durableRanks = Number(durableItem?.system?.ranks?.current) || 0;
    }

    // Vicious: substring match on chat-embedded qualities; sum totalRanks.
    // Pre-seeds the roller's flat Additional Modifier at +10 per rank.
    const qualities = itemSystem.doNotSubmit?.qualities || [];
    let viciousRanks = 0;
    for (const q of qualities) {
      const name = (q?.name || "").toLowerCase();
      if (name.includes("vicious")) {
        viciousRanks += Number(q?.totalRanks) || 0;
      }
    }

    // Make sure a Critical RollTable exists; offer the GM the one-click setup.
    let hasTable = game.tables.some((t) => (t.name || "").includes("Critical"));
    if (!hasTable && game.user.isGM) {
      await promptSetupCriticalTables();
      hasTable = game.tables.some((t) => (t.name || "").includes("Critical"));
    }
    if (!hasTable) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.NoTable"));
      return;
    }

    new CriticalRollerFFG({
      applyContext: {
        critType: type === "vehicle" ? "criticaldamage" : "criticalinjury",
        preferredTableName: type === "vehicle" ? "Critical Damage" : "Critical Injuries",
        targetName: a.name,
        actorUuid: realActor.uuid,
        prefill: {
          existing: existingCrits,
          durable: durableRanks,
          other: viciousRanks * 10,
        },
      },
    }).render(true);
  }
}
