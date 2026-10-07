/**
 * Destiny Point spends that are limited per session (house rules): Bond Invocations
 * (helpers/bond-invocation.js) and Destiny Rerolls (helpers/destiny-reroll.js). Both count their uses
 * here, so one session boundary clears both, and both pay from the destiny pool the same way.
 *
 * The record is one world setting, written only by a GM:
 *   { session, started, uses: { <actor uuid>: [{ kind, messageId, time, ... }] } }
 * A session starts when the GM requests a destiny roll - how an FFG session starts - or picks the
 * reset entry in the destiny tracker's menu.
 *
 * Paying: a character some player owns spends a light side point and one no player owns a dark side
 * point; the point flips to the other side, as a flip on the destiny tracker does. The pool is a world
 * setting, so only a GM can pay.
 */

const STATE_SETTING = "destinySession";

const POOL = {
  light: { setting: "dPoolLight", label: "destiny-pool-light", flipTo: "dark" },
  dark: { setting: "dPoolDark", label: "destiny-pool-dark", flipTo: "light" },
};

export default class DestinySession {
  /** Setting keys whose change can make a spend possible or impossible. */
  static WATCHED_SETTINGS = [POOL.light.setting, POOL.dark.setting, STATE_SETTING].map((key) => `starwarsffg.${key}`);

  static registerSettings() {
    game.settings.register("starwarsffg", STATE_SETTING, {
      name: STATE_SETTING,
      scope: "world",
      config: false,
      default: {},
      type: Object,
    });
  }

  /* -------------------------------------------- */
  /*  Session uses                                */
  /* -------------------------------------------- */

  /** @returns {{session: ?string, started: ?number, uses: Object<string, object[]>}} */
  static state() {
    const stored = game.settings.get("starwarsffg", STATE_SETTING);
    const uses = stored?.uses && typeof stored.uses === "object" ? stored.uses : {};
    return { session: stored?.session ?? null, started: stored?.started ?? null, uses };
  }

  /**
   * How many times an actor has made one kind of spend this session.
   * @param {Actor} actor
   * @param {"bond"|"reroll"} kind
   */
  static used(actor, kind) {
    const list = this.state().uses[actor?.uuid];
    return Array.isArray(list) ? list.filter((entry) => entry?.kind === kind).length : 0;
  }

  /**
   * Count a spend against an actor. GM only.
   * @param {Actor} actor
   * @param {"bond"|"reroll"} kind
   * @param {object} entry  details kept with the use (message id, ...)
   */
  static async record(actor, kind, entry = {}) {
    const state = this.state();
    const time = Date.now();
    const previous = Array.isArray(state.uses[actor.uuid]) ? state.uses[actor.uuid] : [];
    await game.settings.set("starwarsffg", STATE_SETTING, {
      session: state.session ?? foundry.utils.randomID(),
      started: state.started ?? time,
      uses: { ...state.uses, [actor.uuid]: [...previous, { ...entry, kind, time }] },
    });
  }

  /**
   * Start a new session: every character's uses are back. GM only.
   * @param {object} [options]
   * @param {string} [options.notify]  text to show once it is done
   */
  static async reset({ notify = null } = {}) {
    if (!game.user.isGM) return;
    await game.settings.set("starwarsffg", STATE_SETTING, { session: foundry.utils.randomID(), started: Date.now(), uses: {} });
    if (notify) ui.notifications.info(notify);
  }

  /* -------------------------------------------- */
  /*  The destiny pool                            */
  /* -------------------------------------------- */

  /** Players spend light side points; the GM, for a character no player owns, dark side ones. */
  static side(actor) {
    return actor?.hasPlayerOwner ? "light" : "dark";
  }

  /** The pool side's name as the GM has configured it ("Light", "Dark" by default). */
  static poolLabel(side) {
    return game.i18n.localize(game.settings.get("starwarsffg", POOL[side].label));
  }

  /** @returns {{light: number, dark: number}} */
  static pool() {
    return {
      light: Math.trunc(Number(game.settings.get("starwarsffg", POOL.light.setting))) || 0,
      dark: Math.trunc(Number(game.settings.get("starwarsffg", POOL.dark.setting))) || 0,
    };
  }

  /** @returns {?string} localized text when the side has no point to spend, else null */
  static emptyReason(side) {
    return this.pool()[side] < 1 ? game.i18n.format("SWFFG.DestinySession.Errors.NoDestiny", { side: this.poolLabel(side) }) : null;
  }

  /** @returns {{light: number, dark: number}} the pool once a point from this side has flipped */
  static afterSpend(side, pool = this.pool()) {
    return { ...pool, [side]: pool[side] - 1, [POOL[side].flipTo]: pool[POOL[side].flipTo] + 1 };
  }

  /**
   * Spend one point from a side: it flips to the other. GM only; the caller has checked there is one.
   * @param {"light"|"dark"} side
   * @returns {Promise<{light: number, dark: number}>} the pool afterwards
   */
  static async spend(side) {
    const after = this.afterSpend(side);
    await game.settings.set("starwarsffg", POOL.light.setting, after.light);
    await game.settings.set("starwarsffg", POOL.dark.setting, after.dark);
    return after;
  }

  /** "Light Destiny Point spent. Pool: 1 Light, 2 Dark." */
  static spentText(side, pool) {
    return game.i18n.format("SWFFG.DestinySession.Spent", {
      side: this.poolLabel(side),
      light: pool.light,
      dark: pool.dark,
      lightLabel: this.poolLabel("light"),
      darkLabel: this.poolLabel("dark"),
    });
  }
}
