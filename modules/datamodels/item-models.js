/**
 * AUTO-GENERATED faithful DataModels (Items). See actor-models.js.
 */
import { AnyField, FFGTypeModel, SafeNumberField } from "./actor-models.js";

export class AbilityItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
    };
  }
}

export class ArmourItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      hardpoints: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "HP", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      equippable: new fields.SchemaField({
        value: new fields.BooleanField({ initial: true }),
        type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
        equipped: new fields.BooleanField({ initial: false }),
      }),
      itemattachment: new fields.ArrayField(new AnyField()),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      defence: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Defence", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Def", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      soak: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Soak", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
    };
  }
}

export class CareerItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      specializations: new fields.ObjectField(),
      signatureabilities: new fields.ObjectField(),
      careerSkills: new fields.SchemaField({
        careerSkill0: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill1: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill2: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill3: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill4: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill5: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill6: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill7: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
      }),
    };
  }
}

export class CriticaldamageItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      min: new SafeNumberField({ initial: 0, nullable: true }),
      max: new SafeNumberField({ initial: 0, nullable: true }),
      severity: new SafeNumberField({ initial: 1, nullable: true }),
    };
  }
}

export class CriticalinjuryItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      min: new SafeNumberField({ initial: 0, nullable: true }),
      max: new SafeNumberField({ initial: 0, nullable: true }),
      severity: new SafeNumberField({ initial: 1, nullable: true }),
    };
  }
}

export class ForcepowerItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      upgrades: new fields.ObjectField(),
      required_force_rating: new SafeNumberField({ initial: 0, nullable: true }),
      base_cost: new SafeNumberField({ initial: 0, nullable: true }),
    };
  }
}

export class GearItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      equippable: new fields.SchemaField({
        value: new fields.BooleanField({ initial: true }),
        type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
        equipped: new fields.BooleanField({ initial: false }),
      }),
      itemattachment: new fields.ArrayField(new AnyField()),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
    };
  }
}

export class ItemattachmentItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      hardpoints: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "HP", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      itemattachment: new fields.ArrayField(new AnyField()),
      type: new fields.StringField({ initial: "all", blank: true, nullable: true }),
    };
  }
}

export class ItemmodifierItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      type: new fields.StringField({ initial: "all", blank: true, nullable: true }),
      rank: new SafeNumberField({ initial: 0, nullable: true }),
      showInQualities: new fields.BooleanField({ initial: true }),
    };
  }
}

export class TalentItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      activation: new fields.SchemaField({
        value: new fields.StringField({ initial: "Passive", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Activation", blank: true, nullable: true }),
      }),
      ranks: new fields.SchemaField({
        ranked: new fields.BooleanField({ initial: false }),
        current: new SafeNumberField({ initial: 1, nullable: true }),
        min: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      isForceTalent: new fields.BooleanField({ initial: false }),
      isConflictTalent: new fields.BooleanField({ initial: false }),
      tier: new SafeNumberField({ initial: 1, nullable: true }),
      trees: new fields.ArrayField(new AnyField()),
      longDesc: new fields.StringField({ initial: "", blank: true, nullable: true }),
    };
  }
}

export class ShipattachmentItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      hardpoints: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "HP", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      equippable: new fields.SchemaField({
        value: new fields.BooleanField({ initial: true }),
        type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
        equipped: new fields.BooleanField({ initial: false }),
      }),
      itemattachment: new fields.ArrayField(new AnyField()),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      label: new fields.StringField({ initial: "Ship Attachment", blank: true, nullable: true }),
    };
  }
}

export class ShipweaponItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      hardpoints: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "HP", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      equippable: new fields.SchemaField({
        value: new fields.BooleanField({ initial: true }),
        type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
        equipped: new fields.BooleanField({ initial: false }),
      }),
      itemattachment: new fields.ArrayField(new AnyField()),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      label: new fields.StringField({ initial: "Ship Weapon", blank: true, nullable: true }),
      firingarc: new fields.SchemaField({
        fore: new fields.BooleanField({ initial: false }),
        aft: new fields.BooleanField({ initial: false }),
        port: new fields.BooleanField({ initial: false }),
        starboard: new fields.BooleanField({ initial: false }),
        dorsal: new fields.BooleanField({ initial: false }),
        ventral: new fields.BooleanField({ initial: false }),
      }),
      damage: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Damage", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Dam", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      crit: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Critical Rating", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Crit", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      range: new fields.SchemaField({
        value: new fields.StringField({ initial: "Short", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Range", blank: true, nullable: true }),
        adjusted: new fields.StringField({ initial: "Short", blank: true, nullable: true }),
      }),
      special: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Special", blank: true, nullable: true }),
      }),
      skill: new fields.SchemaField({
        value: new fields.StringField({ initial: "Gunnery", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Skill", blank: true, nullable: true }),
        useBrawn: new fields.BooleanField({ initial: false }),
      }),
    };
  }
}

