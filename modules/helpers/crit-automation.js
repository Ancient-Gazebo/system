/**
 * Critical Injury / Critical Hit automation.
 *
 * When a `criticalinjury` or `criticaldamage` item lands on an actor - from Apply Crit, the Critical
 * Roller's Choose button, or a drag onto the sheet - the active GM looks the crit up by name and
 * applies what the result does mechanically:
 *
 *  - at once: strain or system strain, statuses (prone, disoriented, staggered, blinded, ...), a die
 *    on the next check, dropped weapons, a flipped Destiny Point, the crew's share of a vehicle hit;
 *  - for a while: "until the end of the encounter" and "next turn" effects, as actor effects with the
 *    lifetimes helpers/status-effects.js already enforces;
 *  - until healed: modifiers (a lost characteristic point, Blinded's upgrades, a vehicle's lost
 *    defence, speed or thresholds) as Active Effects on the crit item itself, so deleting the crit
 *    removes them;
 *  - later: Bleeding Out at the start of each turn, The End is Nigh / Breaking Up after the next round.
 *    Death and destruction (Dead, The End is Nigh, Vaporized, Breaking Up) are reported, never marked:
 *    no Defeated status.
 *
 * Crits that change how a turn is played (Distracted, Hamstrung, Temporarily Lame, Winded, At the
 * Brink, Slowed Down, and anything staggered) are read back by the Character Pilot, the slot claim and
 * the roll dialog through {@link turnRestrictions}, {@link slotRestriction} and {@link adjustRollPool}.
 *
 * Everything a crit puts on an actor carries `flags.starwarsffg.critSource` (the crit item's id), so
 * healing the crit (deleting the item) takes it away again. A crit can also be switched off from the
 * sheet's crit list ({@link toggleSuppressed}) for the talents and powers that let a character ignore
 * critical injuries for a while: its effects are then suppressed (ActiveEffectFFG#isSuppressed) and
 * its restrictions and per-turn effects stop. Switched off during a fight, it switches back on when
 * that combat ends.
 *
 * Results the system cannot act on (which limb is crippled, a navicomputer failure) are only reported.
 */
import { AE_MODES } from "../config/ffg-active-effect-modes.js";
import {
  MARKER,
  NEXT_CHECK,
  STATUS,
  applyNextCheckLocal,
  applyStatusLocal,
  crewActors,
  findMarkerEffect,
  findStatusEffect,
  statusLabel,
  strainTrack,
} from "./status-effects.js";
import { activeCombat, combatantDisposition, currentCombatant, isActorsTurn, turnKey, usesSlots } from "./combat-turns.js";
import DestinySession from "./destiny-session.js";
import { escapeHTML, loc } from "./html.js";
import { GuardedDialogV2 as DialogV2 } from "./dialog-helpers.js";

const CRIT_TYPES = new Set(["criticalinjury", "criticaldamage"]);
const SETTING = "enableCritAutomation";
const ZONES = ["fore", "port", "starboard", "aft"];
const ZONE_LABELS = {
  fore: "SWFFG.VehicleFiringArcForward",
  port: "SWFFG.VehicleFiringArcPort",
  starboard: "SWFFG.VehicleFiringArcStarboard",
  aft: "SWFFG.VehicleFiringArcAft",
};

/* -------------------------------------------- */
/*  Lookups                                     */
/* -------------------------------------------- */

export function isCrit(item) {
  return CRIT_TYPES.has(item?.type);
}

export function isEnabled() {
  try {
    return Boolean(game.settings.get("starwarsffg", SETTING));
  } catch (err) {
    return false;
  }
}

/**
 * Which automation a crit item uses: its name with everything but letters dropped ("The End is Nigh"
 * -> "theendisnigh", "Fire!" -> "fire"), ignoring anything in brackets. A world item can name another
 * one in `flags.starwarsffg.critKey` (or "none" to opt out) when it has been renamed.
 * @param {Item} item
 * @returns {string}
 */
export function critKey(item) {
  const override = item?.flags?.starwarsffg?.critKey;
  if (typeof override === "string" && override) return override.toLowerCase();
  return String(item?.name ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
}

/** Whether a crit has been switched off from the sheet (see {@link toggleSuppressed}). */
export function isSuppressed(item) {
  return Boolean(item?.flags?.starwarsffg?.critSuppressed);
}

function critItems(actor) {
  return actor?.items?.filter?.((item) => isCrit(item)) ?? [];
}

function critState(item) {
  return item?.flags?.starwarsffg?.critState ?? {};
}

function characteristicLabel(key) {
  const label = CONFIG.FFG?.characteristics?.[key]?.label;
  return label ? game.i18n.localize(label) : key;
}

function zoneLabel(zone) {
  return game.i18n.localize(ZONE_LABELS[zone] ?? zone);
}

/**
 * The client that runs the automation: the active GM, who can write to every actor involved (the
 * target, a vehicle's crew, the destiny pool). With no GM connected, whoever made the change.
 */
function isRunner(userId) {
  const gm = game.users.activeGM;
  return gm ? gm.isSelf : userId === game.user.id;
}

/** The combat's actors and the crew of any vehicle in it. */
function combatActorList(combat) {
  const actors = new Map();
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor) continue;
    actors.set(actor.uuid, actor);
    for (const member of crewActors(actor)) actors.set(member.uuid, member);
  }
  return [...actors.values()];
}

/**
 * How long an existing status will last, ranked so a crit only ever lengthens it: a status the
 * Concussive quality gave for two rounds is not cut short by Stunned, and one somebody toggled by hand
 * (no lifetime at all) is left alone entirely.
 */
function lifetimeRank(effect) {
  const flags = effect?.flags?.starwarsffg ?? {};
  if (flags.critHeld) return 5;
  if (flags.duration === "combat") return 4;
  if (flags.expiry?.type === "rounds") return 3;
  if (flags.expiry?.type === "afterNextTurn") return 2;
  return 6;
}

/* -------------------------------------------- */
/*  A single crit being applied                 */
/* -------------------------------------------- */

class CritRun {
  /**
   * @param {Item} item     the crit, already embedded on its actor
   * @param {string} userId the user whose change created it
   */
  constructor(item, userId) {
    this.item = item;
    this.actor = item.actor;
    const context = item.flags?.starwarsffg?.critContext ?? {};
    this.appliedBy = context.appliedBy ?? userId;
    this.sourceMessageId = context.sourceMessageId ?? null;
    this.combat = game.combat?.started ? game.combat : null;
    /** What was done, what is left to the table, and buttons for the card. */
    this.lines = [];
    this.notes = [];
    this.buttons = [];
    /** Set when something with a lifetime was applied while no combat runs to count it. */
    this.untimed = false;
    /** Set when the crit left something its sheet switch can turn off. */
    this.switchable = false;
  }

