
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
    const raw = this.getFlag("statuscounter", "value")
      ?? this.getFlag("statuscounter", "counter")?.value;
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
    if (count <= 1 || change?.mode !== CONST.ACTIVE_EFFECT_MODES.ADD) return change?.value;
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
