/**
 * Automated Animations compatibility shim.
 *
 * AA's Star Wars FFG support (`src/system-support/aa-starwarsffg.js`) listens for this
 * system's `ffgDiceMessage` hook and hands the roll straight to its animation search:
 *
 *     Hooks.on("ffgDiceMessage", async (roll) => {
 *         let compiledData = await getRequiredData({ item: roll.data, workflow: roll });
 *         if (!compiledData.item) { return; }
 *         runStarwarsffg(compiledData);
 *     });
 *
 * It treats `roll.data` as the Item that was rolled. That works for a weapon/power roll,
 * where RollBuilderFFG passes the ItemFFG as the roll's data - but every roll made WITHOUT
 * a source item (a plain skill check, initiative, a Destiny/Force roll) reaches core's Roll
 * constructor with `data === undefined`, and core defaults it to `{}`. An empty object is
 * truthy, so AA's own `if (!compiledData.item) return` guard does not catch it and the
 * search runs with no name at all:
 *
 *     findAnimation.js  -> const itemName = item.name ?? item.label;           // undefined
 *                          prioritizedNames = [...overrideNames, itemName, ...extraNames]
 *                          const rinsedName = AAAutorecFunctions.rinseName(name);  // undefined
 *     aaAutorecFunctions.js -> rinsedName.includes(...)
 *     TypeError: Cannot read properties of undefined (reading 'includes')
 *
 * (`handleItem` computes a guarded `"noitem"` fallback for exactly this case but does not
 * use it in the `prioritizedNames` search - the upstream bug.)
 *
 * The throw is harmless in itself, but it aborts the workflow and spams an uncaught promise
 * rejection on every non-item roll, which buries real errors in the console.
 *
 * AA exposes `aa.getRequiredData` as a public hook fired just before it hands the compiled
 * data on, so we clear the pseudo-item there. With no name there is nothing for AA to match
 * anyway, so bailing out early loses no animation - it only replaces the exception with the
 * clean no-op AA already implements. Rolls that DO carry a real item are left untouched.
 *
 * Soft dependency: the hook simply never fires when AA is absent.
 */

import { RollFFG } from "../dice/roll.js";

export function registerAutoAnimationsShim() {
  Hooks.on("aa.getRequiredData", (data) => {
    try {
      // Only touch the payloads that came from our own ffgDiceMessage hook.
      if (!(data?.workflow instanceof RollFFG)) return;

      const item = data.item;
      if (!item) return;
      // A real rolled item (or anything else AA can search on) has a usable name.
      if (typeof item.name === "string" && item.name.length) return;
      if (typeof item.label === "string" && item.label.length) return;

      data.item = null;
    } catch (err) {
      CONFIG.logger?.debug?.("Automated Animations shim failed to inspect roll data", err);
    }
  });
}