  get isVehicle() {
    return this.actor.type === "vehicle";
  }

  text(key, data = {}) {
    return game.i18n.format(`SWFFG.CritAutomation.${key}`, { actor: this.actor.name, crit: this.item.name, ...data });
  }

  done(key, data) {
    this.lines.push(this.text(key, data));
  }

  note(key, data) {
    this.notes.push(this.text(key, data));
  }

  async setState(state) {
    await this.item.update({ "flags.starwarsffg.critState": { ...critState(this.item), ...state } });
  }

  /**
   * applyStatusLocal options for a lifetime, and its rank (see {@link lifetimeRank}).
   * @param {"nextTurn"|"rounds"|"encounter"|"healed"|"permanent"} kind
   */
  lifetime(kind, { turnOf = null, rounds = 1 } = {}) {
    switch (kind) {
      case "nextTurn":
        return { spec: { untilEndOfNextTurn: true, turnOf }, rank: 2 };
      case "rounds":
        return { spec: { rounds }, rank: 3 };
      case "encounter":
        return { spec: { untilEndOfEncounter: true }, rank: 4 };
      case "healed":
        return { spec: {}, rank: 5, held: true };
      default:
        return { spec: {}, rank: 6 };
    }
  }

  /**
   * "Until the end of the pilot's next turn": the vehicle's turn when the vehicle is in the combat,
   * otherwise (crew fighting from their own slots) one round.
   */
  pilotTurn() {
    const inCombat = this.combat?.combatants?.some((combatant) => combatant.actor?.uuid === this.actor.uuid);
    return inCombat ? { kind: "nextTurn", turnOf: this.actor.uuid } : { kind: "rounds", rounds: 1 };
  }

  /** The flags every effect this crit creates carries, so healing or switching off the crit finds it. */
  sourceFlags(holder, life) {
    this.switchable = true;
    const flags = { critSource: this.item.id };
    if (holder !== this.actor) flags.critHolder = this.actor.uuid;
    if (life?.held) flags.critHeld = true;
    return flags;
  }

  /**
   * Strain (or wounds, for the adversaries that take strain that way, or system strain for a vehicle),
   * or wounds.
   * @param {"strain"|"wounds"} kind
   * @returns {Promise<?string>} the track that took it, or null when the actor has none
   */
  async suffer(kind, amount, holder = this.actor) {
    const track = kind === "wounds" ? "wounds" : strainTrack(holder, true);
    if (!track || !holder.system?.stats?.[track]) return null;
    const value = (Number(holder.system.stats[track].value) || 0) + amount;
    await holder.update({ [`system.stats.${track}.value`]: value });
    return track;
  }

  /** Suffer, and say so. */
  async sufferAndReport(kind, amount) {
    const track = await this.suffer(kind, amount);
    if (track) this.done(`Suffer.${track}`, { amount });
    else this.note("Suffer.NoTrack", { amount });
  }

  /**
   * Put a registered status (or the Staggered marker) on an actor for a lifetime, unless it already
   * has it for at least as long.
   * @param {"staggered"|"prone"|"disoriented"|"immobilized"|"blinded"|"burning"} which
   */
  async status(which, kind, { holder = this.actor, turnOf = null, rounds = 1, report = true } = {}) {
    const isMarker = which === "staggered";
    const spec = isMarker
      ? { key: MARKER.staggered, name: game.i18n.localize("SWFFG.Status.Staggered"), img: "icons/svg/daze.svg" }
      : { statusId: STATUS[which] };
    const label = isMarker ? spec.name : statusLabel(spec.statusId);
    const life = this.lifetime(kind, { turnOf, rounds });
    const existing = isMarker ? findMarkerEffect(holder, spec.key) : findStatusEffect(holder, spec.statusId);
    if (existing && lifetimeRank(existing) >= life.rank) {
      if (report) this.done("Status.Kept", { status: label });
      return label;
    }
    // A status somebody can stand up from (prone) is not the crit's to take away when it heals.
    const flags = kind === "permanent" ? {} : this.sourceFlags(holder, life);
    await applyStatusLocal(holder, { ...spec, ...life.spec, flags });
    if (!this.combat && ["nextTurn", "rounds", "encounter"].includes(kind)) this.untimed = true;
    if (report) this.done(`Status.${kind}`, { status: label, rounds });
    return label;
  }

  /**
   * A marker effect of this crit's own: a restriction for the Character Pilot, a pool change for the
   * roll dialog, or plain dice modifiers, for a lifetime.
   */
  async marker(id, kind, { holder = this.actor, turnOf = null, rounds = 1, restrict = null, pool = null, changes = null, name = null } = {}) {
    const life = this.lifetime(kind, { turnOf, rounds });
    const flags = this.sourceFlags(holder, life);
    if (restrict) flags.critRestrict = restrict;
    if (pool) flags.critPool = pool;
    await applyStatusLocal(holder, {
      key: `crit-${this.item.id}-${id}`,
      name: name ?? this.item.name,
      img: this.item.img,
      changes,
      flags,
      ...life.spec,
    });
    if (!this.combat && ["nextTurn", "rounds", "encounter"].includes(kind)) this.untimed = true;
  }

  /**
   * A modifier that lasts until the crit is healed, kept on the crit item itself. A crit moved from
   * one actor to another brings its effects along, so one already there is not added twice.
   */
  async itemEffect(name, changes) {
    this.switchable = true;
    if (this.item.effects.some((effect) => effect.flags?.starwarsffg?.critAutomation && effect.name === name)) return;
    await this.item.createEmbeddedDocuments("ActiveEffect", [
      { name, img: this.item.img, changes, disabled: false, transfer: true, flags: { starwarsffg: { critAutomation: true } } },
    ]);
  }

  async nextCheck(kind) {
    await applyNextCheckLocal(this.actor, kind, 1);
    this.done("NextCheck", { effect: statusLabel(NEXT_CHECK[kind]) });
  }

  /** +1 difficulty until the end of the encounter, on the skills of some characteristics (or all). */
  async skillDifficulty(characteristics = null) {
    const skills = Object.entries(this.actor.system?.skills ?? {}).filter(
      ([, skill]) => !characteristics || characteristics.includes(skill?.characteristic)
    );
    if (!skills.length) return this.note("NoSkills");
    const changes = skills.map(([key]) => ({ key: `system.skills.${key}.difficulty`, mode: AE_MODES.ADD, value: "1" }));
    await this.marker("difficulty", "encounter", { changes });
    if (characteristics) {
      this.done("Difficulty.Characteristics", { characteristics: characteristics.map(characteristicLabel).join(" / ") });
    } else {
      this.done("Difficulty.All");
    }
  }

