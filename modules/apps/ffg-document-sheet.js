import PopoutEditor from "../popout-editor.js";

const { DocumentSheetV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Native shared base for the system's document sheets (item sheets as of the
 * V2-full migration Stage 3; actor sheets join in Stage 4). Extends Foundry's
 * ApplicationV2 `DocumentSheetV2` directly — no V1 compatibility shim.
 *
 * Provides the system-wide sheet machinery on top of `DocumentSheetV2`:
 *   - submit coalescing (`_onSubmit`) with change-stream batching,
 *   - the inline ProseMirror editor lifecycle (`_activateEditor` / `_saveEditor`),
 *   - a per-document active-tab cache, drag/drop wiring, header-control
 *     projection, dblclick-to-minimize, and the interactive-resize floor.
 *
 * Subclasses provide their data via `getData()` (bridged to native
 * `_prepareContext`) and their listeners via `activateListeners(html)` (bridged
 * to native `_onRender`). The native V2 form pipeline is intentionally neutered
 * (`form.handler = null`); submission flows through the manual `_onSubmit` so
 * the V1 submit-on-change / submit-on-close semantics and the coalescing loop
 * are preserved. See docs/superpowers/plans/2026-05-31-v2-full-migration.md.
 */
export class FFGDocumentSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  /**
   * Per-document active-tab cache keyed by `${appName}:${documentUuid}`. Used
   * to persist the active sheet tab across close-and-reopen within a single
   * page session. We intentionally avoid `document.setFlag` here: writing a
   * flag triggers a re-render of the sheet, which re-runs `_activateCoreListeners`
   * and rebinds the `Tabs` instance — racing with the user's click. An
   * in-memory map sidesteps that loop and keeps ephemeral UI state out of the
   * persisted document data. Lost on full page reload, which is acceptable.
   */
  static _activeTabCache = new Map();

  /**
   * Legacy header-button classes belonging to modules that also insert their own row into the
   * rendered header menu. Their legacy button is deliberately not bridged, to avoid a duplicate.
   */
  static SELF_RENDERING_HEADER_BUTTONS = new Set(["glitchsmith-actor-sheet-menu"]);

  static DEFAULT_OPTIONS = {
    tag: "div",
    // `app`/`window-app`/`sheet` are the V1-parity hooks; `application` is added
    // by ApplicationV2. `themed`/`theme-light` are hardcoded to match the compat
    // base (FFGDocumentSheetV2) exactly: the system has always shipped its sheets
    // forced to V13 light theme. Letting DocumentSheetV2 derive the theme natively
    // dropped both classes (no per-document theme is configured), which changed the
    // V13 CSS variables the skin/layout depend on — a visual regression (notably
    // the character/rival/nemesis tab-strip height). Keep them for identical output.
    classes: ["app", "window-app", "sheet", "themed", "theme-light"],
    window: {
      contentTag: "form",
      contentClasses: [],
      resizable: true,
    },
    // The native V2 form pipeline is neutered (`handler: null`) so the manual
    // `_onSubmit` is the single submission path; see _initializeApplicationOptions.
    // The *top-level* submit flags below are the V1-parity options the manual
    // pipeline reads via `this.options.*` — distinct from the nested `form.*`
    // framework flags. Subclasses set their own values.
    form: {
      handler: null,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    editable: true,
    submitOnChange: false,
    submitOnClose: false,
    closeOnSubmit: false,
    sheetConfig: true,
    scrollY: [],
    tabs: [],
    dragDrop: [],
    secrets: [],
  };

  static PARTS = {
    sheet: {
      root: true,
      template: "",
    },
  };

  constructor(...args) {
    super(...args);
    this.appId = this.id;
    this._dragDrop = [];
    this._tabs = [];
    this._submitting = false;
    this.editors = {};
    this._token = this.options.token ?? null;
  }

  /**
   * Neuter V2's native form pipeline. Submission is handled manually by
   * `_onChangeInput` / `_onSubmit` to preserve V1 submit-on-change /
   * submit-on-close semantics and the submit-coalescing in `_onSubmit`.
   * Setting `handler: null` removes DocumentSheetV2's own form handler so the
   * manual submit listener bound in `_onRender` is the only submit path. We do
   * this defensively in addition to the DEFAULT_OPTIONS `form.handler: null`.
   */
  _initializeApplicationOptions(options) {
    const initialized = super._initializeApplicationOptions(options);
    initialized.form = {
      ...initialized.form,
      submitOnChange: false,
      closeOnSubmit: false,
      handler: null,
    };
    return initialized;
  }

  get object() {
    return this.document;
  }

  get form() {
    return this.element?.querySelector("form") ?? super.form;
  }

  get isEditable() {
    return (this.options.editable !== false) && super.isEditable;
  }

  /**
   * Disable/enable all form fields for non-editable sheets.
   *
   * DocumentSheetV2 calls this from `_onRender` whenever `!isEditable` (e.g. a
   * locked-compendium item, a limited-permission item, or `flags.readonly`).
   * The native implementation computes its content element as
   * `form.querySelector(".window-content")`, which assumes the form is a *child*
   * of `.window-content`. In our layout the content form element *is* the
   * `.window-content` (tag:"div" + window.contentTag:"form"), so that lookup
   * returns null and the native method throws on `contentEl.querySelectorAll`.
   * Override to fall back to the form itself. Without this, opening any
   * non-editable item/actor sheet crashes during render.
   * @override
   */
  _toggleDisabled(disabled) {
    const form = this.form;
    if (!form) return;
    const framed = this.options.window.frame;
    for (const element of form.elements) {
      if (!framed || element.closest(".window-content")) element.disabled = disabled;
    }
    const contentEl = (framed ? form.querySelector(".window-content") : form) ?? form;
    for (const input of contentEl.querySelectorAll("input[type=image]")) {
      input.disabled = disabled;
    }
    for (const img of contentEl.querySelectorAll("img[data-edit]")) {
      img.classList.toggle("disabled", disabled);
    }
  }

  get _activeTabCacheKey() {
    const uuid = this.document?.uuid;
    if (!uuid) return null;
    return `${this.constructor.name}:${uuid}`;
  }

  get template() {
    return this.options.template;
  }

  // NOTE: `toObject(false)` returns the raw source document data, not the
  // transformed view that ActiveEffects produce. This matches V1 ActorSheet
  // semantics and is required by edit-mode workflows that need unmodified
  // values (see ActorHelpers.beginEditMode).
  getData(_options = {}) {
    const data = this.document.toObject(false);
    const isEditable = this.isEditable;
    return {
      cssClass: isEditable ? "editable" : "locked",
      editable: isEditable,
      document: this.document,
      data,
      limited: this.document.limited,
      options: this.options,
      owner: this.document.isOwner,
      title: this.title,
    };
  }

  _configureRenderParts(options) {
    return {
      sheet: {
        root: true,
        template: this.template,
        scrollable: this.options.scrollY ?? [],
      },
    };
  }

  async _prepareContext(options) {
    return this.getData(options);
  }

  /**
   * Capture the content scroll BEFORE the re-render replaces it. ApplicationV2
   * reuses the content <form> but swaps its innerHTML, which resets scrollTop --
   * so e.g. ticking a tree node's "learned" checkbox (which submits + re-renders)
   * would jump the sheet back to the top. The old DOM is still mounted here, so we
   * read the current scroll; `_onRender` restores it once the new content is in
   * place and the form's overflow has been re-applied. @override
   */
  async _preRender(context, options) {
    await super._preRender(context, options);
    this._ffgScrollTop = this.form?.scrollTop || 0;
    this._captureScrollPositions();
  }

  /**
   * Stable identity for a scroll container across re-renders. Tabs are keyed by
   * `data-tab` so a changing tab count (module-injected tabs, the optional gear /
   * talent organization tabs) cannot shift one tab's scroll onto another; anything
   * else falls back to its position among that selector's matches.
   */
  _ffgScrollKey(selector, el, index) {
    const tab = el.dataset?.tab;
    return tab ? `${selector}@${tab}` : `${selector}#${index}`;
  }

  /**
   * Remember where each `scrollY` container is scrolled to.
   *
   * ApplicationV2 already restores `scrollable` parts, but it does so inside
   * `_replaceHTML` -- before `_activateCoreListeners` binds Tabs and re-activates the
   * open tab. Sheet templates hard-code the FIRST tab as active, so at that moment the
   * tab the user is actually looking at is still `display: none`, and assigning
   * `scrollTop` to a hidden element does nothing. That is why equipping a weapon /
   * armour / gear item (which updates the item, re-rendering the actor sheet) snapped
   * the list back to the top: on actor sheets `.tab` is the scrolling element, not the
   * form. We therefore keep our own copy and re-apply it from `_onRender`, after the
   * real tab is visible again.
   */
  _captureScrollPositions() {
    const root = this.element;
    if (!root) return;
    const positions = (this._ffgScrollPositions ??= new Map());
    for (const selector of this.options.scrollY ?? []) {
      let index = -1;
      for (const el of root.querySelectorAll(selector)) {
        index += 1;
        // A hidden container (an inactive tab) reports scrollTop 0 regardless of where
        // the user left it, so keep the remembered value instead of zeroing it out.
        if (el.offsetParent === null) continue;
        positions.set(this._ffgScrollKey(selector, el, index), el.scrollTop);
      }
    }
  }

  /** Re-apply the scroll offsets captured in `_preRender`. */
  _restoreScrollPositions() {
    const root = this.element;
    const positions = this._ffgScrollPositions;
    if (!root || !positions?.size) return;
    for (const selector of this.options.scrollY ?? []) {
      let index = -1;
      for (const el of root.querySelectorAll(selector)) {
        index += 1;
        const top = positions.get(this._ffgScrollKey(selector, el, index));
        if (top) el.scrollTop = top;
      }
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const form = this.form;
    if (form) {
      this._applyLegacyRootClasses(form, context);
      form.dataset.appid = this.appId;
      // ApplicationV2 reuses the content <form> element across re-renders
      // (only its innerHTML is replaced), so attaching submit/change handlers
      // on every _onRender stacks duplicate listeners. Each duplicate fires
      // its own submit; with submit-coalescing that becomes one redundant
      // document.update per accumulated render. Attach exactly once per form
      // element, guarded by a dataset flag.
      if (!form.dataset.ffgListenersBound) {
        form.dataset.ffgListenersBound = "1";
        form.addEventListener("submit", this._onSubmit.bind(this));
        form.addEventListener("change", this._onChangeInput.bind(this));
      }
    }
    this.element.dataset.appid = this.appId;

    this._installHeaderControlDeduplicator();
    this._projectLegacyHeaderControls();
    this.element.querySelector(":scope > .window-resize-handle")?.classList.add("window-resizable-handle");

    this._bindHeaderMinimize();

    const html = $(form ?? this.element);
    this._activateCoreListeners(html);
    this.activateListeners(html);
    this._callLegacyRenderHook(html, context);
    // Deferred to the next frame on purpose. ApplicationV2 dispatches its own
    // `render<ClassName>` hook only AFTER this method's promise resolves
    // (ApplicationV2#_doEvent calls the handler, then #dispatchEvent), and that is the
    // hook modules actually inject their tabs from -- the netrunning module listens for
    // `renderActorSheetFFG`. Restoring synchronously here still ran before the tab
    // existed. A microtask is not enough either, since the dispatch happens in the
    // promise continuation; rAF clears the whole task.
    requestAnimationFrame(() => {
      this._restoreInjectedTab();
      // A module tab only becomes visible here, so its scroll has to be re-applied
      // after the fact; the containers already restored below are unaffected.
      this._restoreScrollPositions();
    });
    this._activateEditors();

    // --- Window size stability: no auto-resize on re-render ---
    // ApplicationV2 re-forces a position dimension back to "auto" on EVERY
    // re-render whenever the static `this.options.position` dimension is "auto"
    // (the base ApplicationV2 default for any dimension a subclass didn't pin in
    // DEFAULT_OPTIONS -- e.g. item sheets set only `width`, so `height` stays
    // "auto"). That re-measures the content and snaps the window to fit it on
    // any change (selecting an upgrade, editing a field...). We only want the
    // window to resize via the resize handle or minimize. Once the LIVE position
    // has a numeric dimension (the per-type sizing sets it), copy it into
    // `this.options.position` so the auto-forcing stops -- this mirrors what V13
    // itself does after a manual resize (#onResize writes options.position[dim]).
    // Skip while (un)minimizing so we don't freeze the collapsed-header height.
    if (!this.minimized && !this._minimizing && this.options?.position) {
      for (const dim of ["width", "height"]) {
        if (typeof this.position?.[dim] === "number" && this.options.position[dim] === "auto") {
          this.options.position[dim] = this.position[dim];
        }
      }
    }

    // Restore the pre-render content scroll (captured in _preRender) now that the
    // new content is in place and activateListeners has re-applied the form's
    // overflow, so a re-render (e.g. a tree checkbox submit) keeps the scroll.
    // The form is the scroller on the flat editor windows; on actor/item sheets it
    // is the active `.tab` / `.sheet-body`, handled by the per-container restore --
    // which must run here rather than in _replaceHTML because Tabs only re-activated
    // the open tab a few lines above.
    if (this._ffgScrollTop && this.form) this.form.scrollTop = this._ffgScrollTop;
    this._restoreScrollPositions();
  }

  _applyLegacyRootClasses(form, context = {}) {
    form.setAttribute("autocomplete", "off");
    form.classList.toggle("editable", this.isEditable);
    form.classList.toggle("locked", !this.isEditable);

    for (const cls of this._getLegacyRootClasses(context)) {
      if (cls) form.classList.add(cls);
    }
  }

  /**
   * Actions from V13's controls-dropdown that we mirror as inline,
   * V1-style labeled links in the window header. Empty by default: the
   * V13 `×` icon already covers Close, and every other dropdown entry
   * (Configure Sheet, Prototype Token, Copy Document ID, etc.) is fine
   * to stay inside the `⋮` menu. The only inline header link the user
   * actually wants is Sheet Options, which ActorOptions/ItemOptions
   * inject directly — not via this projection.
   */
  static LEGACY_HEADER_ACTIONS = new Set();

  /**
   * Lower bound for interactive resize. ApplicationV2's setPosition writes
   * width/height unconditionally, so without this a user can drag the resize
   * handle down to a few pixels and leave a sheet unusable. Subclasses with
   * type-specific floors override `_minDimensions()`.
   */
  static MIN_DIMENSIONS = { width: 300, height: 200 };

  _minDimensions() {
    return this.constructor.MIN_DIMENSIONS;
  }

  /**
   * Restore V1's dblclick-header-to-minimize toggle. V13's ApplicationV2 only
   * exposes minimize via the controls-dropdown; dblclicking the header
   * otherwise just selects the title text (visible as a black highlight).
   * Listen in the capture phase so we run before any V13 internal handler
   * that might stop propagation, and dedupe via a dataset flag.
   */
  _bindHeaderMinimize() {
    const header = this.element?.querySelector(":scope > .window-header");
    if (!header || header.dataset.ffgMinimizeBound) return;
    header.dataset.ffgMinimizeBound = "1";
    header.addEventListener("dblclick", (event) => {
      // V13's ApplicationV2 already binds its own #onWindowDoubleClick on
      // the same header in the bubble phase, and its filter only ignores
      // elements with a `data-action` attribute. So a dblclick on our
      // injected Sheet Options <a>, on legacy-header-action links, or on
      // anything else without data-action would still minimize via V13's
      // handler. Run in capture phase and, when the dblclick is on an
      // interactive control, stopImmediatePropagation to prevent V13's
      // handler from also firing.
      if (event.target.closest("button, a, [data-action], input, select, label, .ffg-sheet-options, .legacy-header-action")) {
        event.stopImmediatePropagation();
        return;
      }
      // Title-area dblclick: V13 will handle the actual minimize itself,
      // we just need to not interfere. Clear the text selection the first
      // click leaves behind.
      window.getSelection?.()?.removeAllRanges?.();
    }, true);
  }

  setPosition(position = {}) {
    // V13's _updatePosition reads `el.parentElement.offsetWidth` and only
    // guards against the element itself being null, not against the element
    // being detached. If setPosition fires before the element is inserted
    // into the DOM (race during initial render, especially when reopening a
    // sheet) it throws a "Cannot read properties of null (reading
    // 'offsetWidth')". Skip the call in that case -- V13 will reapply the
    // position via its render flow once the element is attached.
    if (!this.element?.parentElement) return position;
    // While the window is minimizing or already minimized, V13 calls
    // setPosition with header-only dimensions (~30px height). Clamping those
    // up to the interactive-resize minimum prevents the collapse and leaves
    // the window stuck at an awkward in-between size.
    if (this._minimizing || this.minimized) return super.setPosition(position);
    const min = this._minDimensions();
    const clamped = { ...position };
    if (typeof clamped.width === "number" && clamped.width < min.width) clamped.width = min.width;
    if (typeof clamped.height === "number" && clamped.height < min.height) clamped.height = min.height;
    return super.setPosition(clamped);
  }

  async minimize(...args) {
    this._minimizing = true;
    try {
      return await super.minimize(...args);
    } finally {
      this._minimizing = false;
    }
  }

  /**
   * Collapse duplicate entries out of this sheet's header (⋮) menu.
   *
   * Deduplicating from a prototype wrapper cannot work in general. Modules install their own
   * wrappers on the sheet class from a render hook, and module scripts load after the system, so
   * theirs sit OUTSIDE ours -- an entry one of them unshifts onto the front of the list is added
   * after our code has already run and is invisible to it. That is why one module kept appearing
   * twice (once natively at the top of the menu, once from its legacy button at the bottom) even
   * after the bridge was moved and taught to compare localised labels.
   *
   * An own property on the INSTANCE shadows the entire prototype chain, so this always runs last.
   * It calls through to the chain -- so every module's contribution is still collected -- and only
   * then removes repeats, keeping the first occurrence so menu order is preserved.
   * @private
   */
  _installHeaderControlDeduplicator() {
    if (Object.prototype.hasOwnProperty.call(this, "_getHeaderControls")) return;
    Object.defineProperty(this, "_getHeaderControls", {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function (...args) {
        const chain = Object.getPrototypeOf(this)?._getHeaderControls;
        const controls = (typeof chain === "function" ? chain.apply(this, args) : []) ?? [];
        const seen = new Set();
        return controls.filter((control) => {
          // Labels may be literal text or a localisation key depending on the contributor, so
          // compare what the user will actually read.
          const raw = String(control?.label ?? "").trim();
          const key = raw ? (game.i18n?.localize(raw) ?? raw).trim().toLowerCase() : "";
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
    });
  }

  _projectLegacyHeaderControls() {
    const header = this.element.querySelector(":scope > .window-header");
    const dropdown = this.element.querySelector(":scope > menu.controls-dropdown");
    if (!header) return;

    header.querySelectorAll(":scope > .legacy-header-action").forEach((el) => el.remove());

    if (!dropdown) return;
    const allowed = this.constructor.LEGACY_HEADER_ACTIONS;
    const sources = [
      ...dropdown.querySelectorAll(":scope > .header-control[data-action]"),
      ...header.querySelectorAll(":scope > button.header-control[data-action='close']"),
    ].filter((source) => allowed.has(source.dataset.action));
    if (!sources.length) return;

    const anchor = header.querySelector(":scope > [data-action='toggleControls']") ?? header.lastElementChild;
    for (const source of sources) {
      const action = source.dataset.action;
      const button = source.matches("button") ? source : source.querySelector("button");
      const rawLabel = (source.querySelector(".control-label")?.textContent ?? source.dataset.tooltip ?? source.ariaLabel ?? button?.ariaLabel ?? "").trim();
      const label = this._getLegacyHeaderActionLabel(action, rawLabel);
      if (!action || !label) continue;

      const link = document.createElement("a");
      link.className = "legacy-header-action";
      link.dataset.action = action;
      link.innerHTML = `${source.querySelector("i")?.outerHTML ?? ""} <span>${label}</span>`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button?.click();
      });
      // Keep the header's window-drag (ApplicationV2 `#onWindowDragStart`) from
      // engaging on a press that begins on this link: a press with any cursor
      // movement otherwise triggers `header.setPointerCapture()`, which eats the
      // synthesized `click`. Same mechanism/fix as the Sheet Options button in
      // actor-ffg-options.js / item-ffg-options.js. (LEGACY_HEADER_ACTIONS is
      // empty today, so no links are projected -- this guards the path if it is
      // ever populated.)
      link.addEventListener("pointerdown", (event) => event.stopPropagation());
      header.insertBefore(link, anchor);
    }
  }

  _getLegacyHeaderActionLabel(action, fallback) {
    switch (action) {
      case "configureSheet":
        return "Sheet";
      case "close":
        return game.i18n.localize("SWFFG.ButtonClose") || "Close";
      default:
        return fallback;
    }
  }

  _getLegacyRootClasses(_context = {}) {
    return [];
  }

  _callLegacyRenderHook(html, context = {}) {
    const documentName = this.document?.documentName;
    if (!documentName) return;

    Hooks.callAll(`render${documentName}Sheet`, this, html, context);
  }

  _callLegacyCloseHook(html) {
    const documentName = this.document?.documentName;
    if (!documentName) return;

    Hooks.callAll(`close${documentName}Sheet`, this, html);
  }

  async close(options = {}) {
    // Block any render attempts that fire while we're closing. The submit-on-
    // close path runs `document.update`, which can trigger BOTH Foundry's
    // auto-render-on-update hook AND an explicit `this.render(true)` from
    // legacy helpers (see ItemHelpers.itemUpdate / ActorHelpers.updateActor).
    // Either one will race with super.close and re-attach the DOM, leaving
    // the user feeling like × did nothing. The `_closing` flag is consulted
    // by our overridden `render()` to bail out cleanly.
    this._closing = true;
    try {
      if (this.options.submitOnClose && options.submit !== false && this.form && this.isEditable) {
        const event = new Event("submit", { cancelable: true });
        try {
          await this._onSubmit(event, { preventClose: true, render: false });
        } catch (err) {
          // A failed submit-on-close must NEVER trap the window open: the user
          // clicked × and expects it to close. Log and continue to tear down
          // (this matches Foundry's own close, which does not block on submit).
          // This was the minion close-button bug: submit-on-close threw and the
          // unguarded await aborted close() before super.close() ever ran.
          console.error("starwarsffg | submit-on-close failed; closing anyway", err);
        }
      }
      // Fire while the form is still in the DOM so legacy listeners can inspect it.
      const form = this.form;
      if (form) this._callLegacyCloseHook($(form));
      return await super.close(options);
    } catch (err) {
      console.error("starwarsffg | sheet failed to close (super.close threw)", err);
      throw err;
    } finally {
      this._closing = false;
    }
  }

  async render(options, _options) {
    if (this._closing) return this;
    return super.render(options, _options);
  }

  /**
   * Install the V1 header-button bridge on a sheet class, wrapping whatever is already there.
   *
   * V1 sheets let modules add header buttons by pushing `{label, icon, class, onclick}` onto an
   * array passed to `get<Document>SheetHeaderButtons`. ApplicationV2 never fires that hook and
   * builds its menu from `_getHeaderControls()`, so a module still using it contributes nothing
   * and reports nothing -- the button is simply absent. Five modules in a typical install do this.
   *
   * This deliberately wraps the class prototype at FIRST RENDER rather than living inside
   * `_getHeaderControls` itself. Modules that have been updated patch that same method from their
   * own `ready`, so they sit OUTSIDE this class's implementation: bridging from within it appends
   * the legacy entries before those modules add their native ones, and a module offering both
   * routes is then listed twice. Wrapping late puts this outermost, where the complete list is
   * visible and duplicates can actually be detected.
   * @param {Object} proto a sheet class prototype
   */
  static installLegacyHeaderButtonBridge(proto) {
    if (!proto || typeof proto._getHeaderControls !== "function") return;
    if (Object.prototype.hasOwnProperty.call(proto, "_ffgLegacyHeaderBridge")) return;
    Object.defineProperty(proto, "_ffgLegacyHeaderBridge", { value: true, enumerable: false });

    const original = proto._getHeaderControls;
    proto._getHeaderControls = function (...args) {
      const controls = original.apply(this, args) ?? [];
      const documentName = this.document?.documentName;
      if (!documentName) return controls;

      const legacy = [];
      try {
        Hooks.callAll(`get${documentName}SheetHeaderButtons`, this, legacy);
      } catch (err) {
        CONFIG.logger?.warn?.("Legacy header button hook failed", err);
        return controls;
      }
      if (!legacy.length) return controls;

      // Compared against the FULL list, including entries added by modules that wrapped this
      // method after us. `onClick`/`onclick` are both accepted: modules written across the
      // transition use either, and one module here uses both spellings in different entries.
      // Compare LOCALISED labels. Control labels are commonly localisation keys that Foundry
      // resolves when it renders the menu, while a legacy button's label is usually literal text.
      // Matching raw strings therefore misses a module contributing "GLITCHSMITH.Open" natively
      // and "GlitchSmith" through the old hook -- two different strings that render identically,
      // which is exactly how that entry stayed duplicated after the ordering fix.
      const normalise = (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        return (game.i18n?.localize(raw) ?? raw).trim().toLowerCase();
      };
      const seen = new Set(controls.map((c) => normalise(c?.label)).filter(Boolean));
      for (const button of legacy) {
        // Some modules register a legacy header button AND insert their own row into the rendered
        // menu. Bridging their button then produces a second, identical row that no pass over the
        // control list can detect, because their own row never appears in it. Pruning the rendered
        // menu instead leaves the box at the height it was measured at, so the removed row shows
        // as a blank strip. Skipping the bridge for them is the only approach that leaves the menu
        // correct at every layer.
        if (FFGDocumentSheet.SELF_RENDERING_HEADER_BUTTONS.has(String(button?.class ?? ""))) continue;
        const label = button?.label;
        const handler = button?.onClick ?? button?.onclick;
        const key = normalise(label);
        if (!key || typeof handler !== "function" || seen.has(key)) continue;
        seen.add(key);
        controls.push({
          // Namespaced so it cannot collide with a core action name.
          action: `ffgLegacyHeader-${button.class ?? label}`.replace(/[^\w-]/g, "-"),
          icon: button.icon ?? "fa-solid fa-square",
          label,
          onClick: (...handlerArgs) => handler.apply(this, handlerArgs),
        });
      }
      return controls;
    };
  }

  activateListeners(_html) {}

  /**
   * Re-select a tab contributed by a module, once the render hook has had a chance to add it.
   *
   * Called after `_callLegacyRenderHook`. Without this, any sheet re-render triggered while a
   * module-injected tab was open (e.g. the netrunning module's tab, while editing a deck's
   * architecture) dropped the user back onto the first tab, because the tab did not exist at the
   * moment Tabs was bound. Does nothing when the remembered tab is a native one — those are
   * already handled by the `initial` option — or when it still is not present in the DOM.
   */
  _restoreInjectedTab() {
    const desired = this._pendingTabRestore;
    this._pendingTabRestore = null;
    const root = this.element;
    if (!desired || !root || !this._tabs?.length) return;
    const selector = `[data-tab="${CSS.escape(desired)}"]`;
    for (const tabs of this._tabs) {
      if (tabs.active === desired) return;
      const scoped = tabs.group ? `[data-group="${CSS.escape(tabs.group)}"]${selector}` : selector;
      if (!root.querySelector(scoped)) continue;
      tabs.activate(desired);
      const cacheKey = this._activeTabCacheKey;
      if (cacheKey) this.constructor._activeTabCache.set(cacheKey, desired);
      return;
    }
  }

  _activateCoreListeners(html) {
    const root = html[0];
    if (!root) return;

    const cacheKey = this._activeTabCacheKey;
    // Remember the tab we WANT before constructing any Tabs instance. Modules inject their own
    // tabs from the `renderActorSheet` hook, which fires after this runs, so at bind time a
    // module tab is not in the DOM yet: Tabs falls back to the first tab AND fires its callback,
    // which overwrites the cache below with that fallback. Capturing the value up front keeps the
    // real target available to _restoreInjectedTab() once the hook has run.
    this._pendingTabRestore = (cacheKey ? this.constructor._activeTabCache.get(cacheKey) : undefined) ?? this._sheetTab ?? null;
    this._tabs = (this.options.tabs ?? []).map((tabConfig) => {
      const cached = cacheKey ? this.constructor._activeTabCache.get(cacheKey) : undefined;
      const tabs = new foundry.applications.ux.Tabs({
        ...tabConfig,
        initial: cached ?? this._sheetTab ?? tabConfig.initial,
        callback: (_event, _tabs, active) => {
          this._sheetTab = active;
          if (cacheKey) this.constructor._activeTabCache.set(cacheKey, active);
        },
      });
      tabs.bind(root);
      return tabs;
    });

    this._dragDrop = (this.options.dragDrop ?? []).map((dragDropConfig) => {
      const dragDrop = new foundry.applications.ux.DragDrop({
        ...dragDropConfig,
        permissions: {
          dragstart: this._canDragStart.bind(this),
          drop: this._canDragDrop.bind(this),
          ...(dragDropConfig.permissions ?? {}),
        },
        callbacks: {
          dragstart: this._onDragStart.bind(this),
          dragover: this._onDragOver.bind(this),
          drop: this._onDrop.bind(this),
          ...(dragDropConfig.callbacks ?? {}),
        },
      });
      dragDrop.bind(root);
      return dragDrop;
    });

    if (this.isEditable) {
      html.find("img[data-edit]").on("click", this._onEditImage.bind(this));
      html.find("button.file-picker").on("click", this._activateFilePicker.bind(this));
    }
  }

  /**
   * Wire the V1 `{{editor}}` helper's Edit button to mount a ProseMirror
   * editor inline. V13's HandlebarsApplicationMixin does not auto-bind this;
   * the V1 FormApplication did. The helper emits
   * `.editor-content[data-edit="<name>"]` with a sibling `.editor-edit`
   * anchor inside a `.editor` container.
   */
  _activateEditors() {
    const root = this.element;
    if (!root) return;
    for (const content of root.querySelectorAll(".editor-content[data-edit]")) {
      const name = content.dataset.edit;
      if (!name) continue;
      const containerEl = content.closest(".editor");
      const button = containerEl?.querySelector(".editor-edit");
      if (!button || button.dataset.editorBound) continue;
      button.dataset.editorBound = "1";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this._activateEditor(name, content, containerEl, button);
      });
    }
  }

  async _activateEditor(name, contentEl, containerEl, buttonEl) {
    // A live editor is already open for this field — nothing to do.
    if (this.editors[name]?.instance?.view) return;
    // A stale/half-open entry (e.g. a prior save that failed to mount) would
    // otherwise permanently brick the edit button via the guard above. Clear
    // it so this click can mount a fresh editor.
    if (this.editors[name]) this._destroyEditor(name);
    const initial = foundry.utils.getProperty(this.document, name) ?? "";
    const { ProseMirrorEditor } = foundry.applications.ux;

    // Register a FormDataExtended-compatible entry BEFORE create() resolves.
    // FormDataExtended iterates `editors` and, for each entry whose
    // `options.engine === "prosemirror"`, serializes the live document out of
    // `instance.view`. Omitting this shape causes both the editor instance
    // AND the matching [data-edit] node to be skipped -- silently losing
    // unsaved content on submit-on-close.
    this.editors[name] = {
      instance: null,
      options: { engine: "prosemirror", target: name, button: true, owner: this.isEditable },
      active: true,
      button: buttonEl,
      container: containerEl,
    };

    const editor = await ProseMirrorEditor.create(contentEl, initial, {
      document: this.document,
      fieldName: name,
      relativeLinks: true,
      plugins: {
        // destroyOnSave:false -- our _saveEditor owns the teardown. If the menu
        // destroyed the view on "Save and Close", it would race _saveEditor's
        // _onSubmit, which reads the (now dead) view via FormDataExtended and
        // saves empty, and would leave this.editors[name] stale (bricking the
        // edit button). Letting our code destroy keeps the view alive until
        // after the value is read and the document updated.
        menu: ProseMirror.ProseMirrorMenu.build(ProseMirror.defaultSchema, {
          destroyOnSave: false,
          onSave: () => this._saveEditor(name, { remove: true }),
        }),
        keyMaps: ProseMirror.ProseMirrorKeyMaps.build(ProseMirror.defaultSchema, {
          onSave: () => this._saveEditor(name, { remove: true }),
        }),
      },
    });

    this.editors[name].instance = editor;
    // The `prosemirror` class on the container is what the change-handler
    // editor guard (_onChangeInput) looks for. Without it, every keystroke
    // inside the editor bubbles a `change` to the form and triggers a full
    // submit. V1 added the engine class to the .editor container on mount;
    // mirror that here.
    containerEl.classList.add("editor-active", "prosemirror");
    // Hide the "edit" pencil while editing: clicking it mid-edit re-enters
    // _activateEditor and breaks the live view. Inline style so it wins over
    // any theme CSS. The post-save re-render provides a fresh, visible button.
    if (buttonEl) buttonEl.style.display = "none";
  }

  async _saveEditor(name, { remove = true } = {}) {
    const state = this.editors[name];
    if (!state?.instance?.view || state._saving) return;
    state._saving = true;
    // Route through the normal submit pipeline so ItemHelpers.itemUpdate /
    // ActorHelpers.updateActor run AE sync, talent propagation, attribute
    // reshaping, and XP logging. FormDataExtended pulls the editor value out
    // of state.instance via the engine="prosemirror" entry on this.editors --
    // the view is still alive here because the menu no longer destroys on save.
    //
    // Submit with render:false and re-render explicitly afterwards. We cannot
    // rely on document.update's auto-render: if the content was unchanged the
    // update is a no-op that fires no hook and no render, leaving the editor
    // we just destroyed without its {{editor}} block restored (broken view).
    // The explicit render runs in finally so the block is always rebuilt, even
    // on an unchanged save or a failed submit.
    try {
      const event = new Event("submit", { cancelable: true });
      await this._onSubmit(event, { preventClose: true, render: false });
    } finally {
      if (remove) this._destroyEditor(name);
      this.render(true);
    }
  }

  _destroyEditor(name) {
    const state = this.editors[name];
    if (!state) return;
    try { state.instance?.destroy(); } catch (_e) { /* already torn down */ }
    state.container?.classList.remove("editor-active", "prosemirror");
    // Restore the edit button (hidden in _activateEditor). Harmless if this is
    // the now-detached pre-re-render button; required if teardown happens
    // without a re-render so the button doesn't stay hidden.
    if (state.button) state.button.style.display = "";
    delete this.editors[name];
  }

  async _onEditImage(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document._source, attr);
    const fp = new foundry.applications.apps.FilePicker.implementation({
      current,
      type: "image",
      callback: (path) => {
        target.src = path;
        if (this.options.submitOnChange) {
          this._onSubmit(new Event("submit", { cancelable: true }));
        }
      },
      position: {
        top: this.position.top + 40,
        left: this.position.left + 10,
      },
    });
    return fp.browse();
  }

  _activateFilePicker(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const field = button.dataset.target;
    const input = this.form?.elements[field];
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: button.dataset.type ?? "image",
      current: input?.value,
      callback: (path) => {
        if (input) input.value = path;
        if (this.options.submitOnChange) {
          this._onSubmit(new Event("submit", { cancelable: true }));
        }
      },
      position: {
        top: this.position.top + 40,
        left: this.position.left + 10,
      },
    });
    return fp.browse();
  }

  _onChangeInput(event) {
    // The change listener is bound to the form, so event.currentTarget is the
    // form itself -- never an editor. Guard on the actual changed element.
    const input = event.target;
    if (input?.closest?.(".editor.prosemirror, .editor.tinymce")) return;

    if (input?.type === "color" && input.dataset.edit && this.form?.elements[input.dataset.edit]) {
      this.form.elements[input.dataset.edit].value = input.value;
    } else if (input?.type === "range") {
      const field = input.parentElement?.querySelector(".range-value");
      if (field) {
        if (field.tagName === "INPUT") field.value = input.value;
        else field.innerHTML = input.value;
      }
    }

    // Re-render after a change-driven submit, matching V1: FormApplication's
    // `_updateObject` called `document.update()` with render defaulting to true,
    // so editing any field refreshed everything derived from it. The V2 port
    // defaults `render` to false, which left manually typed values updating the
    // stored data but not the display - e.g. typing a wounds/strain value did
    // not move the damage track (getData computes `vitalTracks`) or update a
    // minion group's derived numbers, while the +/- steppers did because they
    // call `actor.update()` directly, where render defaults to true.
    //
    // `change` fires on commit (blur / enter), not per keystroke, so this is one
    // render per edit. Scroll position and the active tab are preserved across
    // re-renders by _preRender / the active-tab cache.
    if (this.options.submitOnChange) return this._onSubmit(event, { render: true });
  }

  async _onSubmit(event, options = {}) {
    let { updateData = null, preventClose = false, render = false } = options;
    event?.preventDefault?.();
    if (!this.form || !this.isEditable) return false;

    // Coalesce concurrent submits. The previous `this._submitting` early-
    // return dropped a change that arrived mid-flight -- exactly the spec-tree
    // multi-click checkbox bug. Instead, record the pending request and return
    // the in-flight promise so callers (close / _saveEditor) still wait for the
    // flushed submit before tearing down DOM.
    if (this._submitting) {
      this._submitPending = { updateData, preventClose, render };
      return this._submitInFlight;
    }

    this._submitting = true;
    let formData;
    let currentRender = render;
    let currentPreventClose = preventClose;

    let resolveFlush;
    let rejectFlush;
    this._submitInFlight = new Promise((res, rej) => { resolveFlush = res; rejectFlush = rej; });

    let iter = 0;
    try {
      do {
        if (iter++ > 8) {
          console.warn("starwarsffg | _onSubmit coalesce loop exceeded 8 iterations; bailing");
          break;
        }
        this._submitPending = null;
        formData = this._getSubmitData(updateData);
        await this._updateObject(event, formData, { render: currentRender });
        // A pending submit registered while we awaited carries its intent
        // forward: render: true wins, preventClose: false wins.
        if (this._submitPending) {
          if (this._submitPending.render) currentRender = true;
          if (!this._submitPending.preventClose) currentPreventClose = false;
          updateData = this._submitPending.updateData ?? updateData;
        }
      } while (this._submitPending);

      if (this.options.closeOnSubmit && !currentPreventClose) {
        await this.close({ submit: false, force: true });
      }
      resolveFlush(formData);
      return formData;
    } catch (err) {
      rejectFlush(err);
      throw err;
    } finally {
      this._submitting = false;
      this._submitInFlight = null;
    }
  }

  _getSubmitData(updateData = {}) {
    if (!this.form) throw new Error("The sheet has no registered form element.");
    const fd = new foundry.applications.ux.FormDataExtended(this.form, { editors: this.editors });
    let data = fd.object;
    if (updateData) data = foundry.utils.mergeObject(data, updateData, { inplace: false });
    return foundry.utils.flattenObject(data);
  }

  async _updateObject(_event, formData, { render = false } = {}) {
    return this.document.update(formData, { render });
  }

  /**
   * Add/remove a source-book reference in `system.metadata.sources`. Shared by
   * item and actor sheets (this.object is the document either way).
   * @param event
   */
  async _handleSourceControl(event) {
    event.preventDefault();
    event.stopPropagation();
    const action = $(event.currentTarget).data("action");
    const sourceIndex = $(event.currentTarget).data("index");
    if (action === "add") {
      // Single-instance guard: a second click on `+` while an Add Source dialog
      // is open focuses it instead of stacking another. Sync flag set before any
      // async hop so a fast double-click can't slip through.
      if (this._addSourceDialogOpen) {
        this._addSourceDialog?.bringToFront?.();
        return;
      }
      this._addSourceDialogOpen = true;
      const addSource = new DialogV2({
        window: { title: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Title") },
        classes: ["starwarsffg-dialog", "ffg-meta-dialog"],
        content: `
          <div class="ffg-meta-form">
            <label for="book">${game.i18n.localize("SWFFG.Meta.Sources.AddSource.Book")} :</label>
            <input type="text" id="book" name="book" value="Force and Destiny Core Rulebook" autofocus>
            <label for="page">${game.i18n.localize("SWFFG.Meta.Sources.AddSource.Page")}:</label>
            <input type="number" id="page" name="page" value="0">
          </div>
        `,
        buttons: [
          {
            action: "submit",
            icon: "fas fa-check",
            label: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Submit"),
            default: true,
            callback: async (event, button, dialog) => {
              const bookName = dialog.element.querySelector("#book").value;
              const pageNum = dialog.element.querySelector("#page").value;
              await this.object.update({"system.metadata.sources": [...this.object.system.metadata.sources, `${bookName} pg. ${pageNum}`]});
            },
          },
          {
            action: "cancel",
            icon: "fas fa-x",
            label: game.i18n.localize("SWFFG.Meta.Sources.AddSource.Cancel"),
          },
        ],
      });
      const releaseSourceLock = () => {
        this._addSourceDialogOpen = false;
        if (this._addSourceDialog === addSource) this._addSourceDialog = null;
      };
      this._addSourceDialog = addSource;
      // Release the lock on any close path (submit, cancel, X, Esc all fire close).
      addSource.addEventListener("close", releaseSourceLock, { once: true });
      addSource.render({ force: true });
      // V13 dialogs sometimes render behind the parent sheet; force to front next paint.
      requestAnimationFrame(() => addSource.bringToFront?.());
    } else if (action === "remove") {
      const sources = foundry.utils.deepClone(this.object.system.metadata.sources);
      sources.splice(sourceIndex, 1);
      await this.object.update({"system.metadata.sources": sources});
      // Only render after a structural change; rendering on "add" too (before the
      // dialog submits) re-runs setPosition and snaps the window to default size.
      this.render(true);
    }
  }

  /**
   * Add/remove a free-text tag in `system.metadata.tags`. Shared by item and
   * actor sheets.
   * @param event
   */
  async _handleTagControl(event) {
    event.preventDefault();
    event.stopPropagation();
    const action = $(event.currentTarget).data("action");
    const tagIndex = $(event.currentTarget).data("index");
    if (action === "add") {
      if (this._addTagDialogOpen) {
        this._addTagDialog?.bringToFront?.();
        return;
      }
      this._addTagDialogOpen = true;
      const addTag = new DialogV2({
        window: { title: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Title") },
        classes: ["starwarsffg-dialog", "ffg-meta-dialog"],
        content: `
          <div class="ffg-meta-form">
            <label for="tag">${game.i18n.localize("SWFFG.Meta.Tags.AddTag.Tag")} :</label>
            <input type="text" id="tag" name="tag" value="" autofocus>
          </div>
        `,
        buttons: [
          {
            action: "submit",
            icon: "fas fa-check",
            label: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Submit"),
            default: true,
            callback: async (event, button, dialog) => {
              const tag = dialog.element.querySelector("#tag").value;
              const updatedTags = this.object.system.metadata.tags || [];
              updatedTags.push(tag);
              await this.object.update({"system.metadata.tags": updatedTags});
            },
          },
          {
            action: "cancel",
            icon: "fas fa-x",
            label: game.i18n.localize("SWFFG.Meta.Tags.AddTag.Cancel"),
          },
        ],
      });
      const releaseTagLock = () => {
        this._addTagDialogOpen = false;
        if (this._addTagDialog === addTag) this._addTagDialog = null;
      };
      this._addTagDialog = addTag;
      addTag.addEventListener("close", releaseTagLock, { once: true });
      addTag.render({ force: true });
      requestAnimationFrame(() => addTag.bringToFront?.());
    } else if (action === "remove") {
      const tags = foundry.utils.deepClone(this.object.system.metadata.tags);
      tags.splice(tagIndex, 1);
      await this.object.update({"system.metadata.tags": tags});
      this.render(true);
    }
  }

  /** Minimum popout-editor window height; actor sheets override to a smaller floor. */
  get _popoutEditorMinHeight() { return 400; }

  _onPopoutEditor(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;
    const label = a.dataset.label;
    const key = a.dataset.target;

    const parent = $(a.parentElement);
    const parentPosition = $(parent).offset();

    const floor = this._popoutEditorMinHeight;
    const windowHeight = parseInt($(parent).height(), 10) + 100 < floor ? floor : parseInt($(parent).height(), 10) + 100;
    const windowWidth = parseInt($(parent).width(), 10) < 320 ? 320 : parseInt($(parent).width(), 10);
    const windowLeft = parseInt(parentPosition.left, 10);
    const windowTop = parseInt(parentPosition.top, 10);

    const title = a.dataset.label ? `Editor for ${this.object.name}: ${label}` : `Editor for ${this.object.name}`;

    new PopoutEditor(this.object, {
      name: key,
      title: title,
      height: windowHeight,
      width: windowWidth,
      left: windowLeft,
      top: windowTop,
    }).render(true);
  }

  _canDragStart(_selector) {
    return this.isEditable;
  }

  _canDragDrop(_selector) {
    return this.isEditable;
  }

  _onDragStart(_event) {}

  _onDragOver(_event) {}

  async _onDrop(_event) {}
}

/**
 * Install the legacy header-button bridge on every registered sheet class, once, at `ready`.
 *
 * Installed EARLY on purpose. Modules wrap `_getHeaderControls` from their own `ready` or first
 * render, so wrapping before them puts this innermost -- their wrappers then see the entries this
 * bridge contributes and can filter them. The reverse order is what left the financial bridge's
 * wallet toggle unable to take effect: it removed the entry, and this bridge added it back
 * afterwards.
 */
Hooks.once("ready", () => {
  for (const config of [CONFIG.Actor, CONFIG.Item]) {
    for (const entries of Object.values(config?.sheetClasses ?? {})) {
      for (const entry of Object.values(entries ?? {})) {
        try {
          FFGDocumentSheet.installLegacyHeaderButtonBridge(entry?.cls?.prototype);
        } catch (err) {
          CONFIG.logger?.warn?.("Could not install the legacy header button bridge", err);
        }
      }
    }
  }
});
