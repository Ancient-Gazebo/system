/**
 * Relationship Web: every bond kept by GlitchSmith's Stylish Relationship Tracker, drawn as one web.
 *
 * The tracker shows one actor's relationships at a time. This window puts all of them together, in
 * the manner of Fabula Ultima's party bond chart: every character and NPC that holds a bond, or is
 * the subject of one, is a portrait, and every pair with a bond between them is joined by a line.
 * One character sits at the centre; the characters it is bonded to form the first ring around it,
 * theirs the next, and so on, so the rings read as degrees of separation. Characters with no path to
 * the centre wait, dimmed, on an outer ring. Clicking a portrait moves it to the centre.
 *
 * A line is drawn in two halves, each half one side's bond: blue for a positive bond, red for a
 * negative one, a faint dashed half where the bond is not returned (or, for a player, not known).
 * A half grows thicker with its rank, and the rank itself sits on a badge at that side's end (shown
 * for the centred character's bonds, and for any line under the pointer).
 *
 * The tracker is a protected module, so it is only read through its public API -
 * `listRelationshipProgress`, which applies the tracker's own visibility rules for the viewing user
 * (hidden, GM-only and locked relationships never appear) - plus the display fields (name, role,
 * picture) of the entries that API returned, as Bond Invocations reads them. Organizations are
 * reputation rather than bonds and are left out. Relationships recorded by name only (no actor) are
 * matched to an actor of the same name when the user knows of one, as Fabula Ultima matches bond
 * names; otherwise they get a node of their own.
 *
 * One exception to the tracker's rules, behind its own setting (on by default): players see every
 * bond that involves a player character - every bond a player character holds (toward other player
 * characters, NPCs and name-only people alike) and every bond anyone holds toward a player character -
 * even where the tracker would not let them open the holder's archive. Those are read through a GM's
 * view and kept only when the relationship itself is visible to players (not GM-only, not owner-only,
 * not locked). Bonds between NPCs stay under the tracker's rules. Player characters are always shown
 * to players by name; an NPC still only when the player knows it (LIMITED), as in the tracker. A
 * player character is a character-type actor with a player owner. The tracker's API gives a player
 * only their own view (it refuses another user's id unless the caller is a GM), so a player's web
 * asks the active GM for these bonds over a query; with no GM online it follows the tracker's rules
 * alone and says so.
 *
 * Owners are the world's actors. A relationship stored on an unlinked token's own actor data is not
 * read; one that points at a token's actor is.
 */
import { escapeHTML, loc } from "../helpers/html.js";

const { ApplicationV2 } = foundry.applications.api;

const TRACKER_ID = "stylish-relationship-tracker";
const TRACKER_FLAG = "relationshipData";
const ENABLE_SETTING = "enableRelationshipWeb";
const SHARE_PC_SETTING = "relationshipWebSharePCBonds";
const SVG_NS = "http://www.w3.org/2000/svg";
const MYSTERY = "icons/svg/mystery-man.svg";

/** Layout, in the web's own units (the SVG viewBox), before any zoom. */
const NODE_RADIUS = 30;
const FOCUS_SCALE = 1.35;
const RING_GAP = 170;
const MIN_ARC = 100;
const PADDING = 30;
const LABEL_SPACE = 44;
const MIN_BOX = 520;
const BADGE_GAP = 34;
const LABEL_LENGTH = 20;

const TWEEN_MS = 450;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const DRAG_THRESHOLD = 4;

/** @returns {?object} the tracker's API, when the module is active */
function trackerApi() {
  const tracker = game.modules.get(TRACKER_ID);
  return tracker?.active ? tracker.api ?? null : null;
}

/** @returns {?Actor} */
function resolveActor(uuid) {
  if (!uuid) return null;
  let actor = null;
  try {
    actor = fromUuidSync(uuid);
  } catch (err) {
    return null;
  }
  return actor instanceof Actor ? actor : null;
}

function isPlayerCharacter(actor) {
  return actor?.type === "character" && !!actor.hasPlayerOwner;
}

/** A name as it is matched: trimmed, lower-cased. */
function lowerName(name) {
  return String(name ?? "").trim().toLocaleLowerCase(game.i18n.lang);
}

/**
 * A test for whether a relationship points at a player character: by actor, or by a name-only entry
 * naming one (which buildRelationshipWeb matches to that character).
 * @returns {(relationship: {targetUuid?: string, customName?: string}) => boolean}
 */
function targetsPlayerCharacter() {
  const names = new Set(game.actors.filter((actor) => isPlayerCharacter(actor)).map((actor) => lowerName(actor.name)));
  return (relationship) => {
    if (relationship?.targetUuid) return isPlayerCharacter(resolveActor(relationship.targetUuid));
    const name = lowerName(relationship?.customName);
    return !!name && names.has(name);
  };
}

/** Whether players are shown the bonds involving player characters (see the header). */
function sharesPCBonds() {
  try {
    return !!game.settings.get("starwarsffg", SHARE_PC_SETTING);
  } catch (err) {
    return true;
  }
}

/**
 * The words for the faint half of a one-sided line. For a GM it is a bond not returned; a player may
 * simply not be allowed to see the other side's bond, so for them it is only none known.
 */
function unreturnedLabel() {
  return loc(game.user.isGM ? "SWFFG.RelationshipWeb.Unreturned" : "SWFFG.RelationshipWeb.UnreturnedUnknown");
}

function isDefaultImage(img) {
  return !img || img.includes("mystery-man");
}