  /**
   * Horrific Injury and Gruesome Injury: 1d10 picks the characteristic, which is 1 lower for as long
   * as the crit is on the sheet. Gruesome Injury cannot take it below 1.
   */
  async loseCharacteristic({ minimumOne = false } = {}) {
    let key = critState(this.item).characteristic;
    let rolled = critState(this.item).d10 ?? null;
    if (!CONFIG.FFG?.characteristics?.[key]) {
      const roll = await new Roll("1d10").evaluate();
      rolled = roll.total;
      key = rolled <= 3 ? "Brawn" : rolled <= 6 ? "Agility" : ["Intellect", "Cunning", "Presence", "Willpower"][rolled - 7];
      await this.setState({ characteristic: key, d10: rolled });
    }
    const label = characteristicLabel(key);
    const name = `${this.item.name}: ${label} −1`;
    const change = { key: `system.characteristics.${key}.value`, mode: AE_MODES.ADD, value: "-1" };
    if (minimumOne && (Number(this.actor.system?.characteristics?.[key]?.value) || 0) <= 1) {
      return this.done("Characteristic.AtMinimum", { roll: rolled, characteristic: label });
    }
    await this.itemEffect(name, [change]);
    this.done("Characteristic.UntilHealed", { roll: rolled, characteristic: label });
  }

  /** Sudden Jolt: whatever is in hand is dropped. */
  async dropWeapons() {
    const held = this.actor.items.filter((item) => item.type === "weapon" && item.system?.equippable?.equipped);
    if (!held.length) return this.done("SuddenJolt.Nothing");
    for (const weapon of held) await weapon.update({ "system.equippable.equipped": false });
    this.done("SuddenJolt.Dropped", { weapons: held.map((weapon) => weapon.name).join(", ") });
  }

  /** Discouraging Wound: a light side point flips to dark for a player character, the reverse for an NPC. */
  async flipDestiny() {
    if (!game.user.isGM) return this.note("Destiny.NoGM");
    const side = DestinySession.side(this.actor);
    const other = side === "light" ? "dark" : "light";
    if (DestinySession.emptyReason(side)) {
      return this.done("Destiny.Empty", { from: DestinySession.poolLabel(side) });
    }
    const pool = await DestinySession.spend(side);
    this.done("Destiny.Flipped", {
      from: DestinySession.poolLabel(side),
      to: DestinySession.poolLabel(other),
      light: pool.light,
      dark: pool.dark,
      lightLabel: DestinySession.poolLabel("light"),
      darkLabel: DestinySession.poolLabel("dark"),
    });
  }

  /** The End is Nigh / Breaking Up: gone after the last initiative slot of the next round. */
  async scheduleDoom() {
    const kind = this.isVehicle ? "Vehicle" : "Character";
    if (!this.combat) return this.note(`Doom.NoCombat${kind}`);
    const due = this.combat.round + 1;
    await this.setState({ dueRound: due, combatId: this.combat.id, resolved: false });
    this.done(`Doom.${kind}`, { round: due });
  }

  /**
   * Dead / Vaporized. Only reported, so the table decides what happens: no Defeated status, and
   * nothing in the combat changes.
   */
  report() {
    this.done(this.isVehicle ? "Destroyed" : "Dead");
  }

  /** Overpowered: the attacker gets a free attack with the same pool. */
  offerFreeAttack() {
    const source = this.sourceMessageId ? game.messages.get(this.sourceMessageId) : null;
    if (!source?.rolls?.length) return this.note("Overpowered.Manual");
    this.done("Overpowered.Offer");
    this.buttons.push({ action: "free-attack", label: game.i18n.localize("SWFFG.CritAutomation.Overpowered.Button"), icon: "fa-solid fa-burst" });
  }

  /* ----- vehicles ----- */

  zones() {
    const shields = this.actor.system?.stats?.shields ?? {};
    return ZONES.map((zone) => ({ zone, value: Number(shields[zone]) || 0 }));
  }

  /**
   * Which defence zone took the hit. Asked of whoever runs the automation (the GM); a vehicle with
   * defence in one zone only is not asked.
   * @returns {Promise<?string>}
   */
  async chooseZone(candidates) {
    if (candidates.length === 1) return candidates[0].zone;
    const options = candidates
      .map((entry) => `<option value="${entry.zone}">${escapeHTML(zoneLabel(entry.zone))} (${entry.value})</option>`)
      .join("");
    const result = await DialogV2.wait({
      window: { title: `${this.item.name}: ${this.actor.name}` },
      classes: ["dialog", "starwarsffg"],
      content: `<p>${loc("SWFFG.CritAutomation.Zone.Prompt", { crit: this.item.name, actor: this.actor.name })}</p><div class="form-group"><select name="zone" style="width:100%;">${options}</select></div>`,
      buttons: [
        {
          action: "ok",
          icon: "fas fa-check",
          label: game.i18n.localize("SWFFG.CritAutomation.Zone.Apply"),
          default: true,
          callback: (_event, _button, dialog) => dialog.element.querySelector("select[name='zone']")?.value ?? null,
        },
        { action: "cancel", icon: "fas fa-times", label: game.i18n.localize("SWFFG.Cancel"), callback: () => null },
      ],
      rejectClose: false,
    });
    return result || null;
  }

  /**
   * The shield crits.
   * @param {"losingPower"|"failing"|"down"|"overload"} mode
   */
  async defence(mode) {
    const zones = this.zones().filter((entry) => entry.value > 0);
    if (mode === "overload") await this.sufferAndReport("strain", 2);
    if (!zones.length) {
      if (mode === "overload") {
        await this.itemEffect(`${this.item.name}: ${game.i18n.localize("SWFFG.CritAutomation.Armour")} −1`, [
          { key: "system.stats.armour.value", mode: AE_MODES.ADD, value: "-1" },
        ]);
        return this.done("Defence.Armour");
      }
      const amount = { losingPower: 1, failing: 2, down: 4 }[mode];
      const track = await this.suffer("strain", amount);
      return track ? this.done("Defence.NoDefence", { amount }) : this.note("Suffer.NoTrack", { amount });
    }

    const change = (zone, delta) => ({ key: `system.stats.shields.${zone}`, mode: AE_MODES.ADD, value: String(delta) });
    if (mode === "failing" || mode === "overload") {
      const toZero = mode === "overload";
      await this.itemEffect(this.item.name, zones.map((entry) => change(entry.zone, toZero ? -entry.value : -1)));
      return this.done(toZero ? "Defence.AllZero" : "Defence.AllDown", { zones: zones.map((entry) => zoneLabel(entry.zone)).join(", ") });
    }

    const zone = await this.chooseZone(zones);
    if (!zone) return this.note("Defence.NoZone");
    if (mode === "losingPower") {
      await this.itemEffect(this.item.name, [change(zone, -1)]);
      return this.done("Defence.ZoneDown", { zone: zoneLabel(zone) });
    }
    // Shields Down: the hit zone to zero, every other one down a point.
    const changes = zones.map((entry) => change(entry.zone, entry.zone === zone ? -entry.value : -1));
    await this.itemEffect(this.item.name, changes);
    this.done("Defence.ZoneZero", { zone: zoneLabel(zone) });
  }

