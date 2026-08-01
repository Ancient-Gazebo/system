import { GroupManager } from "./groupmanager-ffg.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The floating Destiny Tracker chrome widget: shows the light/dark destiny
 * pool, lets users flip points, and (for the GM) exposes the group-manager
 * menu. A native ApplicationV2 -- not a form. It is draggable by its body and
 * remembers its position per-user, and never closes via the UI.
 *
 * Rendered exactly once at ready (`dTracker.render(true)` in swffg-main); the
 * pool display is updated in place by the dPool settings' onChange (which
 * rewrites #destinyLight/#destinyDark directly), not by re-rendering -- so the
 * one-time _onRender binding of socket / chat hooks below does not accumulate.
 * @extends {ApplicationV2}
 */
export default class DestinyTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(object = {}, options = {}) {
    super(options);
    this.object = object;
    this.destinyQueue = [];
    this.isRunningQueue = false;
    if (options?.menu) {
      this.menu = options.menu;
    }
  }

  static DEFAULT_OPTIONS = {
    id: "destiny-tracker",
    classes: ["starwarsffg"],
    tag: "div",
    window: {
      title: "Destiny Tracker",
    },
  };

  static PARTS = {
    content: {
      root: true,
      template: "systems/starwarsffg/templates/ffg-destiny-tracker.html",
    },
  };

  /**
   * Persistent chrome: the window header is hidden and the widget is never torn
   * down during a session, so close is a no-op to keep stray calls from
   * removing it. (Natively there is no 300x200 minimum to override anymore --
   * the frame shrinks to the widget; CSS provides the 10px gap.)
   * @override
   */
  async close(_options = {}) {
    return this;
  }

  /** @override */
  async _prepareContext(_options) {
    // Get current value
    let destinyPool = { light: game.settings.get("starwarsffg", "dPoolLight"), dark: game.settings.get("starwarsffg", "dPoolDark") };
    let destinyPoolLabel = { light: game.settings.get("starwarsffg", "destiny-pool-light"), dark: game.settings.get("starwarsffg", "destiny-pool-dark") };

    // filter menu based on role.
    const menu = this.menu.filter((m) => game.user.hasRole(m.minimumRole) || !m.minimumRole);

    // Return data
    return {
      destinyPool,
      destinyPoolLabel,
      isGM: game.user.isGM,
      menu,
      theme: game.settings.get("starwarsffg", "dicetheme"),
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Restore this user's saved widget position, or default to the lower-left
    // corner (above the players list). The old `innerWidth - screen.width`
    // formula produced a negative left on any window narrower than the screen,
    // rendering the widget off-screen. Clamp so at least a corner stays visible
    // if the window shrank since the position was saved.
    const vw = $(window).width() || 0;
    const vh = $(window).height() || 0;
    const saved = game.settings.get("starwarsffg", "destinyTrackerPosition");
    let left = 10;
    let top = vh - 300;
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      left = saved.left;
      top = saved.top;
    }
    this.setPosition({
      left: Math.min(Math.max(0, left), Math.max(0, vw - 50)),
      top: Math.min(Math.max(0, top), Math.max(0, vh - 50)),
    });

    this._activateListeners($(this.element));
  }

  _activateListeners(html) {
    // Make the widget draggable by its body and remember the position per-user.
    this._setupDragging(html);

    // future functionality to allow multiple menu items to be passed in

    $.expr.filters.offscreen = function (el) {
      var rect = el.getBoundingClientRect();
      return rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.y + rect.height > window.innerHeight || rect.x + rect.width > window.innerWidth || rect.x > window.innerWidth || rect.y > window.innerHeight;
    };

    html.find(".dropbtn").click((event) => {
      const id = `#${$(event.currentTarget).attr("id")}Content`;
      $(html.find(id)).toggleClass("show");

      if ($(".dropdown-content").is(":offscreen")) {
        $(html.find(id)).addClass("vertical");
      } else {
        $(html.find(id)).removeClass("vertical");
      }
    });

    html.find(".dropdown-content a").click((event) => {
      event.preventDefault();
      event.stopPropagation();

      const index = event.currentTarget.dataset.value;
      this.menu[index].callback();
    });

    html.find(".destiny-points").click(async (event) => {
      // Ignore the click that fires at the end of a drag (see _setupDragging).
      if (this._suppressFlip) { this._suppressFlip = false; return; }
      const pointType = event.currentTarget.dataset.group;
      var typeName = null;
      const add = event.shiftKey;
      const remove = event.ctrlKey || event.metaKey;
      var flipType = null;
      var actionType = null;
      if (pointType == "dPoolLight") {
        flipType = "dPoolDark";
        typeName = game.i18n.localize(game.settings.get("starwarsffg", "destiny-pool-light"));
      } else {
        flipType = "dPoolLight";
        typeName = game.i18n.localize(game.settings.get("starwarsffg", "destiny-pool-dark"));
      }
      var messageText;

      if (!add && !remove) {
        if (game.settings.get("starwarsffg", pointType) == 0) {
          ui.notifications.warn(`Cannot flip a ${typeName} point; 0 remaining.`);
          return;
        } else {
          let pool = { light: 0, dark: 0 };
          if (flipType == "dPoolLight") {
            pool.light = game.settings.get("starwarsffg", flipType) + 1;
            pool.dark = game.settings.get("starwarsffg", pointType) - 1;
          } else if (flipType == "dPoolDark") {
            pool.dark = game.settings.get("starwarsffg", flipType) + 1;
            pool.light = game.settings.get("starwarsffg", pointType) - 1;
          }

          if (game.user.isGM) {
            game.settings.set("starwarsffg", "dPoolLight", pool.light);
            game.settings.set("starwarsffg", "dPoolDark", pool.dark);
          } else {
            await game.socket.emit("system.starwarsffg", { pool });
          }

          messageText = `<div class="destiny-flip ${flipType}">
          <div class="destiny-title">${game.i18n.localize("SWFFG.DestinyFlipMessage")}: <span class="${typeName}">${typeName}</span></div>
          <div class="destiny-left ${flipType !== "dPoolDark"} dark">${game.i18n.localize(game.settings.get("starwarsffg", "destiny-pool-dark"))} ${game.i18n.localize("SWFFG.DestinyFlipRemaining")}: ${pool.dark}</div>
          <div class="destiny-left ${flipType !== "dPoolLight"} light">${game.i18n.localize(game.settings.get("starwarsffg", "destiny-pool-light"))} ${game.i18n.localize("SWFFG.DestinyFlipRemaining")}: ${pool.light}</div>
          </div>`;
        }
      } else if (add) {
        if (!game.user.isGM) {
          ui.notifications.warn("Only GMs can add or remove points from the Destiny Pool.");
          return;
        }
        const setting = game.settings.settings.get(`starwarsffg.${pointType}`);
        game.settings.set("starwarsffg", pointType, game.settings.get("starwarsffg", pointType) + 1);
        messageText = "Added a " + typeName + " point.";
      } else if (remove) {
        if (!game.user.isGM) {
          ui.notifications.warn("Only GMs can add or remove points from the Destiny Pool.");
          return;
        }
        const setting = game.settings.settings.get(`starwarsffg.${pointType}`);
        game.settings.set("starwarsffg", pointType, game.settings.get("starwarsffg", pointType) - 1);
        messageText = "Removed a " + typeName + " point.";
      }

      ChatMessage.create({
        user: game.user.id,
        content: messageText,
      });
    });

    // handle previously created roll destiny chat messages
    $(".ffg-destiny-roll").on("click", this.OnClickRollDestiny.bind(this));

    // setup chat hook for destiny roll
    Hooks.on("renderChatMessageHTML", (...args) => {
      const html = args[1];
      $(html).on("click", ".ffg-destiny-roll", this.OnClickRollDestiny.bind(this));
    });

    // setup socket handler for checking destiny roll
    game.socket.on("system.starwarsffg", async (...args) => {
      if (args[0]?.canIRollDestinyResponse === game.user.id && !game.user.isGM) {
        if (!args[0]?.rolled) {
          const roll = await this._rollDestiny();
          await game.socket.emit("system.starwarsffg", { destiny: game.user.id, light: roll.ffg.light, dark: roll.ffg.dark });
        } else {
          ui.notifications.error(`${game.i18n.localize("SWFFG.DestinyAlreadyRolled")}`);
        }
      }
    });

    if (game.user.isGM) {
      // socket handler for GM
      game.socket.on("system.starwarsffg", async (...args) => {
        // check if this is the GM intended to answer the question or not
        if (game.user.id !== game.users.activeGM?.id) {
          // limit rolling to a single GM
          return;
        }
        // Can user roll destiny? Or have they already rolled
        if (args[0]?.canIRollDestiny) {
          let rolled = false;

          try {
            rolled = await game.settings.get("starwarsffg", `destinyrollers${args[0]?.canIRollDestiny}`);
          } catch (err) {
            game.settings.register("starwarsffg", `destinyrollers${args[0].canIRollDestiny}`, {
              name: "DestinyRoll",
              scope: "client",
              default: false,
              config: false,
              type: Boolean,
            });
          }

          await game.socket.emit("system.starwarsffg", { canIRollDestinyResponse: args[0]?.canIRollDestiny, rolled });
        }

        // Handle user initiated destiny pool flips
        if (args[0]?.pool) {
          const light = await game.settings.get("starwarsffg", "dPoolLight");
          const dark = await game.settings.get("starwarsffg", "dPoolDark");

          const request = {
            id: "player",
            type: "destiny-flip",
            light: +light - +args[0].pool.light,
            dark: +dark - +args[0].pool.dark,
          };

          // only allow one player flip at a time.
          if (!this.destinyQueue.find((q) => q.id === args[0].destiny)) {
            this.destinyQueue.push(request);
          }
        }

        // Handle user report for initial Destiny roll
        if (args[0]?.destiny) {
          const request = {
            id: args[0].destiny,
            type: "destiny-roll",
            light: args[0].light,
            dark: args[0].dark,
          };

          // make sure only one player destiny roll is queued.
          if (!this.destinyQueue.find((q) => q.id === args[0].destiny) && CONFIG.FFG.DestinyGM === game.user.id) {
            this.destinyQueue.push(request);
          }
        }

        if (!this.isRunningQueue) {
          this._processDestinyRequests();
        }
      });
    }
  }

  /**
   * Make the floating widget draggable by its body and persist the position
   * per-user. The window header is hidden (this is a chrome widget), so V2's
   * built-in header drag is unavailable. A custom pointer-drag is used so it can
   * coexist with the flip-on-click handlers on the destiny points: a click flips
   * a point, a drag (movement past a small threshold) moves the widget.
   * @param {JQuery} html
   */
  _setupDragging(html) {
    const root = this.element;
    const handle = html.find(".swffg-destiny")[0];
    if (!root || !handle) return;
    // The widget body is pointer-events:none by default (so clicks fall through
    // to the canvas); enable it on the drag handle so it can be grabbed.
    handle.style.pointerEvents = "auto";
    handle.style.cursor = "move";

    let active = false;
    let moved = false;
    let sx = 0, sy = 0, startLeft = 0, startTop = 0;

    const onDown = (event) => {
      if (event.button !== 0) return;
      active = true;
      moved = false;
      sx = event.clientX;
      sy = event.clientY;
      const r = root.getBoundingClientRect();
      startLeft = r.left;
      startTop = r.top;
      // Do NOT setPointerCapture here. Capturing on pointerdown retargets the
      // matching pointerup to this handle and suppresses the synthesized `click`
      // on the actual child that was pressed -- so clicks on .destiny-points (the
      // pool flip) and the group-manager menu links (.dropdown-content a) never
      // fire their handlers. Capture is acquired lazily in onMove, only once an
      // actual drag is detected, so a plain click is never swallowed.
    };

    const onMove = (event) => {
      if (!active) return;
      const dx = event.clientX - sx;
      const dy = event.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        moved = true;
        // This is now a real drag: capture the pointer so movement keeps tracking
        // even if it leaves the handle. (A plain click never reaches here, so its
        // `click` event is left intact -- see onDown.)
        try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      }
      if (!moved) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const left = Math.min(Math.max(0, startLeft + dx), Math.max(0, vw - w));
      const top = Math.min(Math.max(0, startTop + dy), Math.max(0, vh - h));
      this.setPosition({ left, top });
    };

    const onUp = (event) => {
      if (!active) return;
      active = false;
      try { handle.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      if (moved) {
        // A click is synthesized at the end of a drag; suppress the next flip so
        // dragging across a destiny point does not also flip it. Auto-clear in
        // case the browser does not emit that click (large drags often do not).
        this._suppressFlip = true;
        setTimeout(() => { this._suppressFlip = false; }, 0);
        game.settings.set("starwarsffg", "destinyTrackerPosition", {
          left: this.position.left,
          top: this.position.top,
        });
      }
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  // Click event for Roll Destiny Chat Message
  async OnClickRollDestiny(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) {
      await game.socket.emit("system.starwarsffg", { canIRollDestiny: game.user.id });
    }

    if (game.user.isGM) {
      const roll = await this._rollDestiny();

      const light = await game.settings.get("starwarsffg", "dPoolLight");
      const dark = await game.settings.get("starwarsffg", "dPoolDark");

      await game.settings.set("starwarsffg", "dPoolLight", light + roll.ffg.light);
      await game.settings.set("starwarsffg", "dPoolDark", dark + roll.ffg.dark);
    }
  }

  async _processDestinyRequests() {
    CONFIG.logger.debug(`Processing ${this.destinyQueue.length} Destiny Requests`);

    while (this.destinyQueue.length > 0) {
      const request = this.destinyQueue.shift();
      CONFIG.logger.debug(`Processing Destiny Request (${request.type}) from User ${request.id}`, request);

      const light = await game.settings.get("starwarsffg", "dPoolLight");
      const dark = await game.settings.get("starwarsffg", "dPoolDark");

      switch (request.type) {
        case "destiny-roll": {
          game.settings.set("starwarsffg", `destinyrollers${request.id}`, true);
          await game.settings.set("starwarsffg", "dPoolLight", light + request.light);
          await game.settings.set("starwarsffg", "dPoolDark", dark + request.dark);
          break;
        }
        case "destiny-flip": {
          await game.settings.set("starwarsffg", "dPoolLight", light - request.light);
          game.settings.set("starwarsffg", "dPoolDark", dark - request.dark);
          break;
        }
      }
    }

    CONFIG.logger.debug(`Done Processing Destiny Requests`);
    this.isRunningQueue = false;
  }

  async _rollDestiny() {
    const pool = new DicePoolFFG({
      force: 1,
    });

    const roll = new game.ffg.RollFFG(pool.renderDiceExpression());
    await roll.toMessage({
      user: game.user.id,
      flavor: `${game.i18n.localize("SWFFG.Rolling")} ${game.i18n.localize("SWFFG.DestinyPool")}...`,
    });

    return roll;
  }
}
