/**
 * Apply Damage chat button — opens a dialog seeded from the weapon item and the
 * roll's successes, applies the resulting damage to the user's targeted token,
 * and posts a short public chat message. The full arithmetic is kept off the
 * chat log and only whispered to the GM on demand, via the "Damage Breakdown"
 * entry in the right-click context menu of the public card.
 */
import { applyToTargetActor } from "./gm-bridge.js";

import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

/**
 * Block / Deflect tiers. These replace the old Parry / Reflect ranks field: the
 * talents used at this table are flat reductions rather than "2 + ranks", and
 * each use costs the defender strain.
 * @type {{value: number, label: string, name: string}[]}
 */
const BLOCK_TIERS = [
  { value: 0, label: "SWFFG.ApplyDamage.BlockNone", name: "SWFFG.ApplyDamage.BlockNone" },
  { value: 4, label: "SWFFG.ApplyDamage.BlockBasic", name: "SWFFG.ApplyDamage.BlockBasicName" },
  { value: 5, label: "SWFFG.ApplyDamage.BlockImproved", name: "SWFFG.ApplyDamage.BlockImprovedName" },
  { value: 7, label: "SWFFG.ApplyDamage.BlockSupreme", name: "SWFFG.ApplyDamage.BlockSupremeName" },
];

/** Strain the defender pays per use of Block / Deflect. 3 is the printed cost;
 * unarmed Block is 2, and 1 is left available for further talent reductions. */
const STRAIN_PER_USE_OPTIONS = [3, 2, 1];

export class ApplyDamage {
  /** Message ids with an Apply Damage dialog currently open, so repeated
   * clicks on the chat button can't stack dialogs (and double-apply). */
  static _openDialogs = new Set();