  /** @param {"damaged"|"down"} mode  Engine Damaged (-1, to a minimum of 1) or Engines Down (to 0) */
  async speed(mode) {
    const speed = this.actor.system?.stats?.speed ?? {};
    const max = Number(speed.max) || 0;
    const to = mode === "down" ? 0 : Math.max(1, max - 1);
    if (to >= max) return this.done("Speed.AtMinimum", { max });
    await this.itemEffect(this.item.name, [{ key: "system.stats.speed.max", mode: AE_MODES.ADD, value: String(to - max) }]);
    // A vehicle going faster than it now can slows down; one whose engines died coasts on.
    if (mode === "damaged" && (Number(speed.value) || 0) > to) await this.actor.update({ "system.stats.speed.value": to });
    this.done(mode === "down" ? "Speed.Down" : "Speed.Damaged", { from: max, to });
  }

  async destabilized() {
    const stats = this.actor.system?.stats ?? {};
    const hull = Number(stats.hullTrauma?.max) || 0;
    const strain = Number(stats.systemStrain?.max) || 0;
    // "to half their original values", rounding the remainder up
    await this.itemEffect(this.item.name, [
      { key: "system.stats.hullTrauma.max", mode: AE_MODES.ADD, value: String(-Math.floor(hull / 2)) },
      { key: "system.stats.systemStrain.max", mode: AE_MODES.ADD, value: String(-Math.floor(strain / 2)) },
    ]);
    this.done("Destabilized", { hullFrom: hull, hullTo: hull - Math.floor(hull / 2), strainFrom: strain, strainTo: strain - Math.floor(strain / 2) });
  }

  /** Run something for every crew member; a vehicle with no crew registered is reported instead. */
  async forCrew(fn) {
    const crew = crewActors(this.actor);
    if (!crew.length) {
      this.note("Crew.None");
      return [];
    }
    const done = [];
    for (const member of crew) {
      try {
        await fn(member);
        done.push(member.name);
      } catch (err) {
        console.warn(`Star Wars FFG | Crit automation could not reach crew member ${member.name}`, err);
      }
    }
    return done;
  }

  /** A button on the card that opens the Critical Roller for another actor (GM only). */
  offerCritRoll(actor) {
    this.buttons.push({
      action: "roll-crit",
      actorUuid: actor.uuid,
      label: game.i18n.format("SWFFG.CritAutomation.RollCritFor", { name: actor.name }),
      icon: "fa-solid fa-user-injured",
    });
  }

  /** Post what was done. Nothing is posted for a crit there was nothing to say about. */
  async post() {
    if (this.untimed) this.note("Untimed");
    if (!this.lines.length && !this.notes.length && !this.buttons.length) return;
    await postCard({
      actor: this.actor,
      item: this.item,
      lines: this.lines,
      notes: this.notes,
      buttons: this.buttons,
      sourceMessageId: this.sourceMessageId,
      extraRecipients: [this.appliedBy],
      hint: this.switchable ? game.i18n.localize("SWFFG.CritAutomation.SuppressHint") : null,
    });
  }
}

/* -------------------------------------------- */
/*  The crits                                   */
/* -------------------------------------------- */

/** Personal-scale Critical Injuries, by {@link critKey}. */
const INJURIES = {
  minornick: (run) => run.sufferAndReport("strain", 1),
  sloweddown: async (run) => {
    await run.marker("slowed", "nextTurn", { restrict: { lastSlot: true } });
    run.done("SlowedDown");
  },
  suddenjolt: (run) => run.dropWeapons(),
  distracted: async (run) => {
    await run.marker("distracted", "nextTurn", { restrict: { noFreeManeuver: true } });
    run.done("Distracted");
  },
  offbalance: (run) => run.nextCheck("setback"),
  discouragingwound: (run) => run.flipDestiny(),
  stunned: (run) => run.status("staggered", "nextTurn"),
  stinger: (run) => run.nextCheck("difficulty"),
  bowledover: async (run) => {
    await run.status("prone", "permanent");
    await run.sufferAndReport("strain", 1);
  },
  headringer: (run) => run.skillDifficulty(["Intellect", "Cunning"]),
  fearsomewound: (run) => run.skillDifficulty(["Presence", "Willpower"]),
  agonizingwound: (run) => run.skillDifficulty(["Brawn", "Agility"]),
  slightlydazed: (run) => run.status("disoriented", "encounter"),
  scatteredsenses: async (run) => {
    await run.marker("senses", "encounter", { pool: { noBoost: true } });
    run.done("ScatteredSenses");
  },
  hamstrung: async (run) => {
    await run.marker("hamstrung", "encounter", { restrict: { noFreeManeuver: true } });
    run.done("Hamstrung");
  },
  overpowered: (run) => run.offerFreeAttack(),
  winded: async (run) => {
    await run.marker("winded", "encounter", { restrict: { noStrainManeuver: true } });
    run.done("Winded");
  },
  compromised: (run) => run.skillDifficulty(null),
  // Held for as long as the crit is: turnRestrictions reads them off the item.
  atthebrink: (run) => {
    run.switchable = true;
    run.done("AtTheBrink");
  },
  crippled: (run) => run.note("Crippled"),
  maimed: async (run) => {
    const skills = Object.keys(run.actor.system?.skills ?? {});
    await run.itemEffect(run.item.name, skills.map((key) => ({ key: `system.skills.${key}.setback`, mode: AE_MODES.ADD, value: "1" })));
    run.done("Maimed");
    run.note("MaimedLimb");
  },
  horrificinjury: (run) => run.loseCharacteristic(),
  temporarilylame: (run) => {
    run.switchable = true;
    run.done("TemporarilyLame");
  },
  blinded: async (run) => {
    const changes = [];
    for (const [key, skill] of Object.entries(run.actor.system?.skills ?? {})) {
      const name = `${key} ${game.i18n.localize(skill?.label ?? "")}`.toLowerCase();
      const senses = name.includes("perception") || name.includes("vigilance");
      changes.push({ key: `system.skills.${key}.upgradeDifficulty`, mode: AE_MODES.ADD, value: senses ? "3" : "2" });
    }
    await run.itemEffect(run.item.name, changes);
    run.done("Blinded");
    await run.status("blinded", "healed");
  },
  knockedsenseless: (run) => run.status("staggered", "encounter"),
  gruesomeinjury: (run) => run.loseCharacteristic({ minimumOne: true }),
  bleedingout: (run) => {
    run.switchable = true;
    run.done("BleedingOut");
  },
  theendisnigh: (run) => run.scheduleDoom(),
  dead: (run) => run.report(),
};

