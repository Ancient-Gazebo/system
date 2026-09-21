/**
 * Bulk token disposition changes.
 *
 * The FFG combat tracker builds its initiative slots per disposition (Friendly / Neutral / Enemy /
 * Secret), so a table that parks every NPC on Neutral until the shooting starts ends up with a
 * tracker full of Neutral slots the moment combat begins. Core only exposes disposition one token
 * at a time through the token config sheet, which makes "these twelve are hostile now" a twelve
 * dialog job.
 *
 * This adds a GM-only button to the Token scene controls that retargets a whole group at once, and
 * exposes the same prompt as `game.ffg.promptDispositionChange()` so it can be dropped on the
 * hotbar.
 */

import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

/**
 * The dispositions offered by the tool, in the order the combat tracker groups them.
 * Built lazily: the labels need `game.i18n`, which does not exist at import time.
 * @returns {Array<{value: number, label: string}>}
 */
function dispositionChoices() {
  return [
    { value: CONST.TOKEN_DISPOSITIONS.FRIENDLY, label: game.i18n.localize("SWFFG.Tokens.Disposition.Dispositions.Friendly") },
    { value: CONST.TOKEN_DISPOSITIONS.NEUTRAL, label: game.i18n.localize("SWFFG.Tokens.Disposition.Dispositions.Neutral") },
    { value: CONST.TOKEN_DISPOSITIONS.HOSTILE, label: game.i18n.localize("SWFFG.Tokens.Disposition.Dispositions.Hostile") },
    { value: CONST.TOKEN_DISPOSITIONS.SECRET, label: game.i18n.localize("SWFFG.Tokens.Disposition.Dispositions.Secret") },
  ];
}

/**
 * Collect the tokens a scope refers to.
 *
 * @param {string} scope - one of "selected", "targeted", "scene", "actors"
 * @returns {Token[]} the matching placeables on the current scene
 */
function resolveScope(scope) {
  const placeables = canvas.tokens?.placeables ?? [];
  const controlled = canvas.tokens?.controlled ?? [];
  switch (scope) {
    case "targeted":
      return Array.from(game.user.targets ?? []);
    case "scene":
      return placeables;
    case "actors": {
      // Every token on the scene driven by the same actor as something currently selected - the
      // "select one stormtrooper, flip all of them" case. Unlinked tokens still carry the actorId
      // they were dropped from, so minion copies group correctly.
      const actorIds = new Set(controlled.map((t) => t.document.actorId).filter(Boolean));
      if (!actorIds.size) return [];
      return placeables.filter((t) => actorIds.has(t.document.actorId));
    }
    default:
      return controlled;
  }
}

/**
 * Apply a disposition to a set of tokens.
 *
 * Tokens already on the requested disposition are skipped so the update is a no-op rather than a
 * pointless document write (which would churn the combat tracker and every token refresh hook).
 *
 * @param {object} options
 * @param {Array<Token|TokenDocument>} options.tokens - placeables or documents, mixed is fine
 * @param {number} options.disposition - a CONST.TOKEN_DISPOSITIONS value
 * @param {boolean} [options.updatePrototype] - also set the source actors' prototype tokens
 * @returns {Promise<{tokens: number, actors: number}>} counts of what was actually changed
 */
export async function setTokenDisposition({ tokens, disposition, updatePrototype = false }) {
  const docs = (tokens ?? []).map((t) => t.document ?? t).filter(Boolean);
  const updates = docs
    .filter((doc) => doc.disposition !== disposition)
    .map((doc) => ({ _id: doc.id, disposition }));
  if (updates.length) {
    await canvas.scene.updateEmbeddedDocuments("Token", updates);
  }

  let actorCount = 0;
  if (updatePrototype) {
    // Prototype tokens live on the base actor, so an unlinked token's synthetic actor is no use
    // here - go back to the world actor via actorId.
    const actorUpdates = [];
    for (const actorId of new Set(docs.map((doc) => doc.actorId).filter(Boolean))) {
      const actor = game.actors.get(actorId);
      if (!actor || actor.prototypeToken.disposition === disposition) continue;
      actorUpdates.push({ _id: actorId, "prototypeToken.disposition": disposition });
    }
    if (actorUpdates.length) {
      await CONFIG.Actor.documentClass.updateDocuments(actorUpdates);
    }
    actorCount = actorUpdates.length;
  }

  // Slots are grouped by disposition, so anything already in the tracker has just moved sides.
  if (updates.length && game.combat) {
    ui.combat?.render(true);
  }

  return { tokens: updates.length, actors: actorCount };
}

/**
 * Open the bulk disposition dialog.
 * @returns {Promise<void>}
 */
