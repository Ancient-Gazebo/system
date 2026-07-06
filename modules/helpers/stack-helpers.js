/**
 * Item stacks: splitting and trading.
 *
 * Provides two player-facing features:
 *   1. Splitting a stack of items (e.g. 7 stimpacks -> 4 + 3), either in an actor's own
 *      inventory or when withdrawing a partial amount out of ship/homestead cargo.
 *   2. Trading an item/weapon/armour from one character to another without GM action.
 *
 * Permission model
 * ----------------
 * A player can only write to documents they own. To move items across an ownership
 * boundary we use one of two executors:
 *
 *   - Single-owner (atomic): a connected client that owns BOTH ends performs the whole
 *     move. The requester does it when they own both; otherwise the active GM's client
 *     does it silently (no GM action required, only that a GM is logged in). This path
 *     covers in-inventory splits, withdrawing from a GM-owned ship/homestead, trading to
 *     an NPC/loot actor, and trading while a GM is online.
 *
 *   - Split-peer (GM-free): for a player-to-player trade with no single client owning both
 *     ends, the recipient creates the item on their own actor and the sender then reduces
 *     their own stack, coordinated over the system socket. This is the path that lets two
 *     players trade with no GM present.
 *
 * All socket traffic rides the existing "system.starwarsffg" channel and is namespaced by
 * an "event" string so it coexists with the combat/PC-wizard handlers already registered.
 */
export default class StackHelpers {
  static SOCKET = "system.starwarsffg";

  /** Item types a player carries and can trade. */
  static TRADEABLE_TYPES = ["weapon", "armour", "gear"];

  /* -------------------------------------------- */
  /*  Small helpers                               */
  /* -------------------------------------------- */

  static getQuantity(item) {
    const value = Number(item?.system?.quantity?.value ?? 1);
    return Number.isFinite(value) ? value : 0;
  }

  static isStackable(item) {
    return foundry.utils.hasProperty(item ?? {}, "system.quantity.value");
  }

  static clampInt(value, min, max) {
    let n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  static _uuidOf(actor) {
    // Prefer the token actor UUID for unlinked tokens so transfers target the right copy.
    return actor?.uuid;
  }

  static _t(key, fallback, data) {
    if (game.i18n?.has?.(key)) return game.i18n.format(key, data ?? {});
    if (!data) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (m, k) => (k in data ? data[k] : m));
  }

  /* -------------------------------------------- */
  /*  Owner-side primitives                       */
  /*  (caller must own the relevant actor)        */
  /* -------------------------------------------- */

  /**
   * Reduce a stack on an owned actor by `qty`, deleting the item if it hits zero.
   */
  static async reduceStack(actor, itemId, qty) {
    const item = actor?.items?.get(itemId);
    if (!item) return false;
    const remaining = this.getQuantity(item) - this.clampInt(qty, 0, Number.MAX_SAFE_INTEGER);
    if (remaining <= 0) {
      await item.delete();
    } else {
      await item.update({ "system.quantity.value": remaining });
    }
    return true;
  }

  /**
   * Add `qty` of `itemData` to an owned actor. When `merge` is set and the incoming item is
   * a plain (un-attached, un-modified, unequipped) piece of gear, it folds into a matching
   * existing stack instead of creating a duplicate row. Returns the affected item document.
   */
  static async addStack(actor, itemData, qty, merge = true) {
    if (merge) {
      const match = this._findMergeTarget(actor, itemData);
      if (match) {
        await match.update({ "system.quantity.value": this.getQuantity(match) + qty });
        return match;
      }
    }
    const data = foundry.utils.duplicate(itemData);
    delete data._id;
    delete data.ownership;
    delete data.folder;
    delete data.sort;
    foundry.utils.setProperty(data, "system.quantity.value", qty);
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }

  /**
   * Find an existing stack on `actor` that the incoming item can safely merge into.
   * Conservative on purpose: only plain gear merges. Weapons/armour and any item carrying
   * attachments, modifiers, or an equipped state are kept as distinct rows so unique pieces
   * never collapse together and lose data.
   */
  static _findMergeTarget(actor, itemData) {
    if (itemData?.type !== "gear") return null;
    const hasCustom = (data) =>
      (data?.system?.itemattachment?.length || 0) > 0 ||
      (data?.system?.itemmodifier?.length || 0) > 0;
    if (hasCustom(itemData)) return null;
    return (
      actor.items.find(
        (i) =>
          i.type === "gear" &&
          i.name === itemData.name &&
          !i.system?.equippable?.equipped &&
          !hasCustom(i)
      ) ?? null
    );
  }

  /**
   * Move `quantity` of an item from `sourceActor` to `targetActor`. Caller must own both.
   * Adds to the destination first so an add failure cannot silently destroy the stack.
   */
  static async _executeLocal({ sourceActor, itemId, quantity, targetActor, merge }) {
    const item = sourceActor.items.get(itemId);
    if (!item) throw new Error("Source item no longer exists");
    const itemData = item.toObject();
    await this.addStack(targetActor, itemData, quantity, merge);
    await this.reduceStack(sourceActor, itemId, quantity);
    return itemData;
  }

  /* -------------------------------------------- */
  /*  Split                                        */
  /* -------------------------------------------- */

  /**
   * Split `amount` off an existing stack into a new sibling stack on the SAME actor.
   * Routes through the GM when the requester does not own the actor (e.g. splitting a stack
   * that lives in a GM-owned ship's cargo).
   */
  static async splitStack(actor, itemId, amount) {
    const item = actor?.items?.get(itemId);
    if (!item) return false;
    const total = this.getQuantity(item);
    amount = this.clampInt(amount, 1, total - 1);
    if (total < 2 || amount < 1) {
      ui.notifications.warn(this._t("SWFFG.Stacks.NothingToSplit", "There is nothing to split."));
      return false;
    }

    if (actor.isOwner) {
      // The sibling is intentionally a separate stack, so do not merge it back in.
      const data = item.toObject();
      delete data._id;
      delete data.ownership;
      delete data.folder;
      foundry.utils.setProperty(data, "system.quantity.value", amount);
      await actor.createEmbeddedDocuments("Item", [data]);
      await item.update({ "system.quantity.value": total - amount });
      return true;
    }

    const gm = game.users.activeGM;
    if (!gm) {
      ui.notifications.warn(
        this._t("SWFFG.Stacks.NoGM", "This action needs the owner or a GM to be online.")
      );
      return false;
    }
    game.socket.emit(this.SOCKET, {
      event: "stackSplit",
      actorUuid: this._uuidOf(actor),
      itemId,
      amount,
      requesterId: game.user.id,
    });
    return true;
  }

  /* -------------------------------------------- */
  /*  Transfer (cargo withdraw + trade execution) */
  /* -------------------------------------------- */

  /**
   * Request that `quantity` of an item move from one actor to another. Picks the atomic
   * single-owner executor when possible, otherwise relays to the active GM. This is the
   * engine behind cargo withdrawals and behind trades once they are accepted.
   */
  static async requestTransfer({ sourceUuid, itemId, quantity, targetUuid, merge = true, silent = false }) {
    const sourceActor = await fromUuid(sourceUuid);
    const targetActor = await fromUuid(targetUuid);
    if (!sourceActor || !targetActor) {
      ui.notifications.error(this._t("SWFFG.Stacks.ActorMissing", "Could not resolve both actors."));
      return false;
    }
    const item = sourceActor.items.get(itemId);
    if (!item) {
      ui.notifications.error(this._t("SWFFG.Stacks.ItemMissing", "That item no longer exists."));
      return false;
    }
    quantity = this.clampInt(quantity, 1, this.getQuantity(item));

    if (sourceActor.isOwner && targetActor.isOwner) {
      await this._executeLocal({ sourceActor, itemId, quantity, targetActor, merge });
      if (!silent) this._postMoveChat(sourceActor, targetActor, item.name, quantity);
      return true;
    }

    const gm = game.users.activeGM;
    if (!gm) {
      ui.notifications.warn(
        this._t("SWFFG.Stacks.NoGM", "This action needs the owner or a GM to be online.")
      );
      return false;
    }
    game.socket.emit(this.SOCKET, {
      event: "stackTransfer",
      sourceUuid,
      itemId,
      quantity,
      targetUuid,
      merge,
      silent,
      requesterId: game.user.id,
    });
    return true;
  }

  /* -------------------------------------------- */
  /*  Trade (consent handshake)                   */
  /* -------------------------------------------- */

  /**
   * Begin a trade. If the sender already owns the destination (giving between their own
   * actors, or a GM giving) it goes straight through. If a non-GM owner of the destination
   * is online, it sends them an accept/decline offer. Otherwise it falls back to the GM
   * relay so items can still be handed to offline allies or NPC/loot actors.
   */
  static async offerTrade({ sourceActor, itemId, quantity, targetUuid }) {
    const item = sourceActor?.items?.get(itemId);
    if (!item) return false;
    const targetActor = await fromUuid(targetUuid);
    if (!targetActor) {
      ui.notifications.error(this._t("SWFFG.Stacks.ActorMissing", "Could not resolve the recipient."));
      return false;
    }
    if (targetActor.uuid === sourceActor.uuid) {
      ui.notifications.warn(this._t("SWFFG.Stacks.SameActor", "Pick a different recipient."));
      return false;
    }
    quantity = this.clampInt(quantity, 1, this.getQuantity(item));

    // Sender owns both ends (e.g. two of their own PCs, or a GM): no consent needed.
    if (targetActor.isOwner) {
      return this.requestTransfer({
        sourceUuid: sourceActor.uuid,
        itemId,
        quantity,
        targetUuid,
        merge: true,
      });
    }

    // Designate a single online, non-GM owner of the recipient to confirm the offer. Picking
    // one deterministic recipient avoids two players both accepting and double-creating.
    const owners = game.users.filter(
      (u) => u.active && !u.isGM && u.id !== game.user.id && targetActor.testUserPermission(u, "OWNER")
    );
    owners.sort((a, b) => a.id.localeCompare(b.id));
    const recipientUser = owners[0];

    if (recipientUser) {
      game.socket.emit(this.SOCKET, {
        event: "stackTradeOffer",
        recipientUserId: recipientUser.id,
        requesterId: game.user.id,
        requesterName: game.user.name,
        sourceUuid: sourceActor.uuid,
        targetUuid,
        itemId,
        quantity,
        itemData: item.toObject(),
        itemName: item.name,
        targetName: targetActor.name,
      });
      ui.notifications.info(
        this._t("SWFFG.Stacks.OfferSent", "Trade offer sent to {user}.", { user: recipientUser.name })
      );
      return true;
    }

    // No online owner to confirm: fall back to the GM relay (or a local move if the sender
    // happens to own the destination, already handled above).
    return this.requestTransfer({
      sourceUuid: sourceActor.uuid,
      itemId,
      quantity,
      targetUuid,
      merge: true,
    });
  }

  /* -------------------------------------------- */
  /*  Socket handling                             */
  /* -------------------------------------------- */

  static registerSocket() {
    game.socket.on(this.SOCKET, async (payload, senderId) => {
      const event = payload?.event;
      try {
        switch (event) {
          case "stackTransfer":
            return await this._onSocketTransfer(payload);
          case "stackSplit":
            return await this._onSocketSplit(payload);
          case "stackTradeOffer":
            return await this._onSocketTradeOffer(payload);
          case "stackTradeAccepted":
            return await this._onSocketTradeAccepted(payload);
          case "stackTradeDeclined":
            return await this._onSocketTradeDeclined(payload);
          default:
            return;
        }
      } catch (err) {
        CONFIG.logger.error("[stacks] socket handler error", err);
      }
    });
  }