/** Vehicle and starship Critical Hits, by {@link critKey}. Both core-book tables are covered. */
const HITS = {
  mechanicalstress: (run) => run.sufferAndReport("strain", 1),
  jostled: async (run) => {
    const crew = await run.forCrew(async (member) => {
      await run.suffer("strain", 1, member);
      await run.status("disoriented", "rounds", { holder: member, rounds: 1, report: false });
    });
    if (crew.length) run.done("Jostled", { crew: crew.join(", ") });
  },
  losingpowertoshields: (run) => run.defence("losingPower"),
  knockedoffcourse: async (run) => {
    const turn = run.pilotTurn();
    await run.marker("course", turn.kind, { turnOf: turn.turnOf, rounds: turn.rounds });
    run.done("KnockedOffCourse");
  },
  tailspin: async (run) => {
    const turn = run.pilotTurn();
    await run.marker("tailspin", turn.kind, { turnOf: turn.turnOf, rounds: turn.rounds, pool: { vehicleAttackSetback: 2 } });
    run.done("Tailspin");
    const crew = await run.forCrew((member) =>
      run.status("immobilized", turn.kind, { holder: member, turnOf: turn.turnOf, rounds: turn.rounds, report: false })
    );
    if (crew.length) run.done("TailspinCrew", { crew: crew.join(", ") });
  },
  componenthit: async (run) => {
    await run.marker("component", "rounds", { rounds: 1 });
    run.done("ComponentHit");
  },
  shieldsfailing: (run) => run.defence("failing"),
  navicomputerfailure: (run) => run.note("Navicomputer"),
  powerfluctuations: (run) => run.note("PowerFluctuations"),
  shieldsdown: (run) => run.defence("down"),
  enginedamaged: (run) => run.speed("damaged"),
  shieldoverload: async (run) => {
    await run.defence("overload");
    run.note("ShieldOverload");
  },
  enginesdown: async (run) => {
    await run.speed("down");
    run.note("EnginesDown");
  },
  majorsystemfailure: (run) => run.note("MajorSystemFailure"),
  shotup: async (run) => {
    const crew = crewActors(run.actor);
    if (!crew.length) return run.note("ShotUp.NoCrew");
    const roll = await new Roll(`1d${crew.length}`).evaluate();
    const victim = crew[roll.total - 1];
    run.done("ShotUp.Victim", { crew: victim.name });
    run.offerCritRoll(victim);
  },
  majorhullbreach: (run) => run.note("HullBreach"),
  destabilized: (run) => run.destabilized(),
  fire: async (run) => {
    await run.sufferAndReport("strain", 2);
    await run.status("burning", "healed");
    run.note("Fire");
  },
  breakingup: (run) => run.scheduleDoom(),
  vaporized: (run) => run.report(),
};

/** Restrictions a crit holds for as long as it is not healed, read straight off the item. */
const HELD_RESTRICTIONS = {
  atthebrink: { strainPerAction: 1 },
  temporarilylame: { maxManeuvers: 1 },
};

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

function recipients(actor, extra = []) {
  const ids = new Set(game.users.filter((user) => user.isGM).map((user) => user.id));
  for (const user of game.users) {
    if (!user.isGM && actor?.testUserPermission?.(user, "OWNER")) ids.add(user.id);
  }
  for (const id of extra) if (id && game.users.get(id)) ids.add(id);
  return [...ids];
}

/**
 * The automation's report: whispered to the GMs, the actor's owners, the player who applied the crit
 * and the author of the attack it came from.
 */
async function postCard({ actor, item, lines = [], notes = [], buttons = [], sourceMessageId = null, extraRecipients = [], hint = null }) {
  const source = sourceMessageId ? game.messages.get(sourceMessageId) : null;
  const sourceAuthor = source?.author?.id ?? source?.user ?? null;
  const list = (entries, icon, cls) =>
    entries.length ? `<ul class="${cls}">${entries.map((entry) => `<li><i class="${icon}"></i> ${escapeHTML(entry)}</li>`).join("")}</ul>` : "";
  const buttonHtml = buttons.length
    ? `<div class="ffg-crit-auto-buttons">${buttons
        .map(
          (button, index) =>
            `<button type="button" data-crit-auto="${button.action}" data-index="${index}"><i class="${button.icon}"></i> ${escapeHTML(button.label)}</button>`
        )
        .join("")}</div>`
    : "";
  const content = `
    <div class="starwarsffg ffg-crit-auto-card">
      <header class="ffg-crit-auto-header">
        <i class="${actor.type === "vehicle" ? "fa-solid fa-burst" : "fa-solid fa-user-injured"}"></i>
        <span>${escapeHTML(item?.name ?? "")}: ${escapeHTML(actor.name)}</span>
      </header>
      ${list(lines, "fa-solid fa-check", "ffg-crit-auto-done")}
      ${list(notes, "fa-solid fa-book-open", "ffg-crit-auto-notes")}
      ${buttonHtml}
      ${hint ? `<p class="ffg-crit-auto-hint">${escapeHTML(hint)}</p>` : ""}
    </div>`;
  await ChatMessage.create({
    user: game.user.id,
    speaker: { alias: game.i18n.localize("SWFFG.CritAutomation.Speaker") },
    content,
    whisper: recipients(actor, [...extraRecipients, sourceAuthor]),
    flags: {
      starwarsffg: {
        critAutomation: {
          actorUuid: actor.uuid,
          sourceMessageId,
          buttons: buttons.map((button) => ({ action: button.action, actorUuid: button.actorUuid ?? null })),
        },
      },
    },
  });
}

/** Free attack for Overpowered: the attack's pool rolled again, as the attacker, with its visibility. */
async function freeAttack(sourceMessageId) {
  const source = game.messages.get(sourceMessageId);
  const [{ RollFFG }, { buildReroll }] = await Promise.all([import("../dice/roll.js"), import("../dice/reroll.js")]);
  const original = source?.rolls?.find((roll) => roll instanceof RollFFG);
  if (!original) {
    ui.notifications.warn(game.i18n.localize("SWFFG.CritAutomation.Overpowered.Missing"));
    return false;
  }
  let rollMode = "publicroll";
  if (source.blind) rollMode = "blindroll";
  else if (source.whisper?.length) rollMode = source.whisper.every((id) => game.users.get(id)?.isGM) ? "gmroll" : "selfroll";
  const tag = game.i18n.localize("SWFFG.CritAutomation.Overpowered.Tag");
  await buildReroll(original).toMessage(
    { user: game.user.id, speaker: source.speaker, flavor: source.flavor ? `${source.flavor} (${tag})` : tag },
    { rollMode }
  );
  return true;
}

