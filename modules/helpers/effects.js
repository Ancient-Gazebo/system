import { AE_MODES } from "../config/ffg-active-effect-modes.js";
export default class EffectHelpers {

  // Lookup mode name from int
  static MODES = Object.fromEntries(
    Object.entries(AE_MODES).map(
      ([key, value]) => [value, key])
    );

  // Map effects from EmbeddedCollection
  static transformEffects(originalEffect, _iterator, _effects) {
    // originalEffect is a live ActiveEffect Document. structuredClone() of a live
    // Document no longer copies the `changes` schema field on V14 (it came back
    // undefined and the forEach below threw, aborting sheet render). toObject()
    // gives a plain, mutable copy of the source data - but on V14 even that copy
    // can come back without `changes`, so read them off the live document and
    // deep-clone so the mode/key rewrites below don't mutate the document.
    let effect = originalEffect.toObject();

    // Copy properties we need from the live document
    effect.id = originalEffect.id;
    effect.parentName = originalEffect.parent.name;
    effect.active = originalEffect.active;
    effect.changes = foundry.utils.deepClone(originalEffect.changes ?? []);

    // Convert duration to a display string.
    // V14 rewrote the core duration model from {seconds, rounds, turns, combat, ...}
    // to {value, units, ...}, and the legacy fields survive only as deprecated getters
    // that warn on every read (removed in V16). Handle the V14 {value, units} shape
    // first, then fall back to the legacy V13 fields (guarded by !isV14 so the
    // deprecated getters are never read on V14).
    const d = effect.duration ?? {};
    const isV14 = game.release.generation >= 14;
    // The system tracks its own dice-status lifetimes in flags, NOT in the core
    // ActiveEffect.duration: "once" = consumed on the next check, "combat" = cleared
    // when combat ends. Those statuses leave the core duration unset (permanent), so
    // show the flag lifetime first - otherwise e.g. "Boost Next Check" reads
    // "Permanent". Read it off the live document (toObject can drop it on V14).
    const ffgDuration = originalEffect.flags?.starwarsffg?.duration ?? effect.flags?.starwarsffg?.duration;
    if (ffgDuration === "once") {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.NextCheck");
    } else if (ffgDuration === "combat") {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.CurrentCombat");
    } else if (Number.isInteger(d.value) && d.units) {
      const unitKey = { seconds: "Seconds", rounds: "Rounds", turns: "Turns" }[d.units];
      const unitLabel = unitKey ? game.i18n.localize(`SWFFG.Effect.Duration.${unitKey}`) : d.units;
      effect.duration = `${d.value} ${unitLabel}`;
    } else if (!isV14 && d.combat) {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.CurrentCombat");
    } else if (!isV14 && d.seconds) {
      effect.duration = `${d.seconds} ${game.i18n.localize("SWFFG.Effect.Duration.Seconds")}`;
    } else if (!isV14 && d.rounds) {
      effect.duration = `${d.rounds} ${game.i18n.localize("SWFFG.Effect.Duration.Rounds")}`;
    } else if (!isV14 && d.turns) {
      effect.duration = `${d.turns} ${game.i18n.localize("SWFFG.Effect.Duration.Turns")}`;
    } else {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.Permanent");
    }

    // Update each change from this effect
    effect.changes.forEach((change, index) => {
      // Convert mode to a display string. On V14 a change carries the string
      // `type` instead of the numeric `mode`; prefer it so the Effects tab never
      // touches the deprecated numeric accessor (removed in V16).
      change.mode = change.type ?? EffectHelpers.MODES[change.mode];

      // LStrip 'system.' for shorter keys
      if (change.key.startsWith("system.")) {
        change.key = change.key.substring(7);
      }
    });

    return effect;
  }
}