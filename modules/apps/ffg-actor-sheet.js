import { FFGDocumentSheet } from "./ffg-document-sheet.js";

/**
 * Native shared base for the system's actor sheets (`ActorSheetFFG` and its
 * `AdversarySheetFFG` variant) on top of the document-sheet base
 * `FFGDocumentSheet`. Adds the actor-specific machinery: token-aware title,
 * the `actor`/`token` accessors, the item/effect/actor/folder drag-drop suite
 * (`_onDrop*` / `_onSortItem` / `_onDragStart`), the configure-(prototype-)token
 * header controls, and the `_getSubmitData` AE-override stripping. The
 * `dragDrop` selector here is wired by `FFGDocumentSheet._activateCoreListeners`.
 *
 * Subclasses provide their data via `getData()` and listeners via
 * `activateListeners(html)` (bridged to native `_prepareContext`/`_onRender` by
 * the base). See docs/superpowers/plans/2026-05-31-v2-full-migration.md.
 */
export class FFGActorSheet extends FFGDocumentSheet {
  static DEFAULT_OPTIONS = {
    position: { width: 800, height: 720 },
    window: { resizable: true },
    // V1-parity submit flags read by the manual submit pipeline in the base.
    submitOnChange: true,
    submitOnClose: true,
    closeOnSubmit: false,
    baseApplication: "ActorSheet",
    dragDrop: [{ dragSelector: ".items-list .item" }],
    secrets: [{ parentSelector: ".editor" }],
  };

  get title() {
    if (!this.actor.isToken) return this.actor.name;
    return `[${game.i18n.localize(TokenDocument.metadata.label)}] ${this.actor.name}`;
  }

  get actor() {
    return this.object;
  }

  get token() {
    return this.object.token || this._token || null;
  }

  async close(options = {}) {
    this._token = null;
    return super.close(options);
  }

  /**
   * Re-fire the conventional `renderActorSheetV2` hook.
   *
   * FFG actor sheets extend `DocumentSheetV2` directly rather than
   * `foundry.applications.sheets.ActorSheetV2`, so `ActorSheetV2` is never in the
   * inheritance chain. Foundry fires `render<ClassName>` for each class in that
   * chain (ApplicationV2#_doEvent), which means it fires `renderDocumentSheetV2`
   * and `renderApplicationV2` but NOT `renderActorSheetV2`. Modules that inject
   * actor-sheet header controls hook the standard `renderActorSheetV2` anchor (the
   * V2 successor to V1's `renderActorSheet`), so the migration silently dropped it.
   *
   * Re-emit it here for every FFG actor sheet, matching Foundry's render-hook
   * signature: (application, element, context, options). Runs after super so the
   * frame/header DOM and our own listeners are already in place.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    Hooks.callAll("renderActorSheetV2", this, this.element, context, options);
  }

  /** Actor popout editors use a smaller height floor than item sheets (base = 400). */
  get _popoutEditorMinHeight() { return 200; }

  getData(options = {}) {
    const context = super.getData(options);
    context.actor = this.object;
    context.items = context.data.items;
    context.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.effects = context.data.effects;
    return context;
  }

  _getLegacyRootClasses(context = {}) {
    const classes = super._getLegacyRootClasses(context);
    const sheetClass = {
      character: "character",
      rival: "character",
      nemesis: "character",
      minion: "minion",
      vehicle: "vehicle",
      homestead: "homestead",
    }[this.actor.type];

    if (sheetClass) classes.push(sheetClass);
    return classes;
  }

  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if (!this.isEditable) return controls;

    if (this.actor.isToken) {
      controls.push({
        action: "configureToken",
        icon: "fa-regular fa-circle-user",
        label: "DOCUMENT.Token",
        onClick: this._onConfigureToken.bind(this),
      });
    } else {
      controls.push({
        action: "configurePrototypeToken",
        icon: "fa-solid fa-circle-user",
        label: "TOKEN.TitlePrototype",
        onClick: this._onConfigurePrototypeToken.bind(this),
      });
    }