/**
 * Wire the buttons on an automation card. Called from the system's chat render hook.
 * @param {ChatMessage} message
 * @param {jQuery} html
 */
export function bindChatMessage(message, html) {
  const data = message.flags?.starwarsffg?.critAutomation;
  if (!data) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const source = data.sourceMessageId ? game.messages.get(data.sourceMessageId) : null;
  const attacker = source?.author?.id ?? source?.user ?? null;
  for (const button of root.querySelectorAll("[data-crit-auto]")) {
    const action = button.dataset.critAuto;
    const entry = data.buttons?.[Number(button.dataset.index)] ?? {};
    const allowed = game.user.isGM || (action === "free-attack" && game.user.id === attacker);
    if (!allowed) {
      button.remove();
      continue;
    }
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (action === "free-attack") {
          if (!(await freeAttack(data.sourceMessageId))) button.disabled = false;
        } else if (action === "roll-crit") {
          const actor = entry.actorUuid ? await fromUuid(entry.actorUuid) : null;
          if (!actor) {
            ui.notifications.warn(game.i18n.localize("SWFFG.ApplyCrit.TargetGone"));
            button.disabled = false;
            return;
          }
          const { ApplyCrit } = await import("./apply-crit.js");
          await ApplyCrit.openRoller(actor);
          button.disabled = false;
        }
      } catch (err) {
        console.error("Star Wars FFG | Crit automation button failed", err);
        button.disabled = false;
      }
    });
  }
}

/* -------------------------------------------- */
/*  What the rest of the system asks            */
/* -------------------------------------------- */

/**
 * What an actor's crits (and the Staggered condition) stop it doing this turn. Read by the Character
 * Pilot and by the slot claim.
 * @param {?Actor} actor
 * @returns {{noAction: boolean, noFreeManeuver: boolean, maxManeuvers: ?number, noStrainManeuver: boolean,
 *   strainPerAction: number, lastSlot: boolean, sources: string[]}}
 */
export function turnRestrictions(actor) {
  const limits = {
    noAction: false,
    noFreeManeuver: false,
    maxManeuvers: null,
    noStrainManeuver: false,
    strainPerAction: 0,
    lastSlot: false,
    sources: [],
  };
  if (!actor) return limits;
  const add = (restrict, source) => {
    if (!restrict) return;
    if (restrict.noAction) limits.noAction = true;
    if (restrict.noFreeManeuver) limits.noFreeManeuver = true;
    if (restrict.noStrainManeuver) limits.noStrainManeuver = true;
    if (restrict.lastSlot) limits.lastSlot = true;
    const max = Number(restrict.maxManeuvers);
    if (max > 0) limits.maxManeuvers = limits.maxManeuvers === null ? max : Math.min(limits.maxManeuvers, max);
    limits.strainPerAction += Number(restrict.strainPerAction) || 0;
    if (source && !limits.sources.includes(source)) limits.sources.push(source);
  };
  for (const effect of actor.effects ?? []) {
    if (!effect.active) continue;
    const flags = effect.flags?.starwarsffg;
    if (flags?.tool === MARKER.staggered) add({ noAction: true }, effect.name);
    if (flags?.critRestrict) add(flags.critRestrict, effect.name);
  }
  if (isEnabled()) {
    for (const item of critItems(actor)) {
      if (!isSuppressed(item)) add(HELD_RESTRICTIONS[critKey(item)], item.name);
    }
  }
  return limits;
}

function poolFlags(actor) {
  return (actor?.effects ?? []).filter((effect) => effect.active && effect.flags?.starwarsffg?.critPool).map((effect) => effect.flags.starwarsffg.critPool);
}

/**
 * Change a roll dialog's starting pool for the roller's crits: Scattered Senses removes every boost
 * die, and Tailspin adds two setback to attacks made with the vehicle's weapons. Done to the pool the
 * dialog opens with, so the dice can still be changed by hand afterwards.
 * @param {DicePoolFFG} pool
 * @param {object} context
 * @param {?Actor} [context.actor]  who is rolling
 * @param {?Item|object} [context.item]  what is being rolled
 * @returns {DicePoolFFG}
 */
export function adjustRollPool(pool, { actor = null, item = null } = {}) {
  if (!pool || !isEnabled()) return pool;
  try {
    if (actor instanceof Actor && poolFlags(actor).some((flags) => flags.noBoost)) pool.boost = 0;
    const vehicle = item?.type === "shipweapon" && item.parent instanceof Actor ? item.parent : null;
    if (vehicle) {
      const extra = poolFlags(vehicle).reduce((sum, flags) => sum + (Number(flags.vehicleAttackSetback) || 0), 0);
      if (extra) pool.setback = (Number(pool.setback) || 0) + extra;
    }
  } catch (err) {
    console.warn("Star Wars FFG | Could not apply critical effects to the dice pool", err);
  }
  return pool;
}

/**
 * At the Brink: 1 strain each time the character takes an action. Charged once per turn, on its own
 * turn in a running combat, by whichever comes first - the Character Pilot spending the action or the
 * first check rolled that turn.
 * @param {?Actor} actor
 */
export async function chargeActionStrain(actor) {
  if (!actor?.isOwner || !isEnabled()) return;
  const combat = activeCombat();
  if (!combat || !isActorsTurn(actor, combat)) return;
  const amount = turnRestrictions(actor).strainPerAction;
  if (!amount) return;
  const key = turnKey(combat);
  if (actor.flags?.starwarsffg?.critActionCharged === key) return;
  const update = { "flags.starwarsffg.critActionCharged": key };
  const track = strainTrack(actor, true);
  if (track) update[`system.stats.${track}.value`] = (Number(actor.system.stats[track]?.value) || 0) + amount;
  await actor.update(update);
  ui.notifications.info(game.i18n.format("SWFFG.CritAutomation.AtTheBrinkCharged", { actor: actor.name, amount }));
}

/**
 * Slowed Down: in its next turn the character may only take the last initiative slot of its side.
 * @returns {?string} why the claim is refused, or null when it may go ahead
 */
