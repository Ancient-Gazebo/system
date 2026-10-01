/**
 * GM roll requests.
 *
 * The GM picks one or more online players, a skill, and the difficulty side of the check; each
 * player gets a prompt and rolls it through the ordinary roll dialog, with their own character's
 * ranks, characteristic and modifiers. Nothing is rolled on the GM's side.
 *
 * This is the complement of the roll dialog's "send pool to player" option, which ships a finished
 * pool built from whatever actor the GM had open. A request ships the QUESTION instead, so the same
 * request can go to four players and produce four different, correct pools.
 *
 * Transport is a whispered chat card rather than a bare socket message: the card carries the
 * request in its flags, so it survives a reload and can be answered later, and the pop-up is just a
 * convenience raised when the card arrives.
 */
import DiceHelpers from "../helpers/dice-helpers.js";
import { DicePoolFFG } from "../dice/pool.js";
import { escapeHTML } from "../helpers/html.js";
import { GuardedDialogV2 as DialogV2 } from "../helpers/dialog-helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LIMITS = { difficulty: 5, upgrades: 10, boost: 10, setback: 10 };
const ROLL_MODES = ["publicroll", "gmroll", "blindroll", "selfroll"];
const SKILL_TYPE_ORDER = ["General", "Combat", "Social", "Knowledge", "Magic"];

/**
 * The character a request to this user is rolled with: their assigned character, or failing that
 * the one character they have been made owner of by name. (Default-owner permissions do not count,
 * or every player would resolve to the same actor.)
 * @param {User} user
 * @returns {?Actor}
 */