/** The mean of some angles, taken on the circle. 0 when there are none. */
function circularMean(angles) {
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return x || y ? Math.atan2(y, x) : 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/* -------------------------------------------- */
/*  The web                                     */
/* -------------------------------------------- */

/**
 * @typedef {object} WebNode
 * @property {string} key        the actor's uuid, or `name:<name>` for a name-only relationship
 * @property {string} name
 * @property {string} img
 * @property {?string} actorUuid
 * @property {"pc"|"npc"|"custom"} kind
 * @property {boolean} owner     whether its own bonds are among those shown
 * @property {boolean} archive   whether the user may open its archive in the tracker
 */

/**
 * @typedef {object} WebBond
 * @property {string} from       node key of the bond's holder
 * @property {string} to
 * @property {number} rank
 * @property {number} maxRank
 * @property {boolean} negative
 * @property {string} role
 */

/**
 * Runs on the GM: the bonds the player-character exception shares with players (see the header) -
 * every bond a player character holds, and every bond anyone holds toward one - as the tracker's own
 * progress entries. The GM's view drops only locked entries, so the relationship's own visibility is
 * checked here.
 * @returns {object[]} progress entries, each carrying the uuid of the actor that holds it as `ownerActorUuid`
 */
export function sharedPlayerCharacterBonds() {
  const api = trackerApi();
  if (!game.user.isGM || !api?.listRelationshipProgress || !sharesPCBonds()) return [];
  const targetsPC = targetsPlayerCharacter();
  const shared = [];
  for (const owner of game.actors) {
    const stored = owner.getFlag(TRACKER_ID, TRACKER_FLAG)?.relationships;
    if (!Array.isArray(stored) || !stored.length) continue;
    // An NPC with no relationship toward a player character has nothing to share; skip reading it.
    const ownerIsPC = isPlayerCharacter(owner);
    if (!ownerIsPC && !stored.some(targetsPC)) continue;
    let progress;
    try {
      progress = api.listRelationshipProgress(owner, { userId: game.user.id });
    } catch (err) {
      CONFIG.logger?.warn?.(`Relationship Web: could not read ${owner.name}'s relationships`, err);
      continue;
    }
    const records = new Map(stored.map((record) => [record?.id, record]));
    for (const entry of Array.isArray(progress) ? progress : []) {
      if (!entry?.relationshipId || entry.entryType === "organization") continue;
      const record = records.get(entry.relationshipId) ?? {};
      if ((record.visibility || "players") !== "players" || record.locked) continue;
      if (!ownerIsPC && !targetsPC({ targetUuid: entry.targetUuid, customName: record.customName })) continue;
      shared.push({ ...entry, ownerActorUuid: owner.uuid });
    }
  }
  return shared;
}

/**
 * Every bond the user may see, as nodes and the links between them. A link joins one pair of nodes
 * and holds up to two bonds, one held by each side.
 * @param {User} [user]
 * @param {?object[]} [shared]  for a player, the player-character exception's bonds (sharedPlayerCharacterBonds, from the GM)
 * @returns {{nodes: Map<string, WebNode>, links: Map<string, {key: string, a: string, b: string, bonds: Map<string, WebBond>}>}}
 */
export function buildRelationshipWeb(user = game.user, shared = null) {
  const nodes = new Map();
  const links = new Map();
  const api = trackerApi();
  if (!api?.listRelationshipProgress || !user) return { nodes, links };

  // Under the player-character exception every player knows the player characters by name, and the
  // bonds the GM shared are added to each holder's own.
  const exception = !user.isGM && sharesPCBonds();
  const knows = (actor) => user.isGM || (exception && isPlayerCharacter(actor)) || !!actor.testUserPermission?.(user, "LIMITED");
  const sharedBy = new Map();
  for (const entry of exception && Array.isArray(shared) ? shared : []) {
    if (!entry?.ownerActorUuid || !entry.relationshipId) continue;
    if (!sharedBy.has(entry.ownerActorUuid)) sharedBy.set(entry.ownerActorUuid, []);
    sharedBy.get(entry.ownerActorUuid).push(entry);
  }
  const actorNode = (actor, record = {}) => {
    let node = nodes.get(actor.uuid);
    if (node) return node;
    const known = knows(actor);
    const fallbackImg = record.listImage || record.portrait || MYSTERY;
    node = {
      key: actor.uuid,
      name: known ? actor.name : String(record.customName || game.i18n.localize("SWFFG.RelationshipWeb.Unknown")),
      img: known && !isDefaultImage(actor.img) ? actor.img : fallbackImg,
      actorUuid: actor.uuid,
      kind: isPlayerCharacter(actor) ? "pc" : "npc",
      owner: false,
      archive: false,
      known,
    };
    nodes.set(node.key, node);
    return node;
  };

  // Gather first, resolve after: a name-only relationship may name an actor met later in the loop.
  const pending = [];
  for (const owner of game.actors) {
    const stored = owner.getFlag(TRACKER_ID, TRACKER_FLAG)?.relationships;
    if (!Array.isArray(stored) || !stored.length) continue;
    let progress;
    try {
      progress = api.listRelationshipProgress(owner, { userId: user.id });
    } catch (err) {
      CONFIG.logger?.warn?.(`Relationship Web: could not read ${owner.name}'s relationships`, err);
      continue;
    }
    const records = new Map(stored.map((record) => [record?.id, record]));
    const seen = new Set();
    for (const entry of Array.isArray(progress) ? progress : []) {
      if (!entry?.relationshipId || entry.entryType === "organization") continue;
      seen.add(entry.relationshipId);
      pending.push({ owner, entry, record: records.get(entry.relationshipId) ?? {}, own: true });
    }
    // The exception's bonds the tracker kept from this player.
    for (const entry of sharedBy.get(owner.uuid) ?? []) {
      if (seen.has(entry.relationshipId)) continue;
      pending.push({ owner, entry, record: records.get(entry.relationshipId) ?? {}, own: false });
    }
  }

  const byName = new Map();
  const actorByName = (name) => {
    const key = lowerName(name);
    if (!byName.has(key)) byName.set(key, game.actors.find((actor) => lowerName(actor.name) === key && knows(actor)) ?? null);
    return byName.get(key);
  };

  for (const { owner, entry, record, own } of pending) {
    let target = null;
    const targetActor = resolveActor(entry.targetUuid);
    if (targetActor) target = actorNode(targetActor, record);
    else {
      const name = String(record.customName ?? "").trim();
      if (!name) continue;
      const named = actorByName(name);
      if (named) target = actorNode(named, record);
      else {
        const key = `name:${lowerName(name)}`;
        target = nodes.get(key);
        if (!target) {
          target = { key, name, img: record.listImage || record.portrait || MYSTERY, actorUuid: null, kind: "custom", owner: false, archive: false, known: true };
          nodes.set(key, target);
        }
      }
    }
    const source = actorNode(owner);
    if (target.key === source.key) continue;
    source.owner = true;
    source.archive ||= own;

    const [a, b] = [source.key, target.key].sort();
    const key = `${a}|${b}`;
    let link = links.get(key);
    if (!link) {
      link = { key, a, b, bonds: new Map() };
      links.set(key, link);
    }
    const rank = Math.max(0, Math.trunc(Number(entry.rank)) || 0);
    const bond = {
      from: source.key,
      to: target.key,
      rank,
      maxRank: Math.max(1, Math.trunc(Number(entry.maxRank)) || 10),
      negative: !!entry.isNegative,
      role: String(record.customRole || record.categoryLabel || "").trim(),
    };
    // An actor with two records for the same target shows the stronger one.
    const existing = link.bonds.get(source.key);
    if (!existing || bond.rank > existing.rank) link.bonds.set(source.key, bond);
  }
  return { nodes, links };
}

/** Order a ring so that characters bonded to each other sit side by side. */
function chainOrder(ring, adjacency) {
  const left = new Set(ring);
  const degree = (key) => [...adjacency.get(key)].filter((other) => left.has(other)).length;
  const order = [];
  let current = [...left].sort((p, q) => degree(q) - degree(p))[0];
  while (current) {
    order.push(current);
    left.delete(current);
    const near = [...left].filter((other) => adjacency.get(current).has(other));
    current = (near.length ? near : [...left]).sort((p, q) => degree(q) - degree(p))[0];
  }
  return order;
}

/**
 * Angles on a ring as close to the preferred ones as a minimum spacing allows, in the given order.
 * Nodes are pushed apart in one sweep and the result turned back so the shifts balance out. When
 * the ring is too full for that, it is spread evenly, turned to keep the preferences as far as it can.
 */
function spreadAngles(preferred, minStep) {
  const n = preferred.length;
  const step = (2 * Math.PI) / n;
  if (n * minStep >= 2 * Math.PI - minStep) {
    const offset = circularMean(preferred.map((angle, index) => angle - index * step));
    return preferred.map((_, index) => offset + index * step);
  }
  const angles = [];
  preferred.forEach((angle, index) => angles.push(index ? Math.max(angle, angles[index - 1] + minStep) : angle));
  const shift = angles.reduce((sum, angle, index) => sum + angle - preferred[index], 0) / n;
  return angles.map((angle) => angle - shift);
}

/**
 * Place every node on rings around the focus.
 * @param {string[]} keys   every node, in display order
 * @param {number} aspect   the stage's width over its height; rings are stretched into ellipses to match
 * @returns {{positions: Map<string, {x: number, y: number}>, dist: Map<string, number>}}
 */
function layoutWeb(keys, links, focusKey, aspect = 1) {
  const adjacency = new Map(keys.map((key) => [key, new Set()]));
  for (const link of links.values()) {
    adjacency.get(link.a)?.add(link.b);
    adjacency.get(link.b)?.add(link.a);
  }

  const dist = new Map([[focusKey, 0]]);
  const queue = [focusKey];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const other of [...(adjacency.get(current) ?? [])].sort((p, q) => keys.indexOf(p) - keys.indexOf(q))) {
      if (dist.has(other)) continue;
      dist.set(other, dist.get(current) + 1);
      queue.push(other);
    }
  }

  const rings = [];
  for (const key of queue) (rings[dist.get(key)] ??= []).push(key);
  const positions = new Map([[focusKey, { x: 0, y: 0 }]]);
  const angles = new Map();
  let radius = 0;

  // `share` is how much of an even share of the circle each node is given at the least: a ring
  // leaning toward one side still opens out, rather than piling everything beyond a leaf in a column.
  const placeRing = (ring, preferred, { gap = RING_GAP, share = 0.75 } = {}) => {
    radius = Math.max(radius + gap, (ring.length * MIN_ARC) / (2 * Math.PI));
    spreadAngles(preferred, Math.max(MIN_ARC / radius, (share * 2 * Math.PI) / ring.length)).forEach((angle, index) => {
      angles.set(ring[index], angle);
      positions.set(ring[index], { x: radius * Math.cos(angle) * aspect, y: radius * Math.sin(angle) });
    });
  };

  for (let d = 1; d < rings.length; d++) {
    if (d === 1) {
      // The first ring is spread all the way round, starting at the top.
      const ring = chainOrder(rings[d], adjacency);
      placeRing(ring, ring.map((_, index) => -Math.PI / 2 + (index * 2 * Math.PI) / ring.length));
      continue;
    }
    // Further out, each character sits as near as it can to whoever brought it into the web.
    const preferred = new Map(rings[d].map((key) => [key, circularMean([...adjacency.get(key)].filter((other) => dist.get(other) === d - 1).map((other) => angles.get(other)))]));
    const ring = [...rings[d]].sort((p, q) => preferred.get(p) - preferred.get(q));
    placeRing(ring, ring.map((key) => preferred.get(key)), { gap: RING_GAP * 0.75 });
  }

  // Characters with no path to the centre gather at the bottom of an outer ring, each group together.
  const stray = keys.filter((key) => !dist.has(key));
  if (stray.length) placeRing(chainOrder(stray, adjacency), stray.map(() => Math.PI / 2), { gap: radius ? RING_GAP * 0.6 : RING_GAP, share: 0 });
  return { positions, dist };
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