export function slotRestriction(combat, slotIndex, combatant) {
  const actor = combatant?.actor;
  if (!actor || !usesSlots(combat) || !turnRestrictions(actor).lastSlot) return null;
  const slot = combat.turns?.[slotIndex];
  if (!slot) return null;
  const side = combatantDisposition(slot);
  let last = -1;
  combat.turns.forEach((turn, index) => {
    if (combatantDisposition(turn) !== side) return;
    // a slot an ally has already taken is not open to this character anyway
    const claimant = combat.getSlotClaims(combat.round, turn.id);
    if (claimant && claimant !== combatant.id) return;
    last = index;
  });
  if (last === -1 || last === slotIndex) return null;
  return game.i18n.format("SWFFG.CritAutomation.Errors.SlowedDown", { actor: actor.name });
}

/**
 * Switch a crit's penalties off (or back on) - for the talents and Force powers that let a character
 * ignore critical injuries. Switched off during a combat, it comes back on when that combat ends.
 * @param {Item} item
 */
export async function toggleSuppressed(item) {
  if (!isCrit(item) || !item.isOwner) return;
  const suppressed = !isSuppressed(item);
  const combat = activeCombat();
  await item.update({
    "flags.starwarsffg.critSuppressed": suppressed,
    "flags.starwarsffg.critSuppressedCombat": suppressed && combat ? combat.id : null,
  });
  const key = suppressed ? (combat ? "Suppress.OffCombat" : "Suppress.Off") : "Suppress.On";
  ui.notifications.info(game.i18n.format(`SWFFG.CritAutomation.${key}`, { crit: item.name, actor: item.actor?.name ?? "" }));
}

/* -------------------------------------------- */
/*  World data repair                           */
/* -------------------------------------------- */

/**
 * Wording slips in crit descriptions as the Zyraitix world had them: [crit key, wrong, right, what].
 * Each is only replaced where the wrong text is still there.
 */
const DESCRIPTION_FIXES = [
  ["headringer", /Presence and Willpower/gi, "Intellect and Cunning", "description now reads Intellect and Cunning"],
  ["sloweddown", /initiative slot on his turn/gi, "Initiative slot on his next turn", "description now reads \"on his next turn\""],
  ["knockedoffcourse", /the sh ip\b/gi, "the ship", "typo fixed"],
  ["powerfluctuations", /\bThee ship\b/g, "The ship", "typo fixed"],
  ["enginedamaged", /Critical(?:&nbsp;| )\s*Hit/g, "Critical Hit", "stray space removed"],
  ["fire", /page 214\b/g, "page 228", "page reference now 228"],
];

/** Severities that disagreed with the rulebook tables ("—" is 0, no healing check). */
const SEVERITY_FIXES = { gruesomeinjury: 4, dead: 0, vaporized: 0 };

/**
 * Fix critical injuries and hits as the Zyraitix world had them. Run by the 4.0.7 and 4.0.8
 * migrations, and available as `game.ffg.repairCriticalItems()`; it only changes what is still wrong.
 *
 *  - Head Ringer's description had been copied from Fearsome Wound and said Presence and Willpower;
 *    the injury is Intellect and Cunning (which is also what the automation applies). A few other
 *    descriptions had typos ({@link DESCRIPTION_FIXES}).
 *  - Compromised carried a hand-made modifier. The automation now applies Compromised itself, so a
 *    modifier on the item would count the difficulty twice; it is removed.
 *  - Gruesome Injury was severity Hard (Daunting in the rules), Dead and Vaporized Formidable (none).
 *
 * Covers world items, the copies on actors and those on unlinked tokens. GM only.
 * @returns {Promise<string[]>} what was changed
 */
export async function repairCriticalItems() {
  if (!game.user?.isGM) return [];
  const changed = [];
  const owners = [...game.actors];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens) if (!token.actorLink && token.actor) owners.push(token.actor);
  }
  const collections = [game.items, ...owners.map((actor) => actor.items)];
  for (const collection of collections) {
    for (const item of collection) {
      if (!isCrit(item) || item.pack) continue;
      const where = item.actor ? `${item.actor.name} :: ${item.name}` : item.name;
      try {
        const key = critKey(item);
        const update = {};
        const done = [];
        let description = item.system?.description ?? "";
        for (const [fixKey, wrong, right, what] of DESCRIPTION_FIXES) {
          if (fixKey !== key) continue;
          wrong.lastIndex = 0;
          if (!wrong.test(description)) continue;
          wrong.lastIndex = 0;
          description = description.replace(wrong, right);
          update["system.description"] = description;
          done.push(what);
        }
        if (key in SEVERITY_FIXES && Number(item.system?.severity) !== SEVERITY_FIXES[key]) {
          update["system.severity"] = SEVERITY_FIXES[key];
          done.push(`severity ${item.system?.severity} -> ${SEVERITY_FIXES[key]}`);
        }
        if (done.length) {
          await item.update(update);
          changed.push(`${where}: ${done.join(", ")}`);
        }
        if (key === "compromised") {
          const attributes = Object.keys(item.system?.attributes ?? {});
          const effects = item.effects
            .filter((effect) => attributes.includes(effect.name) || (effect.name?.startsWith("attr") && !effect.flags?.starwarsffg?.critAutomation))
            .map((effect) => effect.id);
          if (!attributes.length && !effects.length) continue;
          if (attributes.length) {
            await item.update({ "system.attributes": Object.fromEntries(attributes.map((attr) => [`-=${attr}`, null])) });
          }
          if (effects.length) await item.deleteEmbeddedDocuments("ActiveEffect", effects);
          changed.push(`${where}: modifier removed`);
        }
      } catch (err) {
        console.warn(`Star Wars FFG | Could not repair the critical injury ${where}`, err);
      }
    }
  }
  if (changed.length) {
    ui.notifications.info(game.i18n.format("SWFFG.CritAutomation.Repaired", { count: changed.length }));
    console.info(`Star Wars FFG | Critical injury repair:\n${changed.join("\n")}`);
  }
  return changed;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

async function onCritCreated(item, options, userId) {
  const actor = item.actor;
  if (!actor || !isCrit(item) || options?.ffgCritAutomation === false || !isEnabled() || !isRunner(userId)) return;
  // the wrong kind of crit for the actor (an injury dropped on a vehicle) is left alone
  if ((item.type === "criticaldamage") !== (actor.type === "vehicle")) return;
  const automation = (item.type === "criticaldamage" ? HITS : INJURIES)[critKey(item)];
  if (!automation) return;
  const run = new CritRun(item, userId);
  try {
    await automation(run);
  } catch (err) {
    console.error(`Star Wars FFG | Automating ${item.name} on ${actor.name} failed`, err);
    run.note("Failed");
  }
  try {
    await run.post();
  } catch (err) {
    console.error("Star Wars FFG | Could not post the critical effects card", err);
  }
}