export async function promptDispositionChange() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("SWFFG.Tokens.Disposition.GMOnly"));
    return;
  }
  if (!canvas?.scene) {
    ui.notifications.warn(game.i18n.localize("SWFFG.Tokens.Disposition.NoScene"));
    return;
  }

  const choices = dispositionChoices();
  const dispositionOptions = choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join("");
  const counts = {
    selected: canvas.tokens?.controlled?.length ?? 0,
    targeted: game.user.targets?.size ?? 0,
    scene: canvas.tokens?.placeables?.length ?? 0,
  };
  // Default to whatever the GM has actually got in hand: a selection if there is one, otherwise
  // targets, otherwise the whole scene.
  const defaultScope = counts.selected ? "selected" : (counts.targeted ? "targeted" : "scene");
  const scopes = [
    { value: "selected", label: game.i18n.localize("SWFFG.Tokens.Disposition.Scope.Selected") },
    { value: "targeted", label: game.i18n.localize("SWFFG.Tokens.Disposition.Scope.Targeted") },
    { value: "scene", label: game.i18n.localize("SWFFG.Tokens.Disposition.Scope.Scene") },
    { value: "actors", label: game.i18n.localize("SWFFG.Tokens.Disposition.Scope.Actors") },
  ];

  // The standard form-group label column is a flex ratio, so at any sensible dialog width the
  // longest label here wraps onto a second line and the rows stop lining up. It has to be an
  // inline style: DialogV2 puts `content` through `foundry.utils.cleanHTML`, whose allow-list
  // drops a <style> element outright (the style ATTRIBUTE survives, as do <select>/<option>).
  // Only the rows with a select get it - the checkbox row has nothing to leave room for, so its
  // longer label wants the full width.
  const labelStyle = ' style="flex: 0 0 180px"';
  // The wrapper is a plain div, not a form: DialogV2 already wraps `content` in its own <form>,
  // and the HTML parser silently discards a nested one, taking the styling hook with it.
  const content = `
    <div class="ffg-disposition-tool">
      <p class="notes">${game.i18n.format("SWFFG.Tokens.Disposition.Counts", counts)}</p>
      <div class="form-group">
        <label for="ffg-disposition-scope"${labelStyle}>${game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Scope")}</label>
        <select id="ffg-disposition-scope" name="scope">
          ${scopes.map((s) => `<option value="${s.value}"${s.value === defaultScope ? " selected" : ""}>${s.label}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label for="ffg-disposition-filter"${labelStyle}>${game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Filter")}</label>
        <select id="ffg-disposition-filter" name="filter">
          <option value="any" selected>${game.i18n.localize("SWFFG.Tokens.Disposition.Filter.Any")}</option>
          ${dispositionOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="ffg-disposition-target"${labelStyle}>${game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Target")}</label>
        <select id="ffg-disposition-target" name="disposition">${dispositionOptions}</select>
      </div>
      <div class="form-group">
        <label for="ffg-disposition-prototype">${game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Prototype")}</label>
        <input type="checkbox" id="ffg-disposition-prototype" name="prototype">
      </div>
    </div>
  `;

  await DialogV2.wait({
    window: { title: game.i18n.localize("SWFFG.Tokens.Disposition.Dialog.Title") },
    // DialogV2 defaults to a narrow window, which wraps these labels onto three lines apiece.
    position: { width: 460 },
    content: content,
    buttons: [
      {
        action: "apply",
        icon: "fas fa-check",
        label: game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Apply"),
        default: true,
        callback: async (event, button, dialog) => {
          const form = dialog.element;
          const scope = form.querySelector("[name=scope]").value;
          const filter = form.querySelector("[name=filter]").value;
          const disposition = parseInt(form.querySelector("[name=disposition]").value, 10);
          const updatePrototype = form.querySelector("[name=prototype]").checked;

          let tokens = resolveScope(scope);
          if (filter !== "any") {
            const current = parseInt(filter, 10);
            tokens = tokens.filter((t) => t.document.disposition === current);
          }
          if (!tokens.length) {
            ui.notifications.warn(game.i18n.localize("SWFFG.Tokens.Disposition.NoMatch"));
            return;
          }

          const label = choices.find((c) => c.value === disposition)?.label ?? String(disposition);
          const result = await setTokenDisposition({ tokens, disposition, updatePrototype });
          if (!result.tokens && !result.actors) {
            ui.notifications.info(game.i18n.format("SWFFG.Tokens.Disposition.AlreadySet", { disposition: label }));
          } else if (result.actors) {
            ui.notifications.info(game.i18n.format("SWFFG.Tokens.Disposition.AppliedWithActors", { count: result.tokens, actors: result.actors, disposition: label }));
          } else {
            ui.notifications.info(game.i18n.format("SWFFG.Tokens.Disposition.Applied", { count: result.tokens, disposition: label }));
          }
        },
      },
      {
        action: "cancel",
        icon: "fas fa-times",
        label: game.i18n.localize("SWFFG.Tokens.Disposition.Labels.Cancel"),
      },
    ],
    rejectClose: false,
  });
}

/**
 * Add the "Set Disposition" button to the Token scene controls.
 *
 * Must be called during `init` / `setup`: SceneControls builds its control record exactly once, on
 * first render, and that happens before the `ready` hook - a hook registered any later never sees
 * the call and the button silently never appears.
 */
export function registerDispositionControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    // V13+ hands over a record keyed by control name; tolerate the legacy array shape as well.
    const tokenControl = Array.isArray(controls) ? controls.find((c) => c.name === "tokens") : controls?.tokens;
    if (!tokenControl) return;
    const tool = {
      name: "ffgSetDisposition",
      order: 100,
      title: "SWFFG.Tokens.Disposition.Tool.Title",
      icon: "fa-solid fa-people-arrows",
      // A button resolves on click instead of becoming the active tool, so the GM keeps whatever
      // tool they were using once the dialog closes.
      button: true,
      onChange: (event, active) => {
        if (active) promptDispositionChange();
      },
    };
    if (Array.isArray(tokenControl.tools)) tokenControl.tools.push(tool);
    else {
      tokenControl.tools ??= {};
      tokenControl.tools[tool.name] = tool;
    }
  });
}
