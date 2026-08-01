import { AE_MODES } from "../config/ffg-active-effect-modes.js";

function disablePushOnItem(options){
  // don't show push/animation if that's an effect from item
  if(options.parent.parentCollection === "items")
  {
    options.animate = false;
  }
}

/**
 * When an active effect that modifies a characteristic is added, changed (including enabled /
 * disabled), or removed, the actor's characteristics re-derive - and with them every owned weapon's
 * characteristic-based damage (Actor#_applyCharacteristicDamage). The weapon *documents* update in
 * place during the actor's data prep, but an already-open weapon sheet won't re-render on its own,
 * because the weapon document itself was never written to. Refresh any open weapon sheets so their
 * displayed damage badge stays in sync (covers cybernetics, species, talents, characteristic-rank
 * purchases, etc., which all adjust characteristics via active effects).
 *
 * @param {ActiveEffectFFG} effect
 */
function refreshWeaponSheetsForCharacteristicEffect(effect) {
  // Only characteristic-affecting effects change weapon damage; ignore everything else.
  const touchesCharacteristic = effect?.changes?.some(
    (c) => typeof c?.key === "string" && c.key.startsWith("system.characteristics")
  );
  if (!touchesCharacteristic) return;

  // Resolve the actor the effect ultimately applies to, whether it lives directly on the actor or
  // on an item embedded on it. Resolve synchronously so a later _onDelete still has the reference.
  const parent = effect.parent;
  const actor = parent instanceof Actor
    ? parent
    : (parent?.parent instanceof Actor ? parent.parent : null);
  if (!actor) return;

  // Defer one microtask so the actor's derived data (and thus weapon damage.adjusted) has finished
  // recomputing before we re-render; the sheets read the live prepared system at render time.
  Promise.resolve().then(() => {
    for (const item of actor.items) {
      if (!["weapon", "shipweapon"].includes(item.type)) continue;
      if (item.sheet?.rendered) item.sheet.render(false);
    }
  });
}

/**
 * Extend the basic ActiveEffect
 * @extends {ActiveEffect}
 */
export class ActiveEffectFFG extends ActiveEffect {
  /**
   * V14 replaced the ActiveEffect.duration model ({seconds, rounds, turns, combat, ...})
   * with {value, units, expiry, expired}, where `value` must be an integer when `units`
   * is set. Legacy/copied effects arrive with the invalid "units-without-value" shape
   * ({value: null, units: "seconds"}), which V14 tolerates in place but REJECTS on
   * create - so createEmbeddedDocuments throws whenever an effect-bearing item is
   * re-created (item drop, OggDude import, character build, purchase/transfer, ...).
   *
   * migrateData runs on every construction, before validation, for every path, so
   * stripping the malformed core duration here fixes them all centrally: Foundry then
   * applies a valid default. Real integer durations are untouched, and the system never
   * uses core duration for its own lifetimes (it tracks those in flags). Safe on V13.
   * @override
   */
  static migrateData(source) {
    if (source?.duration && !Number.isInteger(source.duration.value)) {
      // `delete` throws in strict mode when the property is non-configurable, which is the case
      // whenever the source object has been sealed or frozen -- effect data reached from a
      // compendium/template object during a bulk item create (the shop generator does this) comes
      // through that way. A sealed object is still writable, so overwrite in place instead; only a
      // fully frozen source has no route, and there we leave the value be rather than throw out of
      // migrateData (Foundry catches it, but every effect then logs a "Failed data migration").
      const descriptor = Object.getOwnPropertyDescriptor(source, "duration");
      if (descriptor?.configurable !== false) delete source.duration;
      else if (descriptor.writable !== false) source.duration = {};
    }
    return super.migrateData(source);
  }

  /**
   * Personal equipment (gear, weapons, armour) stored on a vehicle actor must not modify the
   * vehicle's stats. On characters this is gated by the equip toggle (the AE is disabled while
   * unequipped), but vehicles have no equip UI, so a leftover-enabled AE - e.g. a backpack that
   * was equipped on a character before being dragged into cargo - would otherwise apply its
   * modifiers (such as +4 encumbrance threshold) straight onto the ship. Suppress those effects
   * categorically instead of relying on equip state. Cargo weight is unaffected because the
   * vehicle's encumbrance value is recomputed from the item list in _calculateDerivedValues.
   * Vehicle-scale items (shipweapon, shipattachment, etc.) are intentionally left untouched.
   * @override
   */
  get isSuppressed() {
    const item = this.parent;     // the Item carrying the effect
    const actor = this.target;    // resolves to the parent actor (legacyTransferral = false)
    if (
      item instanceof Item &&
      actor?.type === "vehicle" &&
      ["gear", "weapon", "armour"].includes(item.type)
    ) {
      return true;
    }
    return super.isSuppressed;
  }