/** Healing a crit (deleting it) takes away everything it put on the actor and its crew. */
async function onCritDeleted(item, userId) {
  const actor = item.actor;
  if (!actor || !isCrit(item) || !isRunner(userId)) return;
  try {
    for (const holder of [actor, ...crewActors(actor)]) {
      const ids = holder.effects
        .filter((effect) => {
          const flags = effect.flags?.starwarsffg;
          return flags?.critSource === item.id && (flags.critHolder ?? holder.uuid) === actor.uuid;
        })
        .map((effect) => effect.id);
      if (ids.length) await holder.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  } catch (err) {
    console.warn("Star Wars FFG | Could not remove a healed crit's effects", err);
  }
}

/** Per-actor queue, so two wound changes in quick succession cannot both count the same crit. */
const bleedChecks = new Map();

/** Every 5 wounds past the threshold, a character Bleeding Out suffers another Critical Injury. */
function checkBleedThreshold(actor) {
  const previous = bleedChecks.get(actor.uuid) ?? Promise.resolve();
  const next = previous
    .then(() => countBleedThreshold(actor))
    .catch((err) => console.warn("Star Wars FFG | Bleeding Out check failed", err));
  bleedChecks.set(actor.uuid, next);
  next.finally(() => {
    if (bleedChecks.get(actor.uuid) === next) bleedChecks.delete(actor.uuid);
  });
  return next;
}

async function countBleedThreshold(actor) {
  const bleeding = critItems(actor).filter((item) => critKey(item) === "bleedingout" && !isSuppressed(item));
  if (!bleeding.length) return;
  const wounds = actor.system?.stats?.wounds;
  const over = (Number(wounds?.value) || 0) - (Number(wounds?.max) || 0);
  const due = over > 0 ? Math.floor(over / 5) : 0;
  const item = bleeding[0];
  const counted = Number(critState(item).bleedCrits) || 0;
  if (due === counted) return;
  await item.update({ "flags.starwarsffg.critState": { ...critState(item), bleedCrits: due } });
  if (due < counted) return;
  const buttons = [];
  for (let i = counted; i < due; i++) {
    buttons.push({
      action: "roll-crit",
      actorUuid: actor.uuid,
      label: game.i18n.format("SWFFG.CritAutomation.RollCritFor", { name: actor.name }),
      icon: "fa-solid fa-user-injured",
    });
  }
  await postCard({
    actor,
    item,
    lines: [game.i18n.format("SWFFG.CritAutomation.BleedThreshold", { actor: actor.name, over, count: due - counted })],
    buttons,
  });
}

async function onCombatAdvance(combat) {
  if (!isEnabled() || !game.users.activeGM?.isSelf || !combat?.started) return;
  try {
    // The End is Nigh / Breaking Up, due after the last slot of their round
    for (const actor of combatActorList(combat)) {
      for (const item of critItems(actor)) {
        const state = critState(item);
        if (!state.dueRound || state.resolved || state.combatId !== combat.id || combat.round <= state.dueRound) continue;
        // reported only, like Dead and Vaporized
        await item.update({ "flags.starwarsffg.critState": { ...state, resolved: true } });
        await postCard({
          actor,
          item,
          lines: [game.i18n.format(`SWFFG.CritAutomation.${actor.type === "vehicle" ? "Destroyed" : "Dead"}`, { actor: actor.name })],
        });
      }
    }

    // Bleeding Out, at the start of the turn that just began
    const acting = currentCombatant(combat)?.actor;
    if (!acting) return;
    const key = turnKey(combat);
    for (const item of critItems(acting)) {
      if (critKey(item) !== "bleedingout" || isSuppressed(item)) continue;
      const state = critState(item);
      if (state.lastBleed === key) continue;
      await item.update({ "flags.starwarsffg.critState": { ...state, lastBleed: key } });
      const strain = strainTrack(acting, true);
      const stats = acting.system?.stats ?? {};
      const update = { "system.stats.wounds.value": (Number(stats.wounds?.value) || 0) + 1 };
      if (strain) update[`system.stats.${strain}.value`] = (Number(update[`system.stats.${strain}.value`] ?? stats[strain]?.value) || 0) + 1;
      // the wound change itself brings the updateActor check for further crits
      await acting.update(update);
      await postCard({ actor: acting, item, lines: [game.i18n.format("SWFFG.CritAutomation.Bleed", { actor: acting.name })] });
    }
  } catch (err) {
    console.warn("Star Wars FFG | Critical injury turn effects failed", err);
  }
}

async function onCombatEnded(combat) {
  if (!game.users.activeGM?.isSelf) return;
  try {
    for (const actor of combatActorList(combat)) {
      for (const item of critItems(actor)) {
        // switched off "until the end of the encounter"
        if (item.flags?.starwarsffg?.critSuppressedCombat === combat.id) {
          await item.update({ "flags.starwarsffg.critSuppressed": false, "flags.starwarsffg.critSuppressedCombat": null });
        }
        // a death that the end of the fight overtook
        const state = critState(item);
        if (isEnabled() && state.dueRound && !state.resolved && state.combatId === combat.id) {
          await item.update({ "flags.starwarsffg.critState": { ...state, resolved: true } });
          await postCard({ actor, item, notes: [game.i18n.format("SWFFG.CritAutomation.Doom.CombatEnded", { actor: actor.name, crit: item.name })] });
        }
      }
    }
  } catch (err) {
    console.warn("Star Wars FFG | Critical injury clean-up at combat end failed", err);
  }
}

/**
 * Register the automation's hooks. Call once at ready. Suppression and healing clean-up stay active
 * with the automation switched off, so crits applied before it was switched off still behave.
 */
export function registerCritAutomation() {
  Hooks.on("createItem", (item, options, userId) => {
    if (isCrit(item)) onCritCreated(item, options, userId);
  });
  Hooks.on("deleteItem", (item, _options, userId) => {
    if (isCrit(item)) onCritDeleted(item, userId);
  });
  Hooks.on("updateItem", (item, changed) => {
    if (!isCrit(item) || !foundry.utils.hasProperty(changed, "flags.starwarsffg.critSuppressed")) return;
    // A vehicle's crew hold effects of its crits; re-derive them so switching the crit takes effect.
    for (const member of crewActors(item.actor)) {
      member.reset();
      if (member.sheet?.rendered) member.sheet.render();
    }
  });
  Hooks.on("updateCombat", (combat) => onCombatAdvance(combat));
  Hooks.on("deleteCombat", (combat) => onCombatEnded(combat));
  Hooks.on("updateActor", (actor, changed) => {
    if (!isEnabled() || !game.users.activeGM?.isSelf) return;
    if (!foundry.utils.hasProperty(changed, "system.stats.wounds")) return;
    checkBleedThreshold(actor);
  });
}