  /**
   * Called from the renderChatMessage hook. Enforces visibility (GM only) and
   * binds the click handler.
   * @param {ChatMessage} message — the live ChatMessage instance.
   * @param {jQuery} html — the rendered chat-message element wrapped in jQuery.
   */
  static bindChatMessage(message, html) {
    const button = html.find(".ffg-apply-damage")[0];
    if (!button) return;

    // GM only. Unlike Apply Crit (which the attacking player may use on their own attack),
    // deciding how much damage actually lands - soak, defence, ranks of the relevant qualities -
    // is the GM's call, so the button is removed for everyone else including the roller.
    if (!game.user.isGM) {
      button.remove();
      return;
    }

    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ApplyDamage.show(message);
    });
  }

  /**
   * Add the on-demand "Damage Breakdown" entry to the chat-message context menu.
   * The applied-damage card carries the rendered breakdown in its flags; this
   * whispers it to the GMs only when asked, so the arithmetic no longer clutters
   * the log on every hit.
   *
   * Registered against both the V14 hook name and the V13 one; the guard keeps a
   * generation that fires both from inserting the entry twice. Likewise each
   * entry carries both the modern (`visible`/`onClick`) and legacy
   * (`condition`/`callback`) keys, since V14 prefers the former and V13 only
   * knows the latter.
   */
  static registerContextMenu() {
    const addEntry = (options) => {
      if (!Array.isArray(options)) return;
      if (options.some((o) => o?.__ffgDamageBreakdown)) return;

      // V14 hands the entry an HTMLElement, V13 a jQuery wrapper.
      const messageIdOf = (li) => (li?.[0] ?? li)?.dataset?.messageId;
      const breakdownOf = (li) => {
        const message = game.messages.get(messageIdOf(li));
        return message?.getFlag(game.system.id, "damageBreakdown") || null;
      };

      const visible = (li) => game.user.isGM && !!breakdownOf(li);
      const run = (li) => {
        const breakdown = breakdownOf(li);
        if (!breakdown) return;
        return ChatMessage.create({
          speaker: breakdown.speaker,
          whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
          content: breakdown.content,
        });
      };

      options.push({
        __ffgDamageBreakdown: true,
        name: game.i18n.localize("SWFFG.ApplyDamage.ShowBreakdown"),
        label: game.i18n.localize("SWFFG.ApplyDamage.ShowBreakdown"),
        icon: '<i class="fas fa-calculator"></i>',
        visible,
        condition: visible,
        onClick: (event, li) => run(li),
        callback: (li) => run(li),
      });
    };

    Hooks.on("getChatMessageContextOptions", (app, options) => addEntry(options));
    Hooks.on("getChatLogEntryContext", (html, options) => addEntry(options));
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

    let woundLabel, strainLabel, soakValue, soakWord, woundPath, strainPath, canChoosePool;
    if (type === "vehicle") {
      canChoosePool = true;
      woundLabel = game.i18n.localize("SWFFG.VehicleHullTrauma");
      strainLabel = game.i18n.localize("SWFFG.VehicleHullStrain");
      soakWord = "armour";
      soakValue = Number(a.system.stats?.armour?.value) || 0;
      woundPath = "system.stats.hullTrauma.value";
      strainPath = "system.stats.systemStrain.value";
    } else if (type === "minion" || type === "rival") {
      canChoosePool = false;
      woundLabel = game.i18n.localize("SWFFG.Wounds");
      strainLabel = null;
      soakWord = "soak";
      soakValue = Number(a.system.stats?.soak?.value) || 0;
      woundPath = "system.stats.wounds.value";
      strainPath = null;
    } else if (type === "character" || type === "nemesis") {
      canChoosePool = true;
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
    // Scale. A vehicle's Armour is not soak in the same units: against a personal-scale weapon
    // each point of Armour is worth 10 soak, while a ship-scale weapon trades with it 1:1 (a
    // 6-damage ship weapon against 2 Armour deals 4). Previously the raw Armour value was used as
    // soak for both, so personal weapons chewed through vehicles as if Armour 2 were soak 2.
    //
    // The two mitigating qualities are not interchangeable here either:
    //   Breach X - ignores X points of Armour (equivalently 10 soak per rank).
    //   Pierce X - ignores X soak, and does NOT reduce Armour at all.
    // So against a vehicle only Breach applies, and it is subtracted from Armour BEFORE the scale
    // multiplier. Against a personal-scale target the existing behaviour is correct: Breach is
    // worth 10 soak per rank and stacks with Pierce.
    const isVehicleTarget = type === "vehicle";
    const isShipScaleWeapon = itemData.type === "shipweapon";
    // House rule: a personal weapon can be flagged to deal vehicle-scale damage TO VEHICLES
    // (sheet options -> "Counts as a vehicle weapon", personal weapons only). Deliberately scoped
    // to vehicle targets: the flag is about punching through Armour, not about the weapon becoming
    // a starship cannon, so it must not pick up the x5 multiplier against people below.
    const countsAsVehicleWeapon =
      itemData.type === "weapon" && !!itemData.flags?.starwarsffg?.config?.countsAsVehicleWeapon;
    const vehicleScaleVsVehicle = isShipScaleWeapon || countsAsVehicleWeapon;
    const armourMultiplier = isVehicleTarget ? (vehicleScaleVsVehicle ? 1 : 10) : 1;
    // Crossing scales in either direction:
    //   ship weapon -> personal target: damage x5.
    //   personal weapon -> vehicle: 10 unsoaked damage per point of Hull Trauma / System Strain,
    //     so a hit that gets fewer than 10 past Armour does nothing at all.
    // Same-scale attacks leave both of these at 1.
    // Note the asymmetry: the scale-UP check uses isShipScaleWeapon (a genuine ship weapon), while
    // the vehicle-facing scale-DOWN uses vehicleScaleVsVehicle so the house-rule flag counts.
    const scaleDamageMultiplier = !isVehicleTarget && isShipScaleWeapon ? 5 : 1;
    const scaleDownDivisor = isVehicleTarget && !vehicleScaleVsVehicle ? 10 : 1;
    const autoPierce = isVehicleTarget ? breachRanks : pierceRanks + 10 * breachRanks;

    const damageLabel = game.i18n.localize("SWFFG.ApplyDamage.DamagePerHit");
    const hitsLabel = game.i18n.localize("SWFFG.ApplyDamage.Hits");
    const applyToLabel = game.i18n.localize("SWFFG.ApplyDamage.ApplyTo");
    // Against a vehicle the field spends Breach ranks against Armour, so label it accordingly
    // rather than calling it Pierce, which does not apply to Armour at all.
    const pierceLabel = isVehicleTarget
      ? game.i18n.localize("SWFFG.ApplyDamage.BreachRanks")
      : game.i18n.localize("SWFFG.Pierce");
    const blockLabel = game.i18n.localize("SWFFG.ApplyDamage.BlockDeflect");
    const blockUsesLabel = game.i18n.localize("SWFFG.ApplyDamage.BlockUses");
    const strainPerUseLabel = game.i18n.localize("SWFFG.ApplyDamage.StrainPerUse");
    const reductionLabel = game.i18n.localize("SWFFG.ApplyDamage.Reduction");
    const applyLabel = game.i18n.localize("SWFFG.ApplyDamage.Apply");
    const cancelLabel = game.i18n.localize("SWFFG.ApplyDamage.Cancel");
    // Which track the damage lands on. This is a plain <select> row in the same grid as every other
    // field rather than the pair of .form-group radios it used to be: the radios stopped showing up
    // once the form grew, and a row here cannot be laid out away by dialog form styling.
    const poolRow = canChoosePool
      ? `<label>${applyToLabel}:</label>
         <select name="pool" style="width:100%;">
           <option value="wounds" selected>${woundLabel}</option>
           <option value="strain">${strainLabel}</option>
         </select>`
      : `<label>${applyToLabel}:</label>
         <div><strong>${woundLabel}</strong></div>`;

    const blockOptions = BLOCK_TIERS.map((t) => `<option value="${t.value}">${game.i18n.localize(t.label)}</option>`).join("");
    const strainOptions = STRAIN_PER_USE_OPTIONS.map((n) => `<option value="${n}">${n}</option>`).join("");

    const content = `
      <div style="display:grid; grid-template-columns: 170px 1fr; gap:6px 10px; align-items:center;">
        ${poolRow}
        <label>${hitsLabel}:</label>
        <input type="number" name="hits" value="1" min="1" style="width:100%;"/>
        <label>${damageLabel}:</label>
        <input type="number" name="damage" value="${autoDamage}" min="0" style="width:100%;"/>
        <label>${pierceLabel}:</label>
        <input type="number" name="pierce" value="${autoPierce}" min="0" style="width:100%;"/>
        <label>${blockLabel}:</label>
        <select name="block" style="width:100%;">${blockOptions}</select>
        <label>${blockUsesLabel}:</label>
        <input type="number" name="blockUses" value="1" min="0" style="width:100%;"/>
        <label>${strainPerUseLabel}:</label>
        <select name="strainPerUse" style="width:100%;">${strainOptions}</select>
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
      position: { width: 420 },
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
            const num = (name, min, fallback) => Math.max(min, parseInt(root.querySelector(`[name="${name}"]`)?.value, 10) || fallback);
            const hits = num("hits", 1, 1);
            const damage = num("damage", 0, 0);
            const pierce = num("pierce", 0, 0);
            const reduction = num("reduction", 0, 0);
            const blockValue = num("block", 0, 0);
            // Block / Deflect is declared per incoming hit, so it can never be
            // spent more times than there are hits to spend it on.
            const blockUses = blockValue > 0 ? Math.min(num("blockUses", 0, 0), hits) : 0;
            const strainPerUse = num("strainPerUse", 1, 3);
            const blockStrain = blockUses * strainPerUse;
            const blockName = game.i18n.localize(BLOCK_TIERS.find((t) => t.value === blockValue)?.name ?? "SWFFG.ApplyDamage.BlockNone");

            const pool = (canChoosePool ? root.querySelector('select[name="pool"]')?.value : "wounds") || "wounds";
            const path = pool === "strain" ? strainPath : woundPath;
            const poolLabel = pool === "strain" ? strainLabel : woundLabel;
            if (!path) {
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.UnsupportedActor"));
              return;
            }

            // Crossing scales upward: a ship-scale weapon striking a personal-scale target hits far
            // harder than its printed damage. Scale first, so Block / Deflect and Damage Reduction
            // then come off the real incoming figure rather than the unscaled one.
            const scaledDamage = damage * scaleDamageMultiplier;
            // For a vehicle, `pierce` here holds Breach ranks and `soakValue` holds Armour points:
            // subtract Breach from Armour first, then convert to soak-equivalent via the scale
            // multiplier (x10 vs a personal weapon, x1 vs a ship weapon). For every other target
            // the multiplier is 1 and this is the original soak-minus-pierce calculation.
            const effectiveSoak = Math.max(0, soakValue - pierce) * armourMultiplier;

            // Every hit is resolved on its own: soak and Damage Reduction apply to each one, and
            // Block / Deflect only to the hits it was actually spent on. That is what makes
            // Autofire / Linked correct -- five hits of 8 against soak 5 is 15, not 40 - 5.
            const resolveHit = (mitigation) => {
              const afterMitigation = Math.max(0, scaledDamage - mitigation - reduction);
              const unsoaked = Math.max(0, afterMitigation - effectiveSoak);
              // Crossing scales downward: a personal-scale weapon must land 10 unsoaked damage on
              // a vehicle to register a single point. Anything short of that bounces off entirely,
              // so this floors rather than rounds.
              const applied = scaleDownDivisor > 1 ? Math.floor(unsoaked / scaleDownDivisor) : unsoaked;
              return { unsoaked, applied };
            };
            const blockedHit = resolveHit(blockValue);
            const plainHit = resolveHit(0);
            const plainHits = hits - blockUses;
            const applied = blockUses * blockedHit.applied + plainHits * plainHit.applied;

            const speaker = ChatMessage.getSpeaker({ token: target.document });

            // Strain paid for Block / Deflect lands on the defender's strain track regardless of
            // which track the damage itself went to. Minions and rivals have no strain track --
            // by the rules they suffer strain as wounds -- so their cost is routed to wounds
            // instead of being dropped. Where the cost and the damage share a path the bridge
            // merges them into a single update.
            const costPath = strainPath ?? woundPath;
            const costLabel = strainPath ? strainLabel : woundLabel;
            const deltas = [{ path, delta: applied }];
            if (blockStrain) deltas.push({ path: costPath, delta: blockStrain });

            // Detailed breakdown, stored on the public card rather than whispered up front. The
            // GM asks for it from the card's context menu (see registerContextMenu); most hits
            // never need it, and the log stays readable.
            const lines = [];
            lines.push(
              `<p>${game.i18n.format("SWFFG.ApplyDamage.GMDetails", {
                actorName: a.name,
                applied,
                poolLabel,
                weaponName,
                hits,
              })}</p>`
            );
            if (blockUses > 0) {
              lines.push(
                `<p>${game.i18n.format("SWFFG.ApplyDamage.BreakdownBlockedHit", {
                  count: blockUses,
                  blockName,
                  damage: scaledDamage,
                  block: blockValue,
                  reduction,
                  effectiveSoak,
                  soakWord,
                  perHit: blockedHit.applied,
                })}</p>`
              );
            }
            if (plainHits > 0) {
              lines.push(
                `<p>${game.i18n.format("SWFFG.ApplyDamage.BreakdownPlainHit", {
                  count: plainHits,
                  damage: scaledDamage,
                  reduction,
                  effectiveSoak,
                  soakWord,
                  perHit: plainHit.applied,
                })}</p>`
              );
            }
            lines.push(
              `<p>${game.i18n.format("SWFFG.ApplyDamage.BreakdownSoak", {
                pierce,
                soakWord,
                soak: soakValue,
                effectiveSoak,
              })}</p>`
            );
            if (blockUses > 0) {
              lines.push(
                `<p>${game.i18n.format(strainPath ? "SWFFG.ApplyDamage.BreakdownStrain" : "SWFFG.ApplyDamage.BreakdownStrainAsWounds", {
                  actorName: a.name,
                  blockName,
                  uses: blockUses,
                  perUse: strainPerUse,
                  total: blockStrain,
                  costLabel,
                })}</p>`
              );
            }
            // When scales are crossed the headline figures do not add up on their own -- the
            // breakdown would read as if the printed damage were what landed -- so state the
            // conversion explicitly. The per-hit lines above already quote the post-scale figure.
            if (scaleDamageMultiplier > 1) {
              lines.push(
                `<p>${game.i18n.format("SWFFG.ApplyDamage.ScaleUpNote", {
                  raw: damage,
                  scaled: scaledDamage,
                  multiplier: scaleDamageMultiplier,
                })}</p>`
              );
            } else if (scaleDownDivisor > 1) {
              lines.push(
                `<p>${game.i18n.format("SWFFG.ApplyDamage.ScaleDownNote", {
                  unsoaked: plainHits > 0 ? plainHit.unsoaked : blockedHit.unsoaked,
                  divisor: scaleDownDivisor,
                  applied: plainHits > 0 ? plainHit.applied : blockedHit.applied,
                  poolLabel,
                })}</p>`
              );
            }
            const breakdown = { speaker, content: lines.join("") };

            try {
              // Writes to the target actor; when the clicking player does not own
              // the target, this forwards to the active GM (see gm-bridge.js).
              const result = await applyToTargetActor(a, { type: "damage", path, delta: applied, deltas });
              if (!result) return;
            } catch (err) {
              CONFIG.logger?.warn?.("ApplyDamage: actor.update failed", err);
              ui.notifications.warn(game.i18n.localize("SWFFG.ApplyDamage.TargetGone"));
              return;
            }

            // Public line for everyone. Reports the wounds actually applied
            // (post soak/block/reduction) so it matches the target's bar; the
            // math itself rides along in a flag and is only revealed on request.
            let publicContent = `<p>${game.i18n.format(hits > 1 ? "SWFFG.ApplyDamage.PublicMessageHits" : "SWFFG.ApplyDamage.PublicMessage", {
              actorName: a.name,
              damage: applied,
              poolLabel,
              weaponName,
              hits,
            })}</p>`;
            if (blockStrain) {
              publicContent += `<p>${game.i18n.format("SWFFG.ApplyDamage.PublicStrain", {
                actorName: a.name,
                cost: blockStrain,
                costLabel,
                blockName,
                uses: blockUses,
              })}</p>`;
            }
            await ChatMessage.create({
              speaker,
              content: publicContent,
              flags: { [game.system.id]: { damageBreakdown: breakdown } },
            });
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