    return controls;
  }

  _onConfigurePrototypeToken() {
    new CONFIG.Token.prototypeSheetClass({
      prototype: this.actor.prototypeToken,
      position: {
        left: Math.max(this.position.left - 570, 10),
        top: this.position.top,
      },
    }).render({ force: true });
  }

  _onConfigureToken() {
    this.actor.token?.sheet?.render({ force: true });
  }

  _getSubmitData(updateData = {}) {
    const data = super._getSubmitData(updateData);
    // `overrides` can be undefined (no active effects applied yet); flattenObject
    // throws on Object.keys(undefined), which would abort submit-on-close and
    // leave the × button unable to close the sheet. Guard with {}.
    const overrides = foundry.utils.flattenObject(this.actor.overrides ?? {});
    for (const k of Object.keys(overrides)) delete data[k];
    return data;
  }

  _canDragStart(_selector) {
    return this.isEditable;
  }

  _canDragDrop(_selector) {
    return this.isEditable;
  }

  _onDragStart(event) {
    const li = event.currentTarget;
    if ("link" in event.target.dataset) return;

    let dragData;
    if (li.dataset.itemId) {
      const item = this.actor.items.get(li.dataset.itemId);
      dragData = item?.toDragData();
    }
    if (li.dataset.effectId) {
      const effect = this.actor.effects.get(li.dataset.effectId);
      dragData = effect?.toDragData();
    }
    if (!dragData) return;

    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const actor = this.actor;
    const allowed = Hooks.call("dropActorSheetData", actor, this, data);
    if (allowed === false) return;

    switch (data.type) {
      case "ActiveEffect":
        return this._onDropActiveEffect(event, data);
      case "Actor":
        return this._onDropActor(event, data);
      case "Item":
        return this._onDropItem(event, data);
      case "Folder":
        return this._onDropFolder(event, data);
      case "Transfer":
        // The FFG cross-actor transfer payload (player-to-player item trading).
        // Normally the trading feature's own DragDrop on .sheet-body fires first
        // and stopPropagation() keeps the drop from reaching this root handler;
        // this route is the fallback for layouts where the inner target misses
        // the event. Guarded so sheet subclasses without the trading handler
        // (e.g. non-inventory sheets) fall through harmlessly.
        return this._onTransferItemDrop?.(event);
      default:
        return undefined;
    }
  }

  async _onDropActiveEffect(_event, data) {
    const effect = await ActiveEffect.implementation.fromDropData(data);
    if (!this.actor.isOwner || !effect) return false;
    if (effect.target === this.actor) return false;
    return ActiveEffect.implementation.create(effect.toObject(), { parent: this.actor });
  }

  async _onDropActor(_event, _data) {
    if (!this.actor.isOwner) return false;
    return false;
  }

  async _onDropItem(event, data) {
    if (!this.actor.isOwner) return false;
    const item = await Item.implementation.fromDropData(data);
    const itemData = item.toObject();

    if (this.actor.uuid === item.parent?.uuid) return this._onSortItem(event, itemData);
    return this._onDropItemCreate(itemData, event);
  }

  async _onDropFolder(event, data) {
    if (!this.actor.isOwner) return [];
    const folder = await Folder.implementation.fromDropData(data);
    if (folder.type !== "Item") return [];
    const droppedItemData = await Promise.all(folder.contents.map(async (item) => {
      if (!(item instanceof Item)) item = await foundry.utils.fromUuid(item.uuid);
      return item.toObject();
    }));
    return this._onDropItemCreate(droppedItemData, event);
  }

  async _onDropItemCreate(itemData, _event) {
    itemData = Array.isArray(itemData) ? itemData : [itemData];
    // V14 replaced the core ActiveEffect `duration` model with {value, units,
    // expiry}; `value` must be an integer when `units` is set. Legacy effects
    // (e.g. the system's own "(inherent)" ones) migrate to {value: null,
    // units: "seconds"} -- the invalid "units but no value" state -- which makes
    // createEmbeddedDocuments throw a DataModelValidationError and aborts the drop.
    // This system tracks effect duration in `flags.starwarsffg.duration`, so the core
    // field is unused here; strip the malformed duration so Foundry applies a valid
    // (permanent) default. Integer values are left intact so real durations survive.
    for (const data of itemData) {
      for (const effect of data.effects ?? []) {
        if (effect?.duration && !Number.isInteger(effect.duration.value)) {
          delete effect.duration;
        }
      }
    }
    return this.actor.createEmbeddedDocuments("Item", itemData);
  }

  _onSortItem(event, itemData) {
    const items = this.actor.items;
    const source = items.get(itemData._id);
    const dropTarget = event.target.closest("[data-item-id]");
    if (!dropTarget) return;
    const target = items.get(dropTarget.dataset.itemId);
    if (!source || !target || source.id === target.id) return;

    const siblings = [];
    for (const el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.itemId;
      if (siblingId && (siblingId !== source.id)) siblings.push(items.get(el.dataset.itemId));
    }

    const sortUpdates = foundry.utils.performIntegerSort(source, { target, siblings });
    const updateData = sortUpdates.map((u) => {
      const update = u.update;
      update._id = u.target._id;
      return update;
    });

    return this.actor.updateEmbeddedDocuments("Item", updateData);
  }
}