function characterFor(user) {
  if (user.character) return user.character;
  const owned = game.actors.filter((actor) => actor.type === "character" && actor.ownership?.[user.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  return owned.length === 1 ? owned[0] : null;
}

function skillLabel(key, skill) {
  const label = skill?.label ?? CONFIG.FFG.skills?.[key]?.label;
  return label ? game.i18n.localize(label) : key;
}

export default class RollRequestApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._state = {
      selected: new Set(),
      skill: "",
      label: "",
      difficulty: 2,
      upgrades: 0,
      boost: 0,
      setback: 0,
      rollMode: "publicroll",
    };
  }

  static DEFAULT_OPTIONS = {
    id: "ffg-roll-request",
    classes: ["starwarsffg", "ffg-roll-request"],
    tag: "div",
    window: {
      title: "SWFFG.RollRequest.Title",
      icon: "fa-solid fa-dice",
      resizable: true,
    },
    position: {
      width: 520,
    },
    actions: {
      toggleUser: RollRequestApp.#onToggleUser,
      setDifficulty: RollRequestApp.#onSetDifficulty,
      step: RollRequestApp.#onStep,
      send: RollRequestApp.#onSend,
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/dialogs/ffg-roll-request.html",
    },
  };

  /** The one request window a GM keeps; it remembers the last request while it stays open. */
  static instance = null;

  /** Open (or bring forward) the request window. */
  static open() {
    if (!game.user.isGM) return null;
    RollRequestApp.instance ??= new RollRequestApp();
    RollRequestApp.instance.render({ force: true });
    return RollRequestApp.instance;
  }

  /** @override */
  async close(options) {
    RollRequestApp.instance = null;
    return super.close(options);
  }

  /** Online players, each with the character a request would be rolled with. */
  _players() {
    return game.users
      .filter((user) => user.active && !user.isGM)
      .map((user) => ({ user, actor: characterFor(user) }))
      .sort((a, b) => a.user.name.localeCompare(b.user.name, game.i18n.lang));
  }

  /** @override */
  async _prepareContext(_options) {
    const state = this._state;
    const players = this._players();

    // Drop anyone who has logged off since the last render, and when there is exactly one player to
    // ask, ask them: a single-player table should not need the extra click.
    const available = new Set(players.filter((p) => p.actor).map((p) => p.user.id));
    for (const id of [...state.selected]) if (!available.has(id)) state.selected.delete(id);
    if (!state.selected.size && available.size === 1) state.selected.add([...available][0]);

    // The skills on offer are those of the selected characters (everyone's, until someone is
    // picked), so a custom skill only one character has is still requestable.
    const pool = players.filter((p) => p.actor && (!state.selected.size || state.selected.has(p.user.id)));
    const skills = new Map();
    for (const [key, skill] of Object.entries(CONFIG.FFG.skills ?? {})) {
      skills.set(key, { key, label: skillLabel(key, skill), type: skill?.type ?? "General" });
    }
    for (const { actor } of pool) {
      for (const [key, skill] of Object.entries(actor.system?.skills ?? {})) {
        if (!skills.has(key)) skills.set(key, { key, label: skillLabel(key, skill), type: skill?.type ?? "General" });
      }
    }
    if (!skills.has(state.skill)) state.skill = "";

    const groups = new Map();
    for (const skill of skills.values()) {
      if (!groups.has(skill.type)) groups.set(skill.type, []);
      groups.get(skill.type).push({ ...skill, selected: skill.key === state.skill });
    }
    const order = (type) => {
      const index = SKILL_TYPE_ORDER.indexOf(type);
      return index < 0 ? SKILL_TYPE_ORDER.length : index;
    };
    const skillGroups = [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([type, list]) => ({
        label: type,
        skills: list.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
      }));

    return {
      players: players.map(({ user, actor }) => ({
        id: user.id,
        name: user.name,
        color: user.color?.css ?? user.color ?? "#888888",
        hasActor: !!actor,
        actorName: actor?.name ?? game.i18n.localize("SWFFG.RollRequest.NoCharacter"),
        actorImg: actor?.img ?? "icons/svg/mystery-man.svg",
        selected: state.selected.has(user.id),
      })),
      skillGroups,
      state,
      difficultyDice: Array.from({ length: LIMITS.difficulty }, (_, index) => ({
        value: index + 1,
        active: index < state.difficulty,
      })),
      difficultyIcon: CONFIG.FFG.DIFFICULTY_ICON,
      steppers: ["upgrades", "boost", "setback"].map((field) => ({
        field,
        label: game.i18n.localize(`SWFFG.RollRequest.Fields.${field}`),
        value: state[field],
        atMin: state[field] <= 0,
        atMax: state[field] >= LIMITS[field],
      })),
      rollModes: ROLL_MODES.map((mode) => ({
        value: mode,
        label: game.i18n.localize(`SWFFG.RollRequest.Modes.${mode}`),
        selected: mode === state.rollMode,
      })),
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    // Free-text and dropdown fields write straight into the state; only the click controls
    // re-render, so typing a reason never loses focus.
    root.querySelector("select[name='skill']")?.addEventListener("change", (event) => {
      this._state.skill = event.currentTarget.value;
      this._paintPreview();
    });
    root.querySelector("input[name='label']")?.addEventListener("input", (event) => {
      this._state.label = event.currentTarget.value;
    });
    root.querySelector("select[name='rollMode']")?.addEventListener("change", (event) => {
      this._state.rollMode = event.currentTarget.value;
    });
    this._paintPreview();
  }

  /** The request as it would be sent, minus the per-player parts. */
  _request() {
    const { skill, label, difficulty, upgrades, boost, setback, rollMode } = this._state;
    return { skill, label: label.trim(), difficulty, upgrades, boost, setback, rollMode };
  }

  /** Draw the pool each selected character would roll, and the difficulty side on its own. */
  _paintPreview() {
    const root = this.element;
    const request = this._request();

    const final = root.querySelector("[data-final-difficulty]");
    if (final) {
      final.replaceChildren();
      RollRequestApp.difficultyPool(request).renderPreview(final);
    }

    const container = root.querySelector("[data-preview]");
    if (!container) return;
    container.replaceChildren();
    const selected = this._players().filter((p) => p.actor && this._state.selected.has(p.user.id));
    if (!selected.length || !request.skill) {
      const hint = document.createElement("p");
      hint.className = "notes";
      hint.textContent = game.i18n.localize(selected.length ? "SWFFG.RollRequest.PreviewPickSkill" : "SWFFG.RollRequest.PreviewPickPlayer");
      container.append(hint);
      return;
    }
    for (const { actor } of selected) {
      const row = document.createElement("div");
      row.className = "ffg-rr-preview-row";
      const name = document.createElement("span");
      name.className = "ffg-rr-preview-name";
      name.textContent = actor.name;
      const dice = document.createElement("div");
      dice.className = "dice-pool";
      RollRequestApp.previewPool(actor, request).renderPreview(dice);
      row.append(name, dice);
      if (!actor.system?.skills?.[request.skill]) {
        const note = document.createElement("span");
        note.className = "ffg-rr-preview-note";
        note.textContent = game.i18n.localize("SWFFG.RollRequest.PreviewUntrained");
        row.append(note);
      }
      container.append(row);
    }
  }

  /** The requested difficulty side alone: N difficulty dice, upgraded, plus setback. */
  static difficultyPool(request) {
    const pool = new DicePoolFFG({ difficulty: request.difficulty, setback: request.setback });
    pool.upgradeDifficulty(request.upgrades);
    return pool;
  }

  /**
   * A synchronous estimate of the pool a character would roll, for the GM's preview. The roll itself
   * is assembled on the player's side by {@link RollRequestApp.openRoll}, which also folds in
   * anything only known there (their current targets).
   */
  static previewPool(actor, request) {
    const skill = actor.system?.skills?.[request.skill] ?? { rank: 0 };
    const characteristic = actor.system?.characteristics?.[skill.characteristic] ?? { value: 0 };
    const pool = DiceHelpers.buildSkillPool({ skill, characteristic, baseDifficulty: request.difficulty });
    pool.upgradeDifficulty(request.upgrades);
    pool.boost += request.boost;
    pool.setback += request.setback;
    return pool;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {RollRequestApp} */
  static #onToggleUser(_event, target) {
    const id = target.dataset.userId;
    if (!id) return;
    if (this._state.selected.has(id)) this._state.selected.delete(id);
    else this._state.selected.add(id);
    this.render();
  }

  /** @this {RollRequestApp} */
  static #onSetDifficulty(_event, target) {
    const value = Math.clamp(parseInt(target.dataset.value, 10) || 0, 0, LIMITS.difficulty);
    // Clicking the die that is already the last one lit clears the difficulty to zero (a simple check).
    this._state.difficulty = this._state.difficulty === value ? 0 : value;
    this.render();
  }

  /** @this {RollRequestApp} */
  static #onStep(_event, target) {
    const field = target.dataset.field;
    if (!(field in LIMITS) || field === "difficulty") return;
    const delta = parseInt(target.dataset.delta, 10) || 0;
    this._state[field] = Math.clamp(this._state[field] + delta, 0, LIMITS[field]);
    this.render();
  }

  /** @this {RollRequestApp} */
  static async #onSend() {
    const request = this._request();
    const recipients = this._players().filter((p) => p.actor && this._state.selected.has(p.user.id));
    if (!recipients.length) return ui.notifications.warn(game.i18n.localize("SWFFG.RollRequest.Errors.NoPlayer"));
    if (!request.skill) return ui.notifications.warn(game.i18n.localize("SWFFG.RollRequest.Errors.NoSkill"));

    for (const { user, actor } of recipients) {
      await RollRequestApp.send({ ...request, userId: user.id, actorUuid: actor.uuid });
    }
    ui.notifications.info(game.i18n.format("SWFFG.RollRequest.Sent", { count: recipients.length }));
  }

  /* -------------------------------------------- */
  /*  Sending and answering                       */
  /* -------------------------------------------- */

  /**
   * Whisper one request to one player. Also the macro entry point:
   *   game.ffg.RollRequestApp.send({ userId, actorUuid, skill: "Perception", difficulty: 3 })
   *
   * @param {object} request
   * @param {string} request.userId       who is being asked
   * @param {string} request.actorUuid    the character they roll with
   * @param {string} request.skill        skill key
   * @param {number} [request.difficulty] difficulty dice before upgrades
   * @param {number} [request.upgrades]   difficulty upgrades
   * @param {number} [request.boost]
   * @param {number} [request.setback]
   * @param {string} [request.rollMode]   publicroll / gmroll / blindroll / selfroll
   * @param {string} [request.label]      what the check is for
   * @returns {Promise<ChatMessage>}
   */
  static async send(request) {
    const actor = await fromUuid(request.actorUuid);
    const data = {
      userId: request.userId,
      actorUuid: request.actorUuid,
      skill: request.skill,
      difficulty: Math.clamp(parseInt(request.difficulty, 10) || 0, 0, LIMITS.difficulty),
      upgrades: Math.clamp(parseInt(request.upgrades, 10) || 0, 0, LIMITS.upgrades),
      boost: Math.clamp(parseInt(request.boost, 10) || 0, 0, LIMITS.boost),
      setback: Math.clamp(parseInt(request.setback, 10) || 0, 0, LIMITS.setback),
      rollMode: ROLL_MODES.includes(request.rollMode) ? request.rollMode : "publicroll",
      label: String(request.label ?? "").trim(),
      skillLabel: skillLabel(request.skill, actor?.system?.skills?.[request.skill]),
    };

    const dice = document.createElement("div");
    dice.className = "dice-pool";
    RollRequestApp.difficultyPool(data).renderPreview(dice);
    const modifiers = data.boost
      ? `<span class="ffg-rr-card-mod">${escapeHTML(game.i18n.format("SWFFG.RollRequest.Card.Boost", { count: data.boost }))}</span>`
      : "";

    const content = `
      <div class="ffg-roll-request-card">
        <div class="ffg-rr-card-title"><i class="fa-solid fa-dice"></i> ${escapeHTML(game.i18n.localize("SWFFG.RollRequest.Card.Title"))}</div>
        <div class="ffg-rr-card-body">
          <img src="${escapeHTML(actor?.img ?? "icons/svg/mystery-man.svg")}" alt="" />
          <div>
            <div class="ffg-rr-card-skill">${escapeHTML(game.i18n.format("SWFFG.RollRequest.Card.Check", { skill: data.skillLabel, actor: actor?.name ?? "" }))}</div>
            ${data.label ? `<div class="ffg-rr-card-label">${escapeHTML(data.label)}</div>` : ""}
          </div>
        </div>
        <div class="ffg-rr-card-dice">${dice.outerHTML}${modifiers}</div>
        <button type="button" class="ffg-roll-request-open"><i class="fa-solid fa-dice-d20"></i> ${escapeHTML(game.i18n.localize("SWFFG.RollRequest.Card.Roll"))}</button>
      </div>`;

    return ChatMessage.create({
      content,
      whisper: [data.userId],
      speaker: { alias: game.user.name },
      flags: { starwarsffg: { rollRequest: data } },
    });
  }

  /**
   * Open the roll dialog for a request, on the client of whoever is answering it.
   * @param {object} request  the `rollRequest` flag of a request card
   */
  static async openRoll(request) {
    const actor = await fromUuid(request.actorUuid);
    if (!actor) return ui.notifications.warn(game.i18n.localize("SWFFG.RollRequest.Errors.NoActor"));
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("SWFFG.RollRequest.Errors.NotOwner"));

    const sheetData = await actor.sheet.getData();
    const rolled = await DiceHelpers.assemblePool({
      actorData: actor.system,
      baseSkillKey: request.skill,
      baseDifficulty: request.difficulty,
    });
    const pool = rolled.dicePool;
    pool.upgradeDifficulty(request.upgrades);
    pool.boost += request.boost;
    pool.setback += request.setback;

    const label = game.i18n.localize(rolled.label ?? request.skillLabel ?? request.skill);
    await DiceHelpers.displayRollDialog(
      sheetData,
      pool,
      `${game.i18n.localize("SWFFG.Rolling")} ${label}`,
      rolled.label ?? request.skill,
      { name: label, type: "skill" },
      request.label || undefined,
      undefined,
      { rollMode: request.rollMode }
    );
  }

  /**
   * Wire the Roll button on a request card. Called from the system's chat render hook.
   * @param {ChatMessage} message
   * @param {jQuery} html
   */
  static bindChatMessage(message, html) {
    const button = html.find(".ffg-roll-request-open")[0];
    if (!button) return;
    const request = message.getFlag("starwarsffg", "rollRequest");
    // The card is whispered to one player; the GM who sent it sees it too and may roll on that
    // player's behalf, but nobody else should be offered someone else's check.
    if (!request || !(game.user.isGM || request.userId === game.user.id)) {
      button.remove();
      return;
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      RollRequestApp.openRoll(request);
    });
  }

  /**
   * Raise the pop-up on the asked player's client when a request card arrives, and add the GM's
   * scene-control entry point. Call once, at init.
   */
  static register() {
    // a player logging in or out changes who can be asked
    Hooks.on("userConnected", () => {
      if (RollRequestApp.instance?.rendered) RollRequestApp.instance.render();
    });

    Hooks.on("createChatMessage", async (message, _options, userId) => {
      const request = message.getFlag("starwarsffg", "rollRequest");
      if (!request || request.userId !== game.user.id || userId === game.user.id) return;
      const sender = game.users.get(userId)?.name ?? game.i18n.localize("SWFFG.RollRequest.TheGM");
      const lines = [
        `<p>${escapeHTML(game.i18n.format("SWFFG.RollRequest.Popup.Body", { user: sender, skill: request.skillLabel }))}</p>`,
      ];
      if (request.label) lines.push(`<p><em>${escapeHTML(request.label)}</em></p>`);
      const answer = await DialogV2.wait({
        window: { title: game.i18n.localize("SWFFG.RollRequest.Card.Title"), icon: "fa-solid fa-dice" },
        classes: ["dialog", "starwarsffg"],
        content: lines.join(""),
        buttons: [
          { action: "roll", icon: "fa-solid fa-dice-d20", label: game.i18n.localize("SWFFG.RollRequest.Card.Roll"), default: true },
          { action: "later", icon: "fa-solid fa-clock", label: game.i18n.localize("SWFFG.RollRequest.Popup.Later") },
        ],
        rejectClose: false,
      });
      if (answer === "roll") await RollRequestApp.openRoll(request);
    });
  }
}