export class HomesteadupgradeItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      // The homesteadupgrade sheet renders a description editor (system.description), a
      // modifiers tab (system.attributes), and a Price + Restricted header (system.price /
      // system.rarity). None of those were declared here, so the strict SchemaField pruned
      // them on every save: nothing the sheet wrote persisted, the description editor had no
      // value to enrich, and the item appeared completely non-functional. Restored below.
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Drives the "Restricted" toggle in the sheet header.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
    };
  }
}

export class SignatureabilityItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      upgrades: new fields.ObjectField(),
      base_cost: new SafeNumberField({ initial: 0, nullable: true }),
      uplink_nodes: new fields.SchemaField({
        uplink0: new fields.BooleanField({ initial: false }),
        uplink1: new fields.BooleanField({ initial: false }),
        uplink2: new fields.BooleanField({ initial: false }),
        uplink3: new fields.BooleanField({ initial: false }),
      }),
    };
  }
}

export class SpecializationItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      talents: new fields.ObjectField(),
      careerSkills: new fields.SchemaField({
        careerSkill0: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill1: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill2: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill3: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
        careerSkill4: new fields.StringField({ initial: "(none)", blank: true, nullable: true }),
      }),
      universal: new fields.BooleanField({ initial: false }),
    };
  }
}

export class SpeciesItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      talents: new fields.ObjectField(),
      abilities: new fields.ObjectField(),
      species: new fields.ObjectField(),
      startingXP: new SafeNumberField({ initial: 0, nullable: true }),
    };
  }
}

export class WeaponItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      hardpoints: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Hard Points", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "HP", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      equippable: new fields.SchemaField({
        value: new fields.BooleanField({ initial: true }),
        type: new fields.StringField({ initial: "Boolean", blank: true, nullable: true }),
        equipped: new fields.BooleanField({ initial: false }),
      }),
      itemattachment: new fields.ArrayField(new AnyField()),
      itemmodifier: new fields.ArrayField(new AnyField()),
      adjusteditemmodifer: new fields.ArrayField(new AnyField()),
      skill: new fields.SchemaField({
        value: new fields.StringField({ initial: "Ranged: Light", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Skill", blank: true, nullable: true }),
        useBrawn: new fields.BooleanField({ initial: false }),
      }),
      characteristic: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
      }),
      damage: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Damage", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Dam", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      crit: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Critical Rating", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Crit", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      range: new fields.SchemaField({
        value: new fields.StringField({ initial: "Short", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Range", blank: true, nullable: true }),
        adjusted: new fields.StringField({ initial: "Short", blank: true, nullable: true }),
      }),
      special: new fields.SchemaField({
        value: new fields.StringField({ initial: "", blank: true, nullable: true }),
        type: new fields.StringField({ initial: "String", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Special", blank: true, nullable: true }),
      }),
      ammo: new fields.SchemaField({
        max: new SafeNumberField({ initial: 0, nullable: true }),
        value: new SafeNumberField({ initial: 0, nullable: true }),
      }),
    };
  }
}

export class BackgroundItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      type: new fields.StringField({ initial: "culture", blank: true, nullable: true }),
    };
  }
}

export class ObligationItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      type: new fields.StringField({ initial: "duty", blank: true, nullable: true }),
      magnitude: new SafeNumberField({ initial: 0, nullable: true }),
      subtype: new fields.StringField({ initial: "", blank: true, nullable: true }),
    };
  }
}

export class MotivationItemModel extends FFGTypeModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "", blank: true, nullable: true }),
      attributes: new fields.ObjectField(),
      metadata: new fields.SchemaField({
        tags: new fields.ArrayField(new AnyField()),
        sources: new fields.ArrayField(new AnyField()),
      }),
      quantity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 1, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Quantity", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Qty", blank: true, nullable: true }),
      }),
      encumbrance: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Encumbrance", blank: true, nullable: true }),
        abrev: new fields.StringField({ initial: "Encum", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      price: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Price", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
      }),
      rarity: new fields.SchemaField({
        value: new SafeNumberField({ initial: 0, nullable: true }),
        type: new fields.StringField({ initial: "Number", blank: true, nullable: true }),
        label: new fields.StringField({ initial: "Rarity", blank: true, nullable: true }),
        adjusted: new SafeNumberField({ initial: 0, nullable: true }),
        // Restricted flag: whether the item is legally restricted. Previously stored on rarity but
        // missing from the generated schema, so a strict SchemaField pruned system.rarity.isrestricted
        // on every save (the "Restricted" toggle appeared to do nothing). Restored here.
        isrestricted: new fields.BooleanField({ initial: false }),
      }),
      type: new fields.StringField({ initial: "ambition", blank: true, nullable: true }),
    };
  }
}
