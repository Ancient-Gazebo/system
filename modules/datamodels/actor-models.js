/**
 * AUTO-GENERATED faithful DataModels for the Star Wars FFG system.
 *
 * These mirror the historical template.json shapes field-for-field so that
 * registering them is non-lossy for existing data. Dynamic maps (attributes,
 * skills, currency, talent/upgrade trees) use ObjectField; free-form arrays use
 * a permissive AnyField element. Do NOT hand-edit; regenerate from template.json.
 */

/**
 * A permissive DataField that passes any value through untouched.
 * Used for free-form array elements and unknown leaves so nothing is dropped.
 */
export class AnyField extends foundry.data.fields.DataField {
  _cast(value) { return value; }
  _cleanType(value, options) { return value; }
  _validateType(value, options) { return true; }
  initialize(value, model, options = {}) { return value; }
  toObject(value) { return value; }
}

/**
 * A NumberField that tolerates non-finite input. Importers and legacy data can
 * yield NaN/Infinity (e.g. parseInt of a missing field); stock NumberField rejects
 * those with a validation error and aborts document creation. This coerces any
 * non-finite cast result to the field's initial (if finite) or null, so bad numeric
 * input degrades gracefully instead of throwing.
 */
export class SafeNumberField extends foundry.data.fields.NumberField {
  _cast(value) {
    const n = super._cast(value);
    if (Number.isFinite(n)) return n;
    const init = this.options?.initial;
    return Number.isFinite(init) ? init : null;
  }
}

/**
 * Shared base for all FFG system models. Provides a defensive migrateData hook:
 * faithful-mirror schemas need little migration, but free-form maps (ObjectField)
 * must not be null / array / primitive or schema cleaning can throw on legacy data.
 * Any top-level ObjectField-backed value that isn't a plain object is coerced to {}.
 * Extend this hook for future per-version data transforms.
 */
export class FFGTypeModel extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    try {
      const fields = this.schema?.fields ?? {};
      for (const [key, field] of Object.entries(fields)) {
        if (field instanceof foundry.data.fields.ObjectField) {
          const v = source?.[key];
          if (v === null || Array.isArray(v) || (v !== undefined && typeof v !== "object")) {
            source[key] = {};
          }
        }
      }
    } catch (e) { /* never block document construction */ }
    return super.migrateData(source);
  }
}

export class CharacterActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      species: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
      }),
      career: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
      }),
      specialisation: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        list: new fields.ArrayField(new AnyField()),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
      }),
      stats: new fields.SchemaField({
        wounds: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        medical: new fields.SchemaField({
          // Stimpack & emergency-repair-patch healing counters, read/written by the
          // healing-item boxes (ffg-healingitem.html) and the inventory "use" handler.
          // Previously absent from the schema, so the strict SchemaField pruned
          // system.stats.medical on every save (stimpack escalation reset to 5 each use).
          // `uses` = stimpacks (heal decays 5/4/3/2/1); `patchUses` = repair patches
          // (flat 3, no decay). Tracked independently so neither affects the other's count.
          uses: new SafeNumberField({ initial: 0, nullable: true }),
          patchUses: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        strain: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        soak: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        defence: new fields.SchemaField({
          ranged: new SafeNumberField({ initial: 0, nullable: true }),
          melee: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        encumbrance: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        forcePool: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        credits: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Credits", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
      }),
      characteristics: new fields.SchemaField({
        Brawn: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Brawn", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Br", blank: true, nullable: true }),
        }),
        Agility: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Agility", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Ag", blank: true, nullable: true }),
        }),
        Intellect: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Intellect", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Int", blank: true, nullable: true }),
        }),
        Cunning: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Cunning", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Cun", blank: true, nullable: true }),
        }),
        Willpower: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Willpower", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Will", blank: true, nullable: true }),
        }),
        Presence: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Presence", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Pr", blank: true, nullable: true }),
        }),
      }),
      skills: new fields.ObjectField(),
      attributes: new fields.ObjectField(),
      general: new fields.SchemaField({
        features: new fields.StringField({ initial: "<p></p>", blank: true, nullable: true }),
      }),
      currency: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      obligation: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Obligation", blank: true, nullable: true }),
      }),
      duty: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Duty", blank: true, nullable: true }),
      }),
      morality: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Morality", blank: true, nullable: true }),
      }),
      conflict: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Conflict", blank: true, nullable: true }),
      }),
      forcePresence: new fields.SchemaField({
        dark: new SafeNumberField({ initial: 0, nullable: true }),
        light: new SafeNumberField({ initial: 0, nullable: true }),
        max: new SafeNumberField({ initial: 10, nullable: true }),
      }),
      experience: new fields.SchemaField({
        total: new SafeNumberField({ initial: 0, nullable: true }),
        available: new SafeNumberField({ initial: 0, nullable: true }),
      }),
    };
  }
}