export default class RelationshipWeb extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.focusKey = options.focusKey ?? null;
    this.web = { nodes: new Map(), links: new Map() };
    this._state = null;
    this._raf = null;
    this._dragMoved = 0;
  }

  /** The one window each client keeps. */
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "ffg-relationship-web",
    classes: ["starwarsffg", "ffg-relationship-web"],
    tag: "div",
    window: {
      title: "SWFFG.RelationshipWeb.Title",
      icon: "fa-solid fa-circle-nodes",
      resizable: true,
    },
    position: {
      width: 1040,
      height: 720,
    },
  };

  static get enabled() {
    try {
      return !!game.settings.get("starwarsffg", ENABLE_SETTING);
    } catch (err) {
      return true;
    }
  }

  /** Whether the tracker is there to read from. */
  static get available() {
    return !!game.modules.get(TRACKER_ID)?.active;
  }

  /**
   * Open the web, centred on an actor when one is given.
   * @param {?Actor|string} [actor]  an actor or its uuid
   */
  static open(actor = null) {
    if (!this.enabled) return null;
    if (!trackerApi()?.listRelationshipProgress) {
      ui.notifications.warn(game.i18n.localize("SWFFG.RelationshipWeb.NoTracker"));
      return null;
    }
    const focusKey = typeof actor === "string" ? actor : actor?.uuid ?? null;
    if (!this.instance) this.instance = new this({ focusKey });
    else if (focusKey) {
      this.instance.focusKey = focusKey;
      this.instance._state = null;
    }
    this.instance.render({ force: true });
    return this.instance;
  }

  static refresh() {
    if (this.instance?.rendered) this.instance.render();
  }

  /** Name of the query a player's web sends to the active GM for the player-character exception's bonds. */
  static SHARED_QUERY = "starwarsffg.relationshipWebShared";

  /**
   * The player-character exception's bonds, asked of the active GM (see sharedPlayerCharacterBonds).
   * @returns {Promise<?object[]>} null for a GM, with the exception off, or when no GM could answer
   */
  static async fetchShared() {
    if (game.user.isGM || !sharesPCBonds()) return null;
    const gm = game.users.activeGM;
    if (!gm) return null;
    try {
      const shared = await gm.query(this.SHARED_QUERY, {}, { timeout: 8000 });
      return Array.isArray(shared) ? shared : null;
    } catch (err) {
      CONFIG.logger?.warn?.("Relationship Web: the GM could not send the bonds involving player characters", err);
      return null;
    }
  }

  /** @override */
  async close(options) {
    cancelAnimationFrame(this._raf);
    RelationshipWeb.instance = null;
    return super.close(options);
  }

  /** Nodes in display order: player characters first, then by name. */
  get orderedKeys() {
    return [...this.web.nodes.values()]
      .sort((p, q) => (q.kind === "pc") - (p.kind === "pc") || p.name.localeCompare(q.name, game.i18n.lang))
      .map((node) => node.key);
  }

  /** Who to centre on when nothing (or someone no longer in the web) was asked for. */
  _defaultFocus(keys) {
    const candidates = [
      game.user.character?.uuid,
      ...(canvas?.tokens?.controlled ?? []).map((token) => token.actor?.uuid),
      keys.find((key) => this.web.nodes.get(key).kind === "pc"),
      keys[0],
    ];
    return candidates.find((key) => key && this.web.nodes.has(key)) ?? null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _renderHTML(_context, _options) {
    const shared = await RelationshipWeb.fetchShared();
    // A player under the exception whose GM could not be asked sees only what the tracker shows them.
    const needsGM = shared === null && !game.user.isGM && sharesPCBonds() ? `<p class="ffg-rw-needs-gm"><i class="fa-solid fa-triangle-exclamation"></i>${loc("SWFFG.RelationshipWeb.NeedsGM")}</p>` : "";
    this.web = buildRelationshipWeb(game.user, shared);
    const keys = this.orderedKeys;
    if (!this.web.nodes.has(this.focusKey)) {
      this.focusKey = this._defaultFocus(keys);
      this._state = null;
    }

    const root = document.createElement("div");
    root.className = "ffg-rw-body";
    if (!keys.length) {
      root.innerHTML = `<p class="ffg-rw-empty">${loc("SWFFG.RelationshipWeb.Empty")}</p>${needsGM}`;
      return root;
    }

    const options = keys
      .map((key) => {
        const node = this.web.nodes.get(key);
        return `<option value="${escapeHTML(key)}" ${key === this.focusKey ? "selected" : ""}>${escapeHTML(node.name)}</option>`;
      })
      .join("");
    const bondCount = [...this.web.links.values()].reduce((sum, link) => sum + link.bonds.size, 0);

    root.innerHTML = `
      <header class="ffg-rw-toolbar">
        <label class="ffg-rw-focus"><span>${loc("SWFFG.RelationshipWeb.Focus")}</span><select data-rw="focus">${options}</select></label>
        <span class="ffg-rw-count">${loc("SWFFG.RelationshipWeb.Counts", { nodes: keys.length, bonds: bondCount })}</span>
        ${needsGM}
        <button type="button" data-rw="reset" data-tooltip="${loc("SWFFG.RelationshipWeb.ResetView")}" aria-label="${loc("SWFFG.RelationshipWeb.ResetView")}"><i class="fa-solid fa-expand"></i></button>
      </header>
      <div class="ffg-rw-main">
        <div class="ffg-rw-stage">
          <svg class="ffg-rw-svg" xmlns="${SVG_NS}" preserveAspectRatio="xMidYMid meet">
            <defs><clipPath id="ffg-rw-clip" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"></circle></clipPath></defs>
            <g class="ffg-rw-view"><g class="ffg-rw-links"></g><g class="ffg-rw-nodes"></g><g class="ffg-rw-badges"></g><g class="ffg-rw-labels"></g></g>
          </svg>
          <div class="ffg-rw-legend">
            <span><i class="ffg-rw-swatch positive"></i>${loc("SWFFG.RelationshipWeb.Positive")}</span>
            <span><i class="ffg-rw-swatch negative"></i>${loc("SWFFG.RelationshipWeb.Negative")}</span>
            <span><i class="ffg-rw-swatch none"></i>${unreturnedLabel()}</span>
            <span><b class="ffg-rw-legend-badge">5</b>${loc("SWFFG.RelationshipWeb.RankLegend")}</span>
          </div>
          <p class="ffg-rw-hint">${loc("SWFFG.RelationshipWeb.Hint")}</p>
        </div>
        <aside class="ffg-rw-inspector"></aside>
      </div>`;
    return root;
  }

  /** @override */
  _replaceHTML(result, content, _options) {
    content.replaceChildren(result);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    this._svg = root.querySelector(".ffg-rw-svg");
    if (!this._svg || !this.focusKey) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
      this._els = null;
      this._state = this._target = null;
      return;
    }

    this._drawWeb();
    this._bindStage();
    root.querySelector('[data-rw="focus"]')?.addEventListener("change", (event) => this.setFocus(event.currentTarget.value));
    root.querySelector('[data-rw="reset"]')?.addEventListener("click", () => this._animateTo({ ...(this._target ?? this._state), view: { x: 0, y: 0, k: 1 } }));
    root.querySelector(".ffg-rw-inspector").addEventListener("click", (event) => this._onInspectorClick(event));

    // A re-render (new data) keeps the centre and the pan/zoom the user had.
    const view = this._state?.view ?? { x: 0, y: 0, k: 1 };
    this._state = null;
    this._animateTo({ ...this._targetState(), view }, true);
    this._renderInspector();
  }

  /** Create one element group per node and per link. Positions are applied by _paint. */
  _drawWeb() {
    const linkLayer = this._svg.querySelector(".ffg-rw-links");
    const nodeLayer = this._svg.querySelector(".ffg-rw-nodes");
    const badgeLayer = this._svg.querySelector(".ffg-rw-badges");
    const labelLayer = this._svg.querySelector(".ffg-rw-labels");
    this._els = { nodes: new Map(), links: new Map() };

    for (const link of this.web.links.values()) {
      const group = svg("g", { class: "ffg-rw-link" });
      const half = (side) => {
        const bond = link.bonds.get(side);
        const line = svg("line", { class: `ffg-rw-half ${bond ? (bond.negative ? "negative" : "positive") : "none"}` });
        if (bond) line.setAttribute("stroke-width", (2 + 5 * Math.min(1, bond.rank / bond.maxRank)).toFixed(2));
        group.append(line);
        return line;
      };
      const halfA = half(link.a);
      const halfB = half(link.b);
      const hit = svg("line", { class: "ffg-rw-hit" });
      hit.dataset.tooltip = this._linkTooltip(link);
      group.append(hit);
      linkLayer.append(group);

      const badge = (side) => {
        const bond = link.bonds.get(side);
        if (!bond) return null;
        const element = svg("g", { class: `ffg-rw-badge ${bond.negative ? "negative" : "positive"}` });
        element.append(svg("circle", { r: 11 }));
        const text = svg("text", { "text-anchor": "middle", "dominant-baseline": "central" });
        text.textContent = String(bond.rank);
        element.append(text);
        badgeLayer.append(element);
        return element;
      };
      const entry = { link, group, halfA, halfB, hit, badgeA: badge(link.a), badgeB: badge(link.b) };
      const hover = (on) => {
        group.classList.toggle("hover", on);
        entry.badgeA?.classList.toggle("hover", on);
        entry.badgeB?.classList.toggle("hover", on);
      };
      hit.addEventListener("pointerenter", () => hover(true));
      hit.addEventListener("pointerleave", () => hover(false));
      entry.hover = hover;
      this._els.links.set(link.key, entry);
    }

    for (const node of this.web.nodes.values()) {
      const group = svg("g", { class: `ffg-rw-node ${node.kind}` });
      group.dataset.key = node.key;
      group.append(svg("circle", { class: "ffg-rw-ring", r: NODE_RADIUS + 3 }));
      const image = svg("image", {
        href: node.img,
        x: -NODE_RADIUS,
        y: -NODE_RADIUS,
        width: NODE_RADIUS * 2,
        height: NODE_RADIUS * 2,
        "clip-path": "url(#ffg-rw-clip)",
        preserveAspectRatio: "xMidYMid slice",
      });
      image.addEventListener("error", () => image.setAttribute("href", MYSTERY), { once: true });
      group.append(image);
      // Names go in a layer of their own above the lines and badges, so nothing ever covers one.
      const label = svg("text", { class: "ffg-rw-label", "text-anchor": "middle" });
      label.textContent = node.name.length > LABEL_LENGTH ? `${node.name.slice(0, LABEL_LENGTH - 1)}…` : node.name;
      if (label.textContent !== node.name) group.dataset.tooltip = escapeHTML(node.name);
      labelLayer.append(label);

      const links = [...this._els.links.values()].filter((entry) => entry.link.a === node.key || entry.link.b === node.key);
      group.addEventListener("pointerenter", () => links.forEach((entry) => entry.hover(true)));
      group.addEventListener("pointerleave", () => links.forEach((entry) => entry.hover(false)));
      group.addEventListener("click", () => {
        if (this._dragMoved <= DRAG_THRESHOLD) this.setFocus(node.key);
      });
      group.addEventListener("dblclick", () => this._openArchive(node.key) || this._openSheet(node.key));
      nodeLayer.append(group);
      this._els.nodes.set(node.key, { node, group, label });
    }
  }

  _bondLine(bond) {
    const from = escapeHTML(this.web.nodes.get(bond.from)?.name);
    const to = escapeHTML(this.web.nodes.get(bond.to)?.name);
    const role = bond.role ? `${escapeHTML(bond.role)}, ` : "";
    const polarity = bond.negative ? ` (${loc("SWFFG.RelationshipWeb.Negative")})` : "";
    return `<strong>${from}</strong> → ${to}: ${role}${loc("SWFFG.RelationshipWeb.Rank", { rank: bond.rank })}${polarity}`;
  }

  _linkTooltip(link) {
    return [link.a, link.b]
      .map((side) => link.bonds.get(side))
      .filter(Boolean)
      .map((bond) => this._bondLine(bond))
      .join("<br>");
  }

  /* -------------------------------------------- */
  /*  Layout and painting                         */
  /* -------------------------------------------- */

  /** Where everything belongs with the current focus, at the default pan and zoom. */
  _targetState() {
    const keys = this.orderedKeys;
    const stage = this._svg?.getBoundingClientRect();
    const aspect = stage?.width && stage?.height ? Math.clamp(stage.width / stage.height, 1, 1.8) : 1.4;
    const { positions, dist } = layoutWeb(keys, this.web.links, this.focusKey, aspect);
    const scale = new Map(keys.map((key) => [key, key === this.focusKey ? FOCUS_SCALE : 1]));

    // Frame the nodes themselves (labels, and the legend, sit below the bottom row), never closer
    // than a small web needs.
    const xs = [...positions.values()].map((at) => at.x);
    const ys = [...positions.values()].map((at) => at.y);
    const pad = NODE_RADIUS * FOCUS_SCALE + PADDING;
    let box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 + LABEL_SPACE };
    const w = Math.max(box.w, MIN_BOX * aspect);
    const h = Math.max(box.h, MIN_BOX);
    box = { x: box.x - (w - box.w) / 2, y: box.y - (h - box.h) / 2, w, h };
    return { positions, scale, dist, view: { x: 0, y: 0, k: 1 }, box };
  }

  /** @override - a resized window re-fits the rings to its new shape. */
  _onPosition(position) {
    super._onPosition(position);
    if (!this._els || !this._state) return;
    const size = `${position.width}x${position.height}`;
    if (size === this._fittedSize) return;
    this._fittedSize = size;
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      if (this.rendered && this._els && this._state) this._animateTo({ ...this._targetState(), view: this._state.view }, true);
    }, 100);
  }

  setFocus(key) {
    if (!this.web.nodes.has(key)) return;
    this.focusKey = key;
    const select = this.element?.querySelector('[data-rw="focus"]');
    if (select) select.value = key;
    this._animateTo(this._targetState());
    this._renderInspector();
  }

  /** Move to a state, tweened unless told otherwise (or nothing would draw the frames). */
  _animateTo(target, instant = false) {
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._target = target;
    this._applyEmphasis(target);
    const from = this._state;
    if (instant || !from || document.hidden) {
      this._state = target;
      this._paint(target);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = ease(t);
      const mix = (a, b) => (a ? lerp(a, b, e) : b);
      const positions = new Map();
      for (const [key, to] of target.positions) {
        const was = from.positions.get(key);
        positions.set(key, was ? { x: lerp(was.x, to.x, e), y: lerp(was.y, to.y, e) } : to);
      }
      const scale = new Map([...target.scale].map(([key, to]) => [key, mix(from.scale.get(key), to)]));
      const view = { x: lerp(from.view.x, target.view.x, e), y: lerp(from.view.y, target.view.y, e), k: lerp(from.view.k, target.view.k, e) };
      const box = { x: lerp(from.box.x, target.box.x, e), y: lerp(from.box.y, target.box.y, e), w: lerp(from.box.w, target.box.w, e), h: lerp(from.box.h, target.box.h, e) };
      this._state = { ...target, positions, scale, view, box };
      this._paint(this._state);
      if (t < 1) this._raf = requestAnimationFrame(step);
      else {
        this._raf = null;
        this._state = target;
      }
    };
    this._raf = requestAnimationFrame(step);
  }

  /** Finish any tween at once, so a pan or zoom starts from where things are going. */
  _settle() {
    if (!this._raf || !this._target) return;
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._state = this._target;
    this._paint(this._state);
  }

  /** Opacity by distance from the focus, and which badges show. Set once per focus; CSS fades it. */
  _applyEmphasis(state) {
    const dist = (key) => state.dist.get(key) ?? Infinity;
    for (const { node, group, label } of this._els?.nodes.values() ?? []) {
      const d = dist(node.key);
      group.style.opacity = d <= 1 ? 1 : d === 2 ? 0.8 : d === 3 ? 0.62 : Number.isFinite(d) ? 0.5 : 0.32;
      label.style.opacity = group.style.opacity;
      group.classList.toggle("focus", node.key === this.focusKey);
    }
    for (const entry of this._els?.links.values() ?? []) {
      const { a, b } = entry.link;
      const touches = a === this.focusKey || b === this.focusKey;
      const far = Math.max(dist(a), dist(b));
      entry.group.style.opacity = touches ? 1 : far <= 1 ? 0.6 : Number.isFinite(far) ? 0.4 : 0.2;
      entry.badgeA?.classList.toggle("on", touches);
      entry.badgeB?.classList.toggle("on", touches);
    }
  }

  _paint(state) {
    if (!this._svg || !this._els) return;
    const { box, view } = state;
    this._svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
    this._svg.querySelector(".ffg-rw-view").setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);

    for (const [key, { group, label }] of this._els.nodes) {
      const at = state.positions.get(key);
      if (!at) continue;
      const scale = state.scale.get(key) ?? 1;
      group.setAttribute("transform", `translate(${at.x} ${at.y}) scale(${scale})`);
      label.setAttribute("transform", `translate(${at.x} ${at.y + NODE_RADIUS * scale + 18})`);
    }

    const place = (badge, from, ux, uy, length, radius) => {
      if (!badge) return;
      const distance = Math.min(Math.max(radius + BADGE_GAP, length * 0.33), Math.max(length / 2 - 12, 0));
      badge.setAttribute("transform", `translate(${from.x + ux * distance} ${from.y + uy * distance})`);
    };
    for (const entry of this._els.links.values()) {
      const pa = state.positions.get(entry.link.a);
      const pb = state.positions.get(entry.link.b);
      if (!pa || !pb) continue;
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const set = (line, p, q) => {
        line.setAttribute("x1", p.x);
        line.setAttribute("y1", p.y);
        line.setAttribute("x2", q.x);
        line.setAttribute("y2", q.y);
      };
      set(entry.halfA, pa, mid);
      set(entry.halfB, mid, pb);
      set(entry.hit, pa, pb);
      const length = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const ux = (pb.x - pa.x) / length;
      const uy = (pb.y - pa.y) / length;
      place(entry.badgeA, pa, ux, uy, length, NODE_RADIUS * (state.scale.get(entry.link.a) ?? 1));
      place(entry.badgeB, pb, -ux, -uy, length, NODE_RADIUS * (state.scale.get(entry.link.b) ?? 1));
    }
  }

  /* -------------------------------------------- */
  /*  Pan and zoom                                */
  /* -------------------------------------------- */

  /** A pointer position in viewBox units (outside the pan/zoom transform). */
  _toViewBox(event) {
    const matrix = this._svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  _bindStage() {
    const stage = this._svg;
    let drag = null;
    stage.addEventListener("pointerdown", (event) => {
      this._dragMoved = 0;
      if (event.button !== 0 || event.target.closest(".ffg-rw-node")) return;
      this._settle();
      drag = { start: this._toViewBox(event), view: { ...this._state.view }, client: { x: event.clientX, y: event.clientY } };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag) return;
      this._dragMoved = Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y);
      const at = this._toViewBox(event);
      this._state.view = { ...drag.view, x: drag.view.x + at.x - drag.start.x, y: drag.view.y + at.y - drag.start.y };
      this._target = this._state;
      this._paint(this._state);
    });
    const end = (event) => {
      if (!drag) return;
      drag = null;
      stage.classList.remove("panning");
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this._settle();
        const view = this._state.view;
        const k = Math.clamp(view.k * (event.deltaY > 0 ? 0.9 : 1 / 0.9), MIN_ZOOM, MAX_ZOOM);
        const at = this._toViewBox(event);
        this._state.view = { k, x: at.x - (at.x - view.x) * (k / view.k), y: at.y - (at.y - view.y) * (k / view.k) };
        this._target = this._state;
        this._paint(this._state);
      },
      { passive: false },
    );
  }

  /* -------------------------------------------- */
  /*  The inspector                               */
  /* -------------------------------------------- */

  _renderInspector() {
    const panel = this.element?.querySelector(".ffg-rw-inspector");
    const node = this.web.nodes.get(this.focusKey);
    if (!panel || !node) return;
    const links = [...this.web.links.values()].filter((link) => link.a === node.key || link.b === node.key);
    const held = links.map((link) => link.bonds.get(node.key)).filter(Boolean);
    const received = links.map((link) => link.bonds.get(link.a === node.key ? link.b : link.a)).filter(Boolean);
    const byRank = (p, q) => q.rank - p.rank || this.web.nodes.get(p.to).name.localeCompare(this.web.nodes.get(q.to).name, game.i18n.lang);
    held.sort(byRank);
    received.sort((p, q) => q.rank - p.rank || this.web.nodes.get(p.from).name.localeCompare(this.web.nodes.get(q.from).name, game.i18n.lang));

    const row = (bond, otherKey, returned) => {
      const other = this.web.nodes.get(otherKey);
      const unreturned = returned ? "" : `<span class="ffg-rw-unreturned">${unreturnedLabel()}</span>`;
      return `<li data-key="${escapeHTML(otherKey)}" class="${bond.negative ? "negative" : "positive"}">
        <img src="${escapeHTML(other.img)}" alt="">
        <span class="ffg-rw-row-text"><span class="ffg-rw-row-name">${escapeHTML(other.name)}</span><span class="ffg-rw-row-role">${escapeHTML(bond.role)}${unreturned}</span></span>
        <b class="ffg-rw-row-rank" data-tooltip="${loc("SWFFG.RelationshipWeb.Rank", { rank: bond.rank })}">${bond.rank}</b>
      </li>`;
    };
    const returnedBy = (bond) => this.web.links.get([bond.from, bond.to].sort().join("|"))?.bonds.has(bond.to);
    const list = (bonds, other) => (bonds.length ? `<ul>${bonds.map((bond) => row(bond, other(bond), returnedBy(bond))).join("")}</ul>` : `<p class="ffg-rw-none">${loc("SWFFG.RelationshipWeb.None")}</p>`);

    const kind = { pc: "PlayerCharacter", npc: "NonPlayerCharacter", custom: "NameOnly" }[node.kind];
    const actor = resolveActor(node.actorUuid);
    const canArchive = node.archive && !!trackerApi()?.open;
    const canSheet = !!actor?.testUserPermission?.(game.user, "LIMITED");
    panel.innerHTML = `
      <div class="ffg-rw-who">
        <img src="${escapeHTML(node.img)}" alt="">
        <div><h3>${escapeHTML(node.name)}</h3><span>${loc(`SWFFG.RelationshipWeb.${kind}`)}</span></div>
      </div>
      <div class="ffg-rw-actions">
        ${canArchive ? `<button type="button" data-rw="archive"><i class="fa-solid fa-book-open"></i>${loc("SWFFG.RelationshipWeb.OpenArchive")}</button>` : ""}
        ${canSheet ? `<button type="button" data-rw="sheet"><i class="fa-solid fa-user"></i>${loc("SWFFG.RelationshipWeb.OpenSheet")}</button>` : ""}
      </div>
      <h4>${loc("SWFFG.RelationshipWeb.TheirBonds", { name: node.name })}</h4>
      ${list(held, (bond) => bond.to)}
      <h4>${loc("SWFFG.RelationshipWeb.TowardThem", { name: node.name })}</h4>
      ${list(received, (bond) => bond.from)}`;
    panel.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => (img.src = MYSTERY), { once: true }));
  }

  _onInspectorClick(event) {
    const button = event.target.closest("button[data-rw]");
    if (button?.dataset.rw === "archive") return this._openArchive(this.focusKey);
    if (button?.dataset.rw === "sheet") return this._openSheet(this.focusKey);
    const row = event.target.closest("li[data-key]");
    if (row) this.setFocus(row.dataset.key);
  }

  /** Open the tracker's archive for a node. @returns {boolean} whether it could */
  _openArchive(key) {
    const node = this.web.nodes.get(key);
    const api = trackerApi();
    if (!node?.archive || !api?.open) return false;
    api.open(node.actorUuid);
    return true;
  }

  _openSheet(key) {
    const actor = resolveActor(this.web.nodes.get(key)?.actorUuid);
    if (!actor?.testUserPermission?.(game.user, "LIMITED")) return false;
    actor.sheet?.render(true);
    return true;
  }

  /* -------------------------------------------- */
  /*  Wiring                                      */
  /* -------------------------------------------- */

  /** The player-character exception's setting. Call during init, with the other table tools' settings. */
  static registerSettings() {
    game.settings.register("starwarsffg", SHARE_PC_SETTING, {
      name: game.i18n.localize("SWFFG.Settings.tools.relationshipWebSharePCBonds.Name"),
      hint: game.i18n.localize("SWFFG.Settings.tools.relationshipWebSharePCBonds.Hint"),
      scope: "world",
      config: false,
      default: true,
      type: Boolean,
      onChange: () => this.refresh(),
    });
  }

  /**
   * Live refresh, and the launch button in the tracker's own archive window. Call at `ready`.
   */
  static register() {
    if (!this.enabled || !this.available) return;
    if (CONFIG.queries) CONFIG.queries[this.SHARED_QUERY] = () => sharedPlayerCharacterBonds();
    const refresh = foundry.utils.debounce(() => this.refresh(), 250);
    Hooks.on(`${TRACKER_ID}.relationshipProgressChanged`, refresh);
    Hooks.on(`${TRACKER_ID}.relationshipDataChanged`, refresh);
    Hooks.on("updateActor", (actor, changes) => {
      if (!this.instance?.rendered) return;
      if (changes?.flags?.[TRACKER_ID] || "name" in (changes ?? {}) || "img" in (changes ?? {}) || "ownership" in (changes ?? {})) refresh();
    });
    for (const hook of ["createActor", "deleteActor"]) Hooks.on(hook, () => this.instance?.rendered && refresh());
    // A player's web asks a GM for the bonds involving player characters; one arriving can now answer.
    Hooks.on("userConnected", (user, connected) => {
      if (connected && user?.isGM && !game.user.isGM && this.instance?.rendered) refresh();
    });

    // The archive is a frameless full-screen window with a toolbar of its own per theme; every theme
    // has a close button, so the launcher is a copy of it (taking that theme's look) placed beside it.
    // The archive sits above every window, so the launcher swaps one for the other: it closes the
    // archive and opens the web on the same character (whose Open Archive swaps back).
    Hooks.on("renderRelationshipTrackerApp", (app, element) => {
      const root = element instanceof HTMLElement ? element : element?.[0] ?? app.element;
      const close = root?.querySelector?.('[data-action="closeApp"]');
      if (!close || close.parentElement.querySelector(".ffg-rw-launch")) return;
      const button = close.cloneNode(true);
      button.removeAttribute("data-action");
      button.classList.remove(...[...button.classList].filter((name) => name.includes("close")));
      button.classList.add("ffg-rw-launch");
      const title = game.i18n.localize("SWFFG.RelationshipWeb.Title");
      button.setAttribute("title", title);
      button.setAttribute("aria-label", title);
      button.innerHTML = '<i class="fa-solid fa-circle-nodes"></i>';
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const shown = game.actors.find((actor) => app.isShowingActor?.(actor.uuid));
        app.close();
        this.open(shown ?? null);
      });
      close.before(button);
    });
  }
}
