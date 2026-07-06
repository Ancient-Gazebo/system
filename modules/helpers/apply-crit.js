/**
 * Apply Crit chat button — opens a dialog seeded from the weapon's Vicious
 * quality and the target's existing crits / Durable talent, rolls the macro's
 * crit formula against a chosen critical table, embeds the resulting crit item
 * on the target, and posts the item description to public chat.
 */
import { applyToTargetActor } from "./gm-bridge.js";
import { promptSetupCriticalTables } from "./crit-tables.js";

const { DialogV2 } = foundry.applications.api;

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
   * Resolve the target, gather auto-fill values, open the dialog, run the crit
   * roll on Roll, embed the result item, and post the description.
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

    // Modifier: count existing crit items × 10.
    const existingCrits = realActor.items.filter(
      (i) => i.type === "criticalinjury" || i.type === "criticaldamage"
    ).length;
    const autoModifier = existingCrits * 10;

    // Durable: ranks × 10. Lookup differs for linked (talentList) vs unlinked (items).
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
    const autoDurable = durableRanks * 10;

    // Vicious: substring match on chat-embedded qualities; sum totalRanks.
    const qualities = itemSystem.doNotSubmit?.qualities || [];
    let autoViciousRanks = 0;
    for (const q of qualities) {
      const name = (q?.name || "").toLowerCase();
      if (name.includes("vicious")) {
        autoViciousRanks += Number(q?.totalRanks) || 0;
      }
    }

    // Critical tables in this world. If none exist yet, offer the GM the
    // one-click setup (crit-tables.js) and continue with the created tables.
    let critTables = game.tables.filter((t) => (t.name || "").includes("Critical"));
    if (critTables.length === 0 && game.user.isGM) {
      await promptSetupCriticalTables();
      critTables = game.tables.filter((t) => (t.name || "").includes("Critical"));
    }
    if (critTables.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.NoTable"));
      return;
    }
    const preferredTableName = type === "vehicle" ? "Critical Damage" : "Critical Injuries";
    const tableOptions = critTables
      .map((t) => {
        const selected = t.name === preferredTableName ? " selected" : "";
        return `<option value="${t.id}"${selected}>${t.name}</option>`;
      })
      .join("");

    const modifierLabel = game.i18n.localize("SWFFG.ApplyCrit.Modifier");
    const durableLabel = game.i18n.localize("SWFFG.ApplyCrit.Durable");
    const viciousLabel = game.i18n.localize("SWFFG.ApplyCrit.Vicious");
    const tableLabel = game.i18n.localize("SWFFG.ApplyCrit.Table");
    const rollLabel = game.i18n.localize("SWFFG.ButtonRoll");
    const cancelLabel = game.i18n.localize("SWFFG.ApplyDamage.Cancel");
    const title = game.i18n.format("SWFFG.ApplyCrit.DialogTitle", { name: a.name });

    const content = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="padding:4px 8px; display:flex; align-items:center; gap:8px;">
          <label style="white-space:nowrap;">${modifierLabel}:</label>
          <input name="modifier" class="modifier" style="flex:1 1 auto; min-width:0;" type="text"
                 value="${autoModifier}" data-dtype="String" />
        </div>
        <div style="padding:4px 8px; display:flex; align-items:center; gap:12px;">
          <span>${durableLabel}: ${autoDurable}</span>
          <span style="display:inline-block; width:1px; height:20px; background:#888;"></span>
          <span style="display:flex; align-items:center; gap:6px;">
            ${viciousLabel}: <span class="vicious-rank">${autoViciousRanks}</span>
            <button type="button" class="vicious-minus" style="width:24px; height:22px; line-height:1; padding:0;">−</button>
            <button type="button" class="vicious-plus" style="width:24px; height:22px; line-height:1; padding:0;">+</button>
          </span>
        </div>
        <div style="padding:4px 8px; display:flex; align-items:center; gap:8px;">
          <label style="white-space:nowrap;">${tableLabel}:</label>
          <select class="crittable" style="flex:1 1 auto; min-width:0;">${tableOptions}</select>
        </div>
      </div>
    `;

    DialogV2.wait({
      window: { title },
      content,
      buttons: [
        {
          action: "roll",
          icon: "fas fa-check",
          label: rollLabel,
          default: true,
          callback: async (event, button, dialog) => {
            const root = dialog.element;
            const modifier = parseInt(root.querySelector(".modifier")?.value, 10) || 0;
            const viciousRank = parseInt(root.querySelector(".vicious-rank")?.textContent, 10) || 0;
            const viciousMod = viciousRank * 10;
            const tableId = root.querySelector(".crittable")?.value;

            const table = game.tables.get(tableId);
            if (!table) {
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.NoTable"));
              return;
            }

            const formula = `max(1d100 + ${modifier} - ${autoDurable} + ${viciousMod}, 1)`;
            const critRoll = new Roll(formula);
            const draw = await table.draw({ roll: critRoll, displayChat: true });

            const firstResult = draw?.results?.[0];
            if (!firstResult) return;
            // V13 stores a document result as a uuid; resolve it directly
            // (firstResult.documentId still works but is a deprecated shim).
            // fromUuid also resolves compendium-linked results, unlike the
            // upstream game.items.get() lookup.
            const item = firstResult.documentUuid ? await fromUuid(firstResult.documentUuid) : null;
            if (!item || item.documentName !== "Item") return;

            try {
              // Embeds the crit item on the target actor; when the clicking
              // player does not own the target, this forwards to the active GM
              // (see gm-bridge.js).
              const ok = await applyToTargetActor(realActor, { type: "crit", items: [item.toObject()] });
              if (!ok) return;
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ token: target.document }),
                content: item.system?.description ?? "",
              });
            } catch (err) {
              CONFIG.logger?.warn?.("ApplyCrit: createEmbeddedDocuments failed", err);
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.TargetGone"));
            }
          },
        },
        {
          action: "cancel",
          icon: "fas fa-times",
          label: cancelLabel,
        },
      ],
      render: (event, dialog) => {
        const root = dialog.element;
        const rankEl = root.querySelector(".vicious-rank");
        root.querySelector(".vicious-plus")?.addEventListener("click", (ev) => {
          ev.preventDefault();
          const cur = parseInt(rankEl.textContent, 10) || 0;
          rankEl.textContent = String(cur + 1);
        });
        root.querySelector(".vicious-minus")?.addEventListener("click", (ev) => {
          ev.preventDefault();
          const cur = parseInt(rankEl.textContent, 10) || 0;
          rankEl.textContent = String(Math.max(0, cur - 1));
        });
      },
      rejectClose: false,
    });
  }
}
