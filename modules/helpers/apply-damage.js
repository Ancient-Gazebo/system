/**
 * Apply Damage chat button — opens a dialog seeded from the weapon item and the
 * roll's successes, applies the resulting damage to the user's targeted token,
 * and posts a short public chat message plus a detailed GM whisper.
 */
import { applyToTargetActor } from "./gm-bridge.js";

const { DialogV2 } = foundry.applications.api;

export class ApplyDamage {
  /** Message ids with an Apply Damage dialog currently open, so repeated
   * clicks on the chat button can't stack dialogs (and double-apply). */
  static _openDialogs = new Set();

  /**
   * Called from the renderChatMessage hook. Enforces visibility (button is
   * removed for users who are neither GM nor the message author) and binds
   * the click handler.
   * @param {ChatMessage} message — the live ChatMessage instance.
   * @param {jQuery} html — the rendered chat-message element wrapped in jQuery.
   */
  static bindChatMessage(message, html) {
    const button = html.find(".ffg-apply-damage")[0];
    if (!button) return;

    const authorId = message.author?.id ?? message.user;
    if (game.user.id !== authorId && !game.user.isGM) {
      button.remove();
      return;
    }

    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ApplyDamage.show(message);
    });
  }

  /**
   * Resolve the weapon and the targeted token, open the dialog, perform the
   * damage math on Apply, and post the chat messages.
   * @param {ChatMessage} message
   */
  static async show(message) {
    if (ApplyDamage._openDialogs.has(message.id)) return;

    // The weapon attack chat message embeds the rendered/adjusted weapon data
    // directly on the roll (see modules/dice/roll.js render() — it assigns
    // item.toObject + computed details onto roll.data). That copy already has
    // doNotSubmit.qualities with totalRanks and damage.adjusted, so we don't
    // need to re-resolve the live item via fromUuid — which can fail when the
    // item lived on an unlinked-token actor or was deleted.
    const itemData = message.rolls?.[0]?.data;
    if (!itemData) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.ItemMissing"));
      return;
    }

    const targets = [...game.user.targets];
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.NoTarget"));
      return;
    }
    const target = targets[0];
    const a = target.actor;
    const type = a?.type;

    let woundLabel, strainLabel, soakValue, soakWord, woundPath, strainPath, showRadio;
    if (type === "vehicle") {
      showRadio = true;
      woundLabel = game.i18n.localize("SWFFG.VehicleHullTrauma");
      strainLabel = game.i18n.localize("SWFFG.VehicleHullStrain");
      soakWord = "armour";
      soakValue = Number(a.system.stats?.armour?.value) || 0;
      woundPath = "system.stats.hullTrauma.value";
      strainPath = "system.stats.systemStrain.value";
    } else if (type === "minion" || type === "rival") {
      showRadio = false;
      woundLabel = game.i18n.localize("SWFFG.Wounds");
      strainLabel = null;
      soakWord = "soak";
      soakValue = Number(a.system.stats?.soak?.value) || 0;
      woundPath = "system.stats.wounds.value";
      strainPath = null;
    } else if (type === "character" || type === "nemesis") {
      showRadio = true;
      woundLabel = game.i18n.localize("SWFFG.Wounds");
      strainLabel = game.i18n.localize("SWFFG.Strain");
      soakWord = "soak";
      soakValue = Number(a.system.stats?.soak?.value) || 0;
      woundPath = "system.stats.wounds.value";
      strainPath = "system.stats.strain.value";
    } else {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.UnsupportedActor"));
      return;
    }

    // Damage and qualities are read straight from the chat-embedded item data.
    const itemSystem = itemData.system || {};
    const adjusted = Number(itemSystem.damage?.adjusted) || 0;
    const baseValue = Number(itemSystem.damage?.value) || 0;
    const baseDamage = adjusted !== 0 ? adjusted : baseValue;
    const successes = Number(message.rolls?.[0]?.ffg?.success) || 0;
    const autoDamage = baseDamage + successes;

    // The rendered qualities live at system.doNotSubmit.qualities with computed
    // totalRanks (including attachment stacking). Names may carry a suffix like
    // " Quality" (e.g. "Pierce Quality"); substring match handles both forms.
    const qualities = itemSystem.doNotSubmit?.qualities || [];
    let pierceRanks = 0;
    let breachRanks = 0;
    for (const q of qualities) {
      const name = (q?.name || "").toLowerCase();
      const ranks = Number(q?.totalRanks ?? 0) || 0;
      if (name.includes("pierce")) pierceRanks += ranks;
      else if (name.includes("breach")) breachRanks += ranks;
    }
    const autoPierce = pierceRanks + 10 * breachRanks;

    const damageLabel = game.i18n.localize("SWFFG.ApplyDamage.Damage");
    const pierceLabel = game.i18n.localize("SWFFG.Pierce");
    const parryLabel = game.i18n.localize("SWFFG.ApplyDamage.ParryRanks");
    const reductionLabel = game.i18n.localize("SWFFG.ApplyDamage.Reduction");
    const applyLabel = game.i18n.localize("SWFFG.ApplyDamage.Apply");
    const cancelLabel = game.i18n.localize("SWFFG.ApplyDamage.Cancel");
    const radioHtml = showRadio
      ? `<div class="form-group" style="margin-bottom:10px;">
           <label><input type="radio" name="pool" value="wounds" checked> ${woundLabel}</label>
           <label style="margin-left:16px;"><input type="radio" name="pool" value="strain"> ${strainLabel}</label>
         </div>`
      : `<div class="form-group" style="margin-bottom:10px;"><strong>${woundLabel}</strong></div>`;

    const content = `
      ${radioHtml}
      <div style="display:grid; grid-template-columns: 150px 1fr; gap:6px 10px; align-items:center;">
        <label>${damageLabel}:</label>
        <input type="number" name="damage" value="${autoDamage}" min="0" style="width:100%;"/>
        <label>${pierceLabel}:</label>
        <input type="number" name="pierce" value="${autoPierce}" min="0" style="width:100%;"/>
        <label>${parryLabel}:</label>
        <input type="number" name="parry" value="0" min="0" style="width:100%;"/>
        <label>${reductionLabel}:</label>
        <input type="number" name="reduction" value="0" min="0" style="width:100%;"/>
      </div>
    `;

    const weaponName = itemData.name || itemSystem.name || "weapon";
    const title = game.i18n.format("SWFFG.ApplyDamage.DialogTitle", { name: a.name });

    // Guards a rapid double-click (or Enter + click) on the Apply button from
    // running the callback -- and deducting the damage -- twice.
    let submitted = false;

    ApplyDamage._openDialogs.add(message.id);
    DialogV2.wait({
      window: { title },
      content,
      buttons: [
        {
          action: "apply",
          icon: "fas fa-burst",
          label: applyLabel,
          default: true,
          callback: async (event, button, dialog) => {
            if (submitted) return;
            submitted = true;
            const root = dialog.element;
            const damage = Math.max(0, parseInt(root.querySelector('input[name="damage"]')?.value, 10) || 0);
            const pierce = Math.max(0, parseInt(root.querySelector('input[name="pierce"]')?.value, 10) || 0);
            const parryRanks = Math.max(0, parseInt(root.querySelector('input[name="parry"]')?.value, 10) || 0);
            const reduction = Math.max(0, parseInt(root.querySelector('input[name="reduction"]')?.value, 10) || 0);
            const pool = showRadio ? root.querySelector('input[name="pool"]:checked')?.value : "wounds";
            const path = pool === "strain" ? strainPath : woundPath;
            const poolLabel = pool === "strain" ? strainLabel : woundLabel;
            if (!path) {
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.UnsupportedActor"));
              return;
            }

            // Parry / Reflect reduces damage by 2 + ranks (only when ranks were
            // spent), and Damage Reduction is a flat manual reduction — both come
            // off the incoming damage BEFORE soak is applied.
            const parryReduction = parryRanks > 0 ? 2 + parryRanks : 0;
            const reducedDamage = Math.max(0, damage - parryReduction - reduction);
            const effectiveSoak = Math.max(0, soakValue - pierce);
            const applied = Math.max(0, reducedDamage - effectiveSoak);

            const speaker = ChatMessage.getSpeaker({ token: target.document });
            const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);

            // Detailed breakdown for the GM only. It must be authored by a GM:
            // a chat message's author always sees it regardless of whisper, so if
            // the attacking (non-owning) player posted this, they would see the
            // target's soak/pierce math. When the damage write is forwarded to the
            // GM, the GM posts this whisper too; we only post it here when we
            // applied the damage locally (i.e. we are the GM or the target's owner).
            const gmChat = {
              speaker,
              whisper: gmIds,
              content: `<p>${game.i18n.format("SWFFG.ApplyDamage.GMDetails", {
                actorName: a.name,
                applied,
                poolLabel,
                damage,
                parryReduction,
                reduction,
                effectiveSoak,
                soakWord,
                pierce,
                soak: soakValue,
              })}</p>`,
            };

            let result;
            try {
              // Writes to the target actor; when the clicking player does not own
              // the target, this forwards to the active GM along with gmChat
              // (see gm-bridge.js).
              result = await applyToTargetActor(a, { type: "damage", path, delta: applied, gmChat });
              if (!result) return;
            } catch (err) {
              CONFIG.logger?.warn?.("ApplyDamage: actor.update failed", err);
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.TargetGone"));
              return;
            }

            // Public line for everyone. Reports the wounds actually applied
            // (post soak/parry/reduction) so it matches the GM breakdown and
            // the target's bar; the math itself stays GM-only.
            await ChatMessage.create({
              speaker,
              content: `<p>${game.i18n.format("SWFFG.ApplyDamage.PublicMessage", {
                actorName: a.name,
                damage: applied,
                poolLabel,
                weaponName,
              })}</p>`,
            });

            // On the forwarded path the GM already posted the whisper.
            if (result === "local") {
              await ChatMessage.create(gmChat);
            }
          },
        },
        {
          action: "cancel",
          icon: "fas fa-times",
          label: cancelLabel,
        },
      ],
      rejectClose: false,
    }).finally(() => ApplyDamage._openDialogs.delete(message.id));
  }
}