export class MinionActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      stats: new fields.SchemaField({
        wounds: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        strain: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        soak: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        defence: new fields.SchemaField({
          ranged: new SafeNumberField({ initial: 0, nullable: true }),
          melee: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        encumbrance: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        forcePool: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        credits: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Credits", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
      }),
      characteristics: new fields.SchemaField({
        Brawn: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Brawn", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Br", blank: true, nullable: true }),
        }),
        Agility: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Agility", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Ag", blank: true, nullable: true }),
        }),
        Intellect: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Intellect", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Int", blank: true, nullable: true }),
        }),
        Cunning: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Cunning", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Cun", blank: true, nullable: true }),
        }),
        Willpower: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Willpower", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Will", blank: true, nullable: true }),
        }),
        Presence: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Presence", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Pr", blank: true, nullable: true }),
        }),
      }),
      skills: new fields.ObjectField(),
      attributes: new fields.ObjectField(),
      currency: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        max: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      unit_wounds: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Unit Wounds", blank: true, nullable: true }),
      }),
    };
  }
}

export class VehicleActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      stats: new fields.SchemaField({
        silhouette: new fields.SchemaField({
          value: new SafeNumberField({ initial: 1, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Silhouette", blank: true, nullable: true }),
        }),
        speed: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Speed", blank: true, nullable: true }),
        }),
        handling: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Handling", blank: true, nullable: true }),
        }),
        hullTrauma: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 10, nullable: true }),
          label: new fields.StringField({ initial: "Hull Trauma", blank: true, nullable: true }),
        }),
        systemStrain: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 10, nullable: true }),
          label: new fields.StringField({ initial: "System Strain", blank: true, nullable: true }),
        }),
        shields: new fields.SchemaField({
          fore: new SafeNumberField({ initial: 0, nullable: true }),
          port: new SafeNumberField({ initial: 0, nullable: true }),
          starboard: new SafeNumberField({ initial: 0, nullable: true }),
          aft: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Shields", blank: true, nullable: true }),
        }),
        armour: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Armour", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        sensorRange: new fields.SchemaField({
          value: new fields.StringField({ initial: "Short", blank: true, nullable: true }),
          type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        }),
        crew: new fields.ObjectField(),
        passengerCapacity: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Passenger Capacity", blank: true, nullable: true }),
        }),
        encumbrance: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 10, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        cost: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Cost", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        rarity: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          isrestricted: new fields.BooleanField({ initial: false }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        customizationHardPoints: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        hyperdrive: new fields.SchemaField({
          value: new SafeNumberField({ initial: 1, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "SWFFG.Hyperdrive", blank: true, nullable: true }),
        }),
        consumables: new fields.SchemaField({
          value: new SafeNumberField({ initial: 1, nullable: true }),
          duration: new fields.StringField({ initial: "months", blank: true, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "SWFFG.Consumables", blank: true, nullable: true }),
        }),
        navicomputer: new fields.SchemaField({
          value: new fields.BooleanField({ initial: false }),
          type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "SWFFG.VehicleNavicomputer", blank: true, nullable: true }),
        }),
      }),
      spaceShip: new fields.BooleanField({ initial: false }),
      silhouetteImage: new fields.StringField({ initial: "systems/starwarsffg/images/shipdefence.png", blank: true, nullable: true }),
    };
  }
}

export class HomesteadActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      cost: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Cost", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      consumables: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        duration: new fields.StringField({ initial: "months", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "SWFFG.Consumables", blank: true, nullable: true }),
      }),
    };
  }
}