  /** GM-only: perform a relayed transfer (cargo withdraw, or trade with a GM present). */
  static async _onSocketTransfer(payload) {
    if (game.user.id !== game.users.activeGM?.id) return;
    const sourceActor = await fromUuid(payload.sourceUuid);
    const targetActor = await fromUuid(payload.targetUuid);
    if (!sourceActor || !targetActor) return;
    const item = sourceActor.items.get(payload.itemId);
    if (!item) return;
    const name = item.name;
    await this._executeLocal({
      sourceActor,
      itemId: payload.itemId,
      quantity: payload.quantity,
      targetActor,
      merge: payload.merge,
    });
    if (!payload.silent) this._postMoveChat(sourceActor, targetActor, name, payload.quantity);
  }

  /** GM-only: perform a relayed in-place split. */
  static async _onSocketSplit(payload) {
    if (game.user.id !== game.users.activeGM?.id) return;
    const actor = await fromUuid(payload.actorUuid);
    if (!actor) return;
    await this.splitStack(actor, payload.itemId, payload.amount);
  }

  /** Recipient-only: show an accept/decline dialog for an incoming trade offer. */
  static async _onSocketTradeOffer(payload) {
    if (game.user.id !== payload.recipientUserId) return;
    const qtyLabel = Number(payload.quantity) > 1 ? `${payload.quantity} × ` : "";
    const accepted = await Dialog.confirm({
      title: this._t("SWFFG.Stacks.OfferTitle", "Trade Offer"),
      content: `<p>${this._t(
        "SWFFG.Stacks.OfferBody",
        "{user} offers {qty}{item} to {target}.",
        { user: payload.requesterName, qty: qtyLabel, item: `<strong>${payload.itemName}</strong>`, target: payload.targetName }
      )}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
      options: { classes: ["dialog", "starwarsffg"] },
    });

    if (!accepted) {
      game.socket.emit(this.SOCKET, {
        event: "stackTradeDeclined",
        requesterId: payload.requesterId,
        recipientName: game.user.name,
        itemName: payload.itemName,
      });
      return;
    }

    // The recipient owns the destination, so it creates the item itself (no GM needed), then
    // tells the sender to remove the originating stack.
    const targetActor = await fromUuid(payload.targetUuid);
    if (!targetActor?.isOwner) {
      ui.notifications.error(this._t("SWFFG.Stacks.NoTargetPerm", "You do not own the recipient actor."));
      return;
    }
    await this.addStack(targetActor, payload.itemData, payload.quantity, true);
    game.socket.emit(this.SOCKET, {
      event: "stackTradeAccepted",
      requesterId: payload.requesterId,
      sourceUuid: payload.sourceUuid,
      itemId: payload.itemId,
      quantity: payload.quantity,
      recipientName: game.user.name,
      targetName: payload.targetName,
      itemName: payload.itemName,
    });
  }

  /** Sender-only: the recipient accepted, so remove the originating stack and announce it. */
  static async _onSocketTradeAccepted(payload) {
    if (game.user.id !== payload.requesterId) return;
    const sourceActor = await fromUuid(payload.sourceUuid);
    if (sourceActor?.isOwner) {
      await this.reduceStack(sourceActor, payload.itemId, payload.quantity);
    }
    ui.notifications.info(
      this._t("SWFFG.Stacks.TradeDone", "{recipient} accepted {item}.", {
        recipient: payload.recipientName,
        item: payload.itemName,
      })
    );
    this._postTradeChat(sourceActor?.name ?? "?", payload.targetName, payload.itemName, payload.quantity);
  }

  /** Sender-only: the recipient declined. */
  static async _onSocketTradeDeclined(payload) {
    if (game.user.id !== payload.requesterId) return;
    ui.notifications.warn(
      this._t("SWFFG.Stacks.TradeDeclined", "{recipient} declined {item}.", {
        recipient: payload.recipientName,
        item: payload.itemName,
      })
    );
  }

  /* -------------------------------------------- */
  /*  Chat notices                                */
  /* -------------------------------------------- */

  static _postMoveChat(sourceActor, targetActor, itemName, quantity) {
    const qty = this.clampInt(quantity, 1, Number.MAX_SAFE_INTEGER);
    ChatMessage.create({
      speaker: { alias: sourceActor?.name },
      content: `<i>${this._t("SWFFG.Stacks.MoveChat", "Moved {qty} × {item} to {target}.", {
        qty,
        item: itemName,
        target: targetActor?.name,
      })}</i>`,
    });
  }

  static _postTradeChat(sourceName, targetName, itemName, quantity) {
    const qty = this.clampInt(quantity, 1, Number.MAX_SAFE_INTEGER);
    ChatMessage.create({
      content: `<i>${this._t("SWFFG.Stacks.TradeChat", "{source} gave {qty} × {item} to {target}.", {
        source: sourceName,
        qty,
        item: itemName,
        target: targetName,
      })}</i>`,
    });
  }

  /* -------------------------------------------- */
  /*  Dialogs (player UI entry points)            */
  /* -------------------------------------------- */

  /** Number-input dialog to split a stack into a new sibling stack on the same actor. */
  static async promptSplit(actor, itemId) {
    const item = actor?.items?.get(itemId);
    if (!item) return;
    const total = this.getQuantity(item);
    if (total < 2) {
      ui.notifications.warn(this._t("SWFFG.Stacks.NothingToSplit", "There is nothing to split."));
      return;
    }
    const max = total - 1;
    const initial = Math.max(1, Math.floor(total / 2));
    const content = `
      <form class="ffg-stack-dialog">
        <p>${this._t("SWFFG.Stacks.SplitPrompt", "Split off how many of {item} (have {total})?", {
          item: `<strong>${item.name}</strong>`,
          total,
        })}</p>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;">
          <input type="range" name="range" min="1" max="${max}" value="${initial}" style="flex:1;" />
          <input type="number" name="amount" min="1" max="${max}" value="${initial}" style="width:64px;" />
        </div>
      </form>`;
    const amount = await this._numberDialog({
      title: this._t("SWFFG.Stacks.SplitTitle", "Split Stack"),
      content,
      confirmLabel: this._t("SWFFG.Stacks.SplitButton", "Split"),
    });
    if (amount == null) return;
    await this.splitStack(actor, itemId, amount);
  }

  /** Dialog to give an item to another actor (with quantity when the stack is splittable). */
  static async promptTrade(actor, itemId) {
    const item = actor?.items?.get(itemId);
    if (!item) return;
    const total = this.getQuantity(item);

    // Reasonable recipients: characters (allies), plus ships/homesteads for stashing cargo.
    const candidates = game.actors
      .filter((a) => a.id !== actor.id && ["character", "vehicle", "homestead", "rival", "nemesis"].includes(a.type))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!candidates.length) {
      ui.notifications.warn(this._t("SWFFG.Stacks.NoRecipients", "There is no one to give this to."));
      return;
    }

    const options = candidates
      .map((a) => `<option value="${a.uuid}">${a.name}</option>`)
      .join("");
    const qtyRow =
      total > 1
        ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;">
             <label style="flex:0 0 auto;">${this._t("SWFFG.ItemsQuantity", "Quantity")}</label>
             <input type="range" name="range" min="1" max="${total}" value="${total}" style="flex:1;" />
             <input type="number" name="amount" min="1" max="${total}" value="${total}" style="width:64px;" />
           </div>`
        : `<input type="hidden" name="amount" value="1" />`;
    const content = `
      <form class="ffg-stack-dialog">
        <p>${this._t("SWFFG.Stacks.TradePrompt", "Give {item} to:", {
          item: `<strong>${item.name}</strong>`,
        })}</p>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <label style="flex:0 0 auto;">${this._t("SWFFG.Stacks.Recipient", "Recipient")}</label>
          <select name="target" style="flex:1;">${options}</select>
        </div>
        ${qtyRow}
      </form>`;

    const result = await this._formDialog({
      title: this._t("SWFFG.Stacks.TradeTitle", "Give Item"),
      content,
      confirmLabel: this._t("SWFFG.Stacks.GiveButton", "Give"),
    });
    if (!result) return;
    await this.offerTrade({
      sourceActor: actor,
      itemId,
      quantity: result.amount,
      targetUuid: result.target,
    });
  }

  /** Dialog to withdraw a partial amount of cargo/storage into one of the user's characters. */
  static async promptWithdraw(cargoActor, itemId) {
    const item = cargoActor?.items?.get(itemId);
    if (!item) return;
    const total = this.getQuantity(item);

    // Destinations: the characters the current user owns (or every character for a GM).
    const myCharacters = game.actors.filter(
      (a) => a.type === "character" && a.id !== cargoActor.id && (game.user.isGM || a.isOwner)
    );
    if (!myCharacters.length) {
      ui.notifications.warn(this._t("SWFFG.Stacks.NoOwnedCharacter", "You have no character to take this into."));
      return;
    }
    const options = myCharacters
      .map((a) => `<option value="${a.uuid}">${a.name}</option>`)
      .join("");
    const qtyRow =
      total > 1
        ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;">
             <label style="flex:0 0 auto;">${this._t("SWFFG.ItemsQuantity", "Quantity")}</label>
             <input type="range" name="range" min="1" max="${total}" value="1" style="flex:1;" />
             <input type="number" name="amount" min="1" max="${total}" value="1" style="width:64px;" />
           </div>`
        : `<input type="hidden" name="amount" value="1" />`;
    const content = `
      <form class="ffg-stack-dialog">
        <p>${this._t("SWFFG.Stacks.WithdrawPrompt", "Take {item} (have {total}) into:", {
          item: `<strong>${item.name}</strong>`,
          total,
        })}</p>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <label style="flex:0 0 auto;">${this._t("SWFFG.Stacks.Character", "Character")}</label>
          <select name="target" style="flex:1;">${options}</select>
        </div>
        ${qtyRow}
      </form>`;

    const result = await this._formDialog({
      title: this._t("SWFFG.Stacks.WithdrawTitle", "Take From Cargo"),
      content,
      confirmLabel: this._t("SWFFG.Stacks.TakeButton", "Take"),
    });
    if (!result) return;
    await this.requestTransfer({
      sourceUuid: cargoActor.uuid,
      itemId,
      quantity: result.amount,
      targetUuid: result.target,
      merge: true,
    });
  }

  /* -------------------------------------------- */
  /*  Dialog plumbing                             */
  /* -------------------------------------------- */

  // Keep the range slider and number box in sync inside a dialog form.
  static _wireRangeSync(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const range = root.querySelector('input[name="range"]');
    const number = root.querySelector('input[name="amount"]');
    if (!range || !number) return;
    range.addEventListener("input", () => (number.value = range.value));
    number.addEventListener("input", () => {
      const min = Number(number.min);
      const max = Number(number.max);
      let v = Math.trunc(Number(number.value));
      if (!Number.isFinite(v)) v = min;
      v = Math.min(Math.max(v, min), max);
      number.value = v;
      range.value = v;
    });
  }

  /** Resolve to a clamped integer amount, or null on cancel. */
  static async _numberDialog({ title, content, confirmLabel }) {
    const result = await Dialog.wait(
      {
        title,
        content,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: confirmLabel,
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              const amount = root?.querySelector('input[name="amount"]')?.value;
              return Math.trunc(Number(amount));
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this._t("SWFFG.Cancel", "Cancel"),
            callback: () => null,
          },
        },
        default: "confirm",
        close: () => null,
        render: (html) => this._wireRangeSync(html),
      },
      { classes: ["dialog", "starwarsffg"] }
    );
    if (result == null || !Number.isFinite(result) || result < 1) return null;
    return result;
  }

  /** Resolve to {target, amount}, or null on cancel. */
  static async _formDialog({ title, content, confirmLabel }) {
    const result = await Dialog.wait(
      {
        title,
        content,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: confirmLabel,
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              return {
                target: root?.querySelector('select[name="target"]')?.value,
                amount: Math.max(1, Math.trunc(Number(root?.querySelector('input[name="amount"]')?.value)) || 1),
              };
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this._t("SWFFG.Cancel", "Cancel"),
            callback: () => null,
          },
        },
        default: "confirm",
        close: () => null,
        render: (html) => this._wireRangeSync(html),
      },
      { classes: ["dialog", "starwarsffg"] }
    );
    if (result == null || !result.target) return null;
    return result;
  }
}