  /**
   * Read the stack count assigned to this effect by the "Status Icon Counters" module
   * (module id "statuscounter"). The counter is stored as a flag on the effect, so it can be read
   * synchronously during data preparation without the module needing to expose an API.
   *
   * Returns 1 when the module is absent, no counter is set, or the value is not a usable positive
   * integer, so behaviour is identical to a stack of one and unchanged when the module isn't used.
   *
   * The current module stores the value at flags.statuscounter.value; a legacy nesting
   * (flags.statuscounter.counter.value) is read as a fallback for older installs.
   *
   * @returns {number} integer >= 1
   */
  getStackCount() {
    // Document#getFlag validates the scope against installed+active packages and
    // THROWS for an absent module - on a module-free world that exploded every
    // actor data-prep with an ADD-mode change (surfaced as "Failed data
    // preparation" on item drop). Gate on the module being active (no module =
    // no stacking UI = stack of 1) and read the flag data directly off the
    // document, which needs no scope validation.
    if (!game.modules?.get?.("statuscounter")?.active) return 1;
    const raw = this.flags?.statuscounter?.value
      ?? this.flags?.statuscounter?.counter?.value;
    const count = Number(raw);
    return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
  }

  /**
   * Scale a single ADD-mode change's value by this effect's stack count so that N stacks of a
   * "+1" status (e.g. "Boost Next Check") contribute +N. Only additive numeric changes are scaled;
   * OVERRIDE / MULTIPLY / UPGRADE / DOWNGRADE and non-numeric values are returned untouched, since
   * multiplying those by a stack count has no well-defined meaning here.
   *
   * The original change object is never mutated - callers receive the resolved value to use.
   *
   * @param {object} change - an EffectChangeData entry from this.changes
   * @returns {string} the (possibly scaled) value, as a string for consistency with stored data
   */
  scaleChangeValue(change) {
    const count = this.getStackCount();
    if (count <= 1 || change?.mode !== AE_MODES.ADD) return change?.value;
    const numeric = Number(change.value);
    if (!Number.isFinite(numeric)) return change.value;
    return String(numeric * count);
  }

  /**
   * Multiply additive changes by the Status Icon Counters stack count at application time. Foundry
   * calls apply() once per change while deriving the actor's data, so scaling here makes the count
   * flow straight into the derived skill dice (system.skills.<skill>.boost, .setback, .upgrades,
   * .success, .light, .dark, ...) that the dice pool is built from - 2 stacks of "Boost Next Check"
   * become +2 boost on the next check, with no per-effect configuration required.
   *
   * The scaling is re-derived on every data preparation from the live counter flag, so it stays
   * correct as the count is raised, lowered, or removed, and the effect's stored changes keep their
   * base "+1" values. Leave the statuscounter module's own "multiply effect" option OFF for these
   * statuses, or the value would be scaled twice.
   *
   * @override
   */
  apply(actor, change, ...rest) {
    const scaled = this.scaleChangeValue(change);
    if (scaled !== change?.value) change = { ...change, value: scaled };
    return super.apply(actor, change, ...rest);
  }

  /** @override */
  async _onCreate(changed, options, userId) {
    disablePushOnItem(options);
    await super._onCreate(changed, options, userId);
    refreshWeaponSheetsForCharacteristicEffect(this);
  }

  /** @override */
  async _onUpdate(changed, options, userId) {
    disablePushOnItem(options);
    await super._onUpdate(changed, options, userId);
    refreshWeaponSheetsForCharacteristicEffect(this);
  }

  /** @override */
  async _onDelete(options, userId) {
    disablePushOnItem(options);
    await super._onDelete(options, userId);
    refreshWeaponSheetsForCharacteristicEffect(this);
  }
}