export class RivalActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      species: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
      }),
      characteristics: new fields.SchemaField({
        Brawn: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Brawn", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Br", blank: true, nullable: true }),
        }),
        Agility: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Agility", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Ag", blank: true, nullable: true }),
        }),
        Intellect: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Intellect", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Int", blank: true, nullable: true }),
        }),
        Cunning: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Cunning", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Cun", blank: true, nullable: true }),
        }),
        Willpower: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Willpower", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Will", blank: true, nullable: true }),
        }),
        Presence: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Presence", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Pr", blank: true, nullable: true }),
        }),
      }),
      skills: new fields.ObjectField(),
      attributes: new fields.ObjectField(),
      general: new fields.SchemaField({
        features: new fields.StringField({ initial: "<p></p>", blank: true, nullable: true }),
      }),
      currency: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      stats: new fields.SchemaField({
        wounds: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        medical: new fields.SchemaField({
          // Stimpack & emergency-repair-patch healing counters, read/written by the
          // healing-item boxes (ffg-healingitem.html) and the inventory "use" handler.
          // Previously absent from the schema, so the strict SchemaField pruned
          // system.stats.medical on every save (stimpack escalation reset to 5 each use).
          // `uses` = stimpacks (heal decays 5/4/3/2/1); `patchUses` = repair patches
          // (flat 3, no decay). Tracked independently so neither affects the other's count.
          uses: new SafeNumberField({ initial: 0, nullable: true }),
          patchUses: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        soak: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        defence: new fields.SchemaField({
          ranged: new SafeNumberField({ initial: 0, nullable: true }),
          melee: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        encumbrance: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        forcePool: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        credits: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Credits", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
      }),
      forcePresence: new fields.SchemaField({
        dark: new SafeNumberField({ initial: 0, nullable: true }),
        light: new SafeNumberField({ initial: 0, nullable: true }),
        max: new SafeNumberField({ initial: 10, nullable: true }),
      }),
      morality: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Morality", blank: true, nullable: true }),
      }),
      conflict: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Conflict", blank: true, nullable: true }),
      }),
    };
  }
}

export class NemesisActorModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      biography: new fields.StringField({ initial: "", blank: true, nullable: true }),
      species: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
      }),
      stats: new fields.SchemaField({
        wounds: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        medical: new fields.SchemaField({
          // Stimpack & emergency-repair-patch healing counters, read/written by the
          // healing-item boxes (ffg-healingitem.html) and the inventory "use" handler.
          // Previously absent from the schema, so the strict SchemaField pruned
          // system.stats.medical on every save (stimpack escalation reset to 5 each use).
          // `uses` = stimpacks (heal decays 5/4/3/2/1); `patchUses` = repair patches
          // (flat 3, no decay). Tracked independently so neither affects the other's count.
          uses: new SafeNumberField({ initial: 0, nullable: true }),
          patchUses: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        strain: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          min: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        soak: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        defence: new fields.SchemaField({
          ranged: new SafeNumberField({ initial: 0, nullable: true }),
          melee: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        encumbrance: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        forcePool: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          max: new SafeNumberField({ initial: 0, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
        credits: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
          label: new fields.StringField({ initial: "Credits", blank: true, nullable: true }),
          adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        }),
      }),
      characteristics: new fields.SchemaField({
        Brawn: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Brawn", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Br", blank: true, nullable: true }),
        }),
        Agility: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Agility", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Ag", blank: true, nullable: true }),
        }),
        Intellect: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Intellect", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Int", blank: true, nullable: true }),
        }),
        Cunning: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Cunning", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Cun", blank: true, nullable: true }),
        }),
        Willpower: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Willpower", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Will", blank: true, nullable: true }),
        }),
        Presence: new fields.SchemaField({
          value: new SafeNumberField({ initial: 0, nullable: true }),
          label: new fields.StringField({ initial: "Presence", blank: true, nullable: true }),
          abrev: new fields.StringField({ initial: "Pr", blank: true, nullable: true }),
        }),
      }),
      skills: new fields.ObjectField(),
      attributes: new fields.ObjectField(),
      general: new fields.SchemaField({
        features: new fields.StringField({ initial: "<p></p>", blank: true, nullable: true }),
      }),
      currency: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      forcePresence: new fields.SchemaField({
        dark: new SafeNumberField({ initial: 0, nullable: true }),
        light: new SafeNumberField({ initial: 0, nullable: true }),
        max: new SafeNumberField({ initial: 10, nullable: true }),
      }),
      morality: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Morality", blank: true, nullable: true }),
      }),
      conflict: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Conflict", blank: true, nullable: true }),
      }),
    };
  }
}
