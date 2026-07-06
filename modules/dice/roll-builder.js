import { MonteCarlo } from "../../lib/@swrpg-online/monte-carlo/dist/index.esm.js";
import { getAdversaryLevel } from "../helpers/token.js";
import { DicePoolFFG } from "./pool.js";

export default class RollBuilderFFG extends FormApplication {
  constructor(rollData, rollDicePool, rollDescription, rollSkillName, rollItem, rollAdditionalFlavor, rollSound) {
    super();
    this.roll = {
      data: rollData,
      skillName: rollSkillName,
      item: rollItem,
      sound: rollSound,
      flavor: rollAdditionalFlavor,
    };
    this.dicePool = rollDicePool;
    this.description = rollDescription;
    this.adversaryRanks = RollBuilderFFG._computeAdversaryRanks();
    // Which pool the dialog shows/rolls when an Adversary is targeted. Defaults
    // to the Adversary pool so the upgrade is applied by default. Only takes
    // effect while adversaryRanks > 0.
    this._adversaryMode = true;
  }

  /**
   * Snapshot the max Adversary rank sum across the user's targeted tokens.
   * Rank counting is shared with the token badge (helpers/token.js
   * getAdversaryLevel). Returns 0 if the feature is disabled, or there are no
   * targets, no actors, or no Adversary items.
   */
  static _computeAdversaryRanks() {
    try {
      // When the GM disables the feature, report 0 ranks. This single gate hides
      // the Adversary controls (_refreshAdversary keys visibility off ranks > 0)
      // and skips the difficulty upgrade at roll time.
      if (!game.settings.get("starwarsffg", "enableAdversaryCalc")) return 0;
      const targets = Array.from(game.user?.targets ?? []);
      if (!targets.length) return 0;
      let max = 0;
      for (const token of targets) {
        const ranks = getAdversaryLevel(token?.actor);
        if (ranks > max) max = ranks;
      }
      return max;
    } catch (err) {
      CONFIG.logger?.debug?.("Adversary rank detection failed", err);
      return 0;
    }
  }

  /** System-socket event used to forward adversary-roll diagnostics to the GM. */
  static LOG_EVENT = "ffgAdversaryRollLog";

  /** A compact, loggable dice breakdown of a pool. */
  static _poolSummary(pool) {
    return {
      proficiency: pool.proficiency,
      ability:     pool.ability,
      boost:       pool.boost,
      challenge:   pool.challenge,
      difficulty:  pool.difficulty,
      setback:     pool.setback,
      force:       pool.force,
      expression:  pool.renderDiceExpression(),
    };
  }

  /**
   * Log an adversary roll's pool data locally and forward it to the GM machine.
   * `game.socket.emit` does not echo back to the sender, so the rolling client
   * logs locally here while the active GM logs the forwarded copy in
   * {@link registerRollLogBridge}.
   */
  static _logRoll(payload) {
    CONFIG.logger?.log?.("Client -> GM Server | Dice Roll", payload);
    game.socket.emit("system.starwarsffg", { event: RollBuilderFFG.LOG_EVENT, payload });
  }

  /**
   * GM-side listener that logs adversary-roll diagnostics forwarded by players.
   * Safe to call on every client; only GMs act on it. Call once at "ready".
   */
  static registerRollLogBridge() {
    game.socket.on("system.starwarsffg", (data) => {
      if (data?.event !== RollBuilderFFG.LOG_EVENT) return;
      if (!game.user.isGM) return;
      CONFIG.logger?.log?.("Client -> GM Server | Dice Roll", data.payload);
    });
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "roll-builder",
      classes: ["starwarsffg", "roll-builder-dialog"],
      template: "systems/starwarsffg/templates/dice/roll-options-ffg.html",
      width: 350
    });
  }

  /** @override */
  get title() {
    return this.description || game.i18n.localize("SWFFG.RollingDefaultTitle");
  }

  /** @override */
  async getData() {
    //get all possible sounds
    let sounds = [];
    const diceSymbols = {
      advantage: await foundry.applications.ux.TextEditor.enrichHTML("[AD]"),
      success: await foundry.applications.ux.TextEditor.enrichHTML("[SU]"),
      threat: await foundry.applications.ux.TextEditor.enrichHTML("[TH]"),
      failure: await foundry.applications.ux.TextEditor.enrichHTML("[FA]"),
      upgrade: await foundry.applications.ux.TextEditor.enrichHTML("[PR]"),
      triumph: await foundry.applications.ux.TextEditor.enrichHTML("[TR]"),
      despair: await foundry.applications.ux.TextEditor.enrichHTML("[DE]"),
      light: await foundry.applications.ux.TextEditor.enrichHTML("[LI]"),
      dark: await foundry.applications.ux.TextEditor.enrichHTML("[DA]"),
    };

    let canUserAddAudio = await game.settings.get("starwarsffg", "allowUsersAddRollAudio");
    let canUserAddFlavor = game.user.isGM || !this?.roll?.flavor;

    if (game.user.isGM) {
      game.playlists.contents.forEach((playlist) => {
        playlist.sounds.forEach((sound) => {
          let selected = false;
          const s = this.roll?.sound ?? this.roll?.item?.flags?.starwarsffg?.ffgsound;
          if (s === sound.path) {
            selected = true;
          }
          sounds.push({ name: sound.name, path: sound.path, selected });
        });
      });
    } else if (canUserAddAudio) {
      const playlistId = await game.settings.get("starwarsffg", "allowUsersAddRollAudioPlaylist");
      const playlist = await game.playlists.get(playlistId);

      if (playlist) {
        playlist.sounds.forEach((sound) => {
          let selected = false;
          const s = this.roll?.sound ?? this.roll?.item?.flags?.starwarsffg?.ffgsound;
          if (s === sound.path) {
            selected = true;
          }
          sounds.push({ name: sound.name, path: sound.path, selected });
        });
      } else {
        CONFIG.logger.warn(`Playlist for players does not exist, disabling audio`);
        canUserAddAudio = false;
      }
    }

    let users = [{ name: "Send To All", id: "all" }];
    if (game.user.isGM) {
      game.users.contents.forEach((user) => {
        if (user.visible && user.id !== game.user.id) {
          users.push({ name: user.name, id: user.id });
        }
      });
    }

    const enableForceDie = game.settings.get("starwarsffg", "enableForceDie");
    const labels = {
      light: game.settings.get("starwarsffg", "destiny-pool-light"),
      dark: game.settings.get("starwarsffg", "destiny-pool-dark"),
    };

    let display = false;
    const displaySimulation = game.settings.get("starwarsffg", "displaySimulation");
    if (displaySimulation === "GM" && game.user.isGM || displaySimulation === "All") {
      display = true;
    }

    return {
      sounds,
      isGM: game.user.isGM,
      canUserAddAudio,
      flavor: this.roll.flavor,
      users,
      enableForceDie,
      labels,
      diceSymbols,
      simDisplay: display,
      simCount: game.settings.get("starwarsffg", "rollSimulation"),
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    this._initializeInputs(html);
    this._activateInputs(html);

    html.find(".adversary-mode-btn").on("click", (event) => {
      event.preventDefault();
      this._adversaryMode = event.currentTarget.dataset.mode === "adversary";
      this._syncAdversaryButtons(html);
      this._updatePreview(html);
    });

    this._refreshAdversary(html);
    this._adversaryHookId = Hooks.on("targetToken", (user) => {
      if (user?.id !== game.user.id) return;
      this._refreshAdversary(html);
    });

    html.find(".btn").click(async (event) => {
      // Snapshot the pool to roll NOW, synchronously, before any of the awaits
      // below. In Adversary mode this returns a clone of the base pool upgraded by
      // the targeted Adversary's ranks; in Base mode it returns this.dicePool as-is.
      // `this.adversaryRanks` is recomputed from the LIVE game.user.targets by the
      // `targetToken` hook (see above), so capturing the resolved pool here --
      // rather than reading ranks after the awaits (status-effect cleanup, ammo/item
      // updates) -- keeps the executed roll consistent with the on-screen preview.
      const rollPool = this._effectivePool();
      // Forward roll diagnostics to the GM machine (and log locally) so the table
      // can audit what each player's client computed -- on every roll. The
      // adversary pool is only meaningful when an Adversary is targeted (ranks > 0).
      let adversaryPool = null;
      if (this.adversaryRanks > 0) {
        const adversaryClone = this._clonePool();
        if (this.dicePool.difficulty > 0) adversaryClone.upgradeDifficulty(this.adversaryRanks);
        adversaryPool = RollBuilderFFG._poolSummary(adversaryClone);
      }
      RollBuilderFFG._logRoll({
        user: game.user.name,
        actor: this.roll.data?.token?.name ?? this.roll.data?.actor?.name ?? null,
        skill: this.roll.skillName ?? null,
        selected: this.adversaryRanks > 0 && this._adversaryMode ? "adversary" : "base",
        adversaryRanks: this.adversaryRanks,
        basePool: RollBuilderFFG._poolSummary(this.dicePool),
        adversaryPool,
      });
      // if sound was not passed search for sound dropdown value
      if (!this.roll.sound) {
        const sound = html.find(".sound-selection")?.[0]?.value;
        if (sound) {
          this.roll.sound = sound;
          // Only save sound to real item documents (synthetic skill items have no id)
          if (this?.roll?.item?.id) {
            let entity;
            let entityData;
            if (!this?.roll?.item?.flags?.starwarsffg?.uuid) {
              entity = game.actors.get(this.roll.data.actor._id);
              entityData = {
                _id: this.roll.item.id,
              };
            } else {
              const parts = this.roll.item.flags.starwarsffg?.uuid.split(".");
              const [sceneName, sceneId, entityName, entityId, embeddedName, embeddedId] = parts;
              entity = game.actors.tokens[entityId].items.get(embeddedId);
              if (parts.length === 6) {
                entityData = {
                  _id: entity.id,
                };
              }
            }
            setProperty(entityData, "flags.starwarsffg.ffgsound", sound);
            entity.update(entityData);
          }
        }
      }

      if (!this.roll.flavor) {
        const flavor = html.find(".flavor-text")?.[0]?.value;
        if (flavor) {
          this.roll.flavor = flavor;
        }
      }

      // validate that required data is present
      if (this.roll.item?.uuid && !this.roll.item.flags?.starwarsffg?.uuid) {
        // uuid flag is missing, look up the item and set it, so it's fixed going forward
        const tmp_item = await fromUuid(this.roll.item.uuid);
        await tmp_item.setFlag("starwarsffg", "uuid", this.roll.item.uuid);
      }


      try {
        // remove one-time status effects
        CONFIG.logger.debug("Removing one-time status effects from actor");
        const actorData = this.roll.data.document;
        if (actorData) {
          if (actorData) {
            const actorEffects = actorData.getEmbeddedCollection("ActiveEffect");
            if (actorEffects) {
              const toDelete = [];
              for (const activeEffect of actorEffects.contents) {
                if (activeEffect?.system?.duration === "once") {
                  toDelete.push(activeEffect._id);
                }
              }
              if (toDelete.length > 0) {
                await actorData.deleteEmbeddedDocuments("ActiveEffect", toDelete);
              }
            }
          }
        }
      } catch (error) {
        CONFIG.logger.warn(`Caught error in roller: ${error}`);
      }

      try {
        if (this?.roll?.item && this.roll.item.type === "weapon") {
          const item = await foundry.utils.fromUuid(this.roll.item.uuid);
          if (item) {
            const ammoEnabled = item.getFlag("starwarsffg", "config.enableAmmo");
            if (ammoEnabled) {
              await item.update({"system.ammo.value": item.system.ammo.value - 1});
            }
          }
        }
      } catch (error) {
        CONFIG.logger.warn(`Caught ammo error in roller: ${error}`);
      }

      const sentToPlayer = html.find(".user-selection")?.[0]?.value;
      if (sentToPlayer) {
        let container = $(`<div class='dice-pool'></div>`)[0];
        rollPool.renderAdvancedPreview(container);

        const messageText = `<div>
          <div>${game.i18n.localize("SWFFG.SentDicePoolRollHint")}</div>
          ${$(container).html()}
          <button class="ffg-pool-to-player">${game.i18n.localize("SWFFG.SentDicePoolRoll")}</button>
        </div>`;

        let chatOptions = {
          user: game.user.id,
          content: messageText,
          flags: {
            starwarsffg: {
              roll: this.roll,
              dicePool: rollPool,
              description: this.description,
            },
          },
        };

        if (sentToPlayer !== "all") {
          chatOptions.whisper = [sentToPlayer];
        }

        ChatMessage.create(chatOptions);
      } else {
        if (this.roll.crew) {
          this.roll.item['crew'] = this.roll.crew
        }
        // Roll the pool snapshotted at click time (above) so the executed roll
        // matches the on-screen preview even if targeting changed during the awaits.
        const roll = new game.ffg.RollFFG(rollPool.renderDiceExpression(), this.roll.item, rollPool, this.roll.flavor);
        // check if this is a crew roll - and it's a roll for a weapon
        if (this.roll.item && this.roll.item.hasOwnProperty('crew') && Object.keys(this.roll.item).length > 1) {
          await this.roll.item.update({"flags": {"starwarsffg": {"crew": this.roll.item.crew}}})
        }
        await roll.toMessage({
          user: game.user.id,
          speaker: {
            actor: game.actors.get(this.roll.data?.actor?._id),
            alias: this.roll.data?.token?.name,
            token: this.roll.data?.token?._id,
          },
          flavor: `${game.i18n.localize("SWFFG.Rolling")} ${game.i18n.localize(this.roll.skillName)}...`,
        });
        if (this.roll?.sound) {
          AudioHelper.play({ src: this.roll.sound }, true);
        }

        return roll;
      }
    });

    html.find(".extend-button").on("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      $(event.currentTarget).toggleClass("minimize");

      const selector = $(event.currentTarget).next();
      $(selector).toggleClass("hide");
      $(selector).toggleClass("maximize");

      if (!$(event.currentTarget).hasClass("minimize")) {
        $(selector).val("");
      }
    });
  }

  _updatePreview(html) {
    const poolDiv = html.find(".dice-pool-dialog .dice-pool")[0];
    poolDiv.innerHTML = "";
    const pool = this._effectivePool();
    pool.renderPreview(poolDiv);
    this._updateSimulationPreview(pool);
  }

  _refreshAdversary(html) {
    this.adversaryRanks = RollBuilderFFG._computeAdversaryRanks();
    // Show the Base/Adversary toggle only while an Adversary is targeted (ranks > 0).
    const toggle = html.find(".adversary-pool-toggle")[0];
    if (toggle) toggle.style.display = this.adversaryRanks > 0 ? "" : "none";
    const label = html.find(".adversary-pool-label")[0];
    if (label) label.textContent = game.i18n.format("SWFFG.Adversary.AdversaryPool", { ranks: this.adversaryRanks });
    this._syncAdversaryButtons(html);
    this._updatePreview(html);
  }

  /** Highlight the active Base/Adversary pool button and label the Roll button. */
  _syncAdversaryButtons(html) {
    const adversaryAvailable = this.adversaryRanks > 0;
    const mode = adversaryAvailable && this._adversaryMode ? "adversary" : "base";
    html.find(".adversary-mode-btn").each((i, btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    const rollBtn = html.find(".roll-button .btn")[0];
    if (rollBtn) {
      rollBtn.textContent = !adversaryAvailable
        ? game.i18n.localize("SWFFG.SkillsRoll")
        : mode === "adversary"
          ? game.i18n.localize("SWFFG.Adversary.RollAdversaryPool")
          : game.i18n.localize("SWFFG.Adversary.RollBasePool");
    }
  }

  /** A field-for-field copy of the working (base) pool. */
  _clonePool() {
    return new DicePoolFFG({
      proficiency: this.dicePool.proficiency,
      ability:     this.dicePool.ability,
      challenge:   this.dicePool.challenge,
      difficulty:  this.dicePool.difficulty,
      boost:       this.dicePool.boost,
      setback:     this.dicePool.setback,
      remsetback:  this.dicePool.remsetback,
      force:       this.dicePool.force,
      advantage:   this.dicePool.advantage,
      success:     this.dicePool.success,
      threat:      this.dicePool.threat,
      failure:     this.dicePool.failure,
      light:       this.dicePool.light,
      dark:        this.dicePool.dark,
      triumph:     this.dicePool.triumph,
      despair:     this.dicePool.despair,
      upgrades:    this.dicePool.upgrades,
    });
  }

  /**
   * The pool to display and roll. In Base mode -- or when no Adversary is targeted
   * or there is no difficulty to upgrade -- this is the live base pool that manual
   * edits mutate. In Adversary mode it is a clone of the base pool with its
   * difficulty upgraded once per Adversary rank, leaving the base pool untouched so
   * the two modes can be toggled back and forth freely.
   */
  _effectivePool() {
    const adversaryActive = this._adversaryMode && this.adversaryRanks > 0 && this.dicePool.difficulty > 0;
    if (!adversaryActive) return this.dicePool;
    const clone = this._clonePool();
    clone.upgradeDifficulty(this.adversaryRanks);
    return clone;
  }

  _initializeInputs(html) {
    html.find(".pool-value input").each((key, value) => {
      const name = $(value).attr("name");
      value.value = this.dicePool[name];
    });

    html.find(".pool-additional input").each((key, value) => {
      const name = $(value).attr("name");
      value.value = this.dicePool[name];
      $(value).attr("allowNegative", true);
    });

    this._updatePreview(html);
  }

  _activateInputs(html) {
    html.find(".upgrade-buttons button").on("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const id = $(event.currentTarget).attr("id");

      switch (id.toLowerCase()) {
        case "upgrade-ability": {
          this.dicePool.upgrade(1);
          break;
        }
        case "downgrade-ability": {
          this.dicePool.upgrade(-1);
          break;
        }
        case "upgrade-difficulty": {
          this.dicePool.upgradeDifficulty(1);
          break;
        }
        case "downgrade-difficulty": {
          this.dicePool.upgradeDifficulty(-1);
          break;
        }
      }
      this._initializeInputs(html);
    });

    html.find(".pool-container, .pool-additional").on("click", (event) => {
      let input;

      if ($(event.currentTarget).hasClass(".pool-container")) {
        input = $(event.currentTarget).find(".pool-value input")[0];
      } else {
        input = $(event.currentTarget).find("input")[0];
        if(!input) {
          input = $(event.currentTarget.nextElementSibling).find("input")[0];
        }
      }

      input.value++;
      this.dicePool[input.name] = parseInt(input.value);
      this._updatePreview(html);
    });

    html.find(".pool-container, .pool-additional").on("contextmenu", (event) => {
      let input;

      if ($(event.currentTarget).hasClass(".pool-container")) {
        input = $(event.currentTarget).find(".pool-value input")[0];
      } else {
        input = $(event.currentTarget).find("input")[0];
        if(!input) {
          input = $(event.currentTarget.nextElementSibling).find("input")[0];
        }
      }

      const allowNegative = $(input).attr("allowNegative");

      if (input.value > 0 || allowNegative) {
        input.value--;
        this.dicePool[input.name] = parseInt(input.value);
      }
      this._updatePreview(html);
    });
  }

  _updateObject() {}

  /** @override */
  async close(options) {
    if (this._adversaryHookId) {
      Hooks.off("targetToken", this._adversaryHookId);
      this._adversaryHookId = null;
    }
    return super.close(options);
  }

  /**
   * Add the results of the dice simulation
   * @private
   */
  _updateSimulationPreview(pool = this.dicePool) {
    try {
      const simPool = new MonteCarlo({
        dicePool: {
          abilityDice: pool.ability,
          difficultyDice: pool.difficulty,
          proficiencyDice: pool.proficiency,
          challengeDice: pool.challenge,
          boostDice: pool.boost,
          setBackDice: pool.setback,
        },
        iterations: game.settings.get("starwarsffg", "rollSimulation"),
        runSimulate: false,
        modifiers: {
          automaticSuccesses: pool.success,
          automaticFailures: pool.failure,
          automaticAdvantages: pool.advantage,
          automaticThreats: pool.threat,
          automaticTriumphs: pool.triumph,
          automaticDespairs: pool.despair,
        },
      });
      const simResults = simPool.simulate();

      let newClass = "";
      if (simResults.successProbability < .25) {
        newClass = "unlikely";
      } else if (simResults.successProbability > .75) {
        newClass = "likely";
      }

      $("#success_chance").text(
        `${(simResults.successProbability * 100).toLocaleString(undefined, {maximumFractionDigits: 0})}%`
      ).removeClass("likely unlikely").addClass(newClass);
    } catch (e) {

    }
  }
}
