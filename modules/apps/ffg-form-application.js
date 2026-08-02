const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Execute inline `<script>` tags inside freshly rendered V2 content.
 *
 * The V1 Application/Dialog pipeline injected HTML with jQuery, which evaluates
 * inline scripts. The native V2 pipeline (and DialogV2) assigns `innerHTML`,
 * which per the HTML spec NEVER runs them. Several of this system's templates
 * carry an inline script that both populates their rows and wires their
 * add/remove buttons (crew / currency / language settings, and the initiative
 * dice-pool +/- inputs), so without this they render empty and inert.
 *
 * Handlebars has already interpolated its data into the script text by render
 * time, so re-running the rendered text is equivalent to the V1 behavior. Each
 * script node is marked once executed; V2 replaces the content on every
 * re-render, so a genuine re-render produces fresh (unmarked) nodes and the
 * repopulation runs again against the newly emptied containers.
 *
 * @param {HTMLElement|null} root
 */
export function executeInlineScripts(root) {
  if (!root) return;
  // A script element only runs when it is inserted into a document that has a
  // browsing context. If the app's element is still detached at this point,
  // replacing the node would silently do nothing, so retry once it is attached.
  if (!root.isConnected) {
    requestAnimationFrame(() => executeInlineScripts(root));
    return;
  }
  for (const original of root.querySelectorAll("script")) {
    if (original.dataset.ffgExecuted) continue;
    const replacement = document.createElement("script");
    for (const { name, value } of original.attributes) replacement.setAttribute(name, value);
    replacement.text = original.textContent;
    replacement.dataset.ffgExecuted = "1";
    // Replacing the node is what executes it.
    original.replaceWith(replacement);
  }
}

/**
 * Shared native base for the system's form-style windows (modifiers popout,
 * roll builder, group manager, importers, settings panels, embedded item
 * editors). This is NOT a V1 compatibility shim -- it is a purpose-built
 * ApplicationV2 form base. It keeps only the form behaviors those windows
 * actually rely on, expressed in native V2 terms:
 *
 *  - a real <form> (via `window.contentTag = "form"`) so handlers can read
 *    `this.form` and append/remove rows (e.g. ModifierHelpers.onClickAttributeControl);
 *  - the legacy `(object, options)` construction signature, mapping `title` and
 *    `width/height/left/top` onto native `window.title` / `position`;
 *  - a coalescing `_onSubmit` -> `_updateObject` pipeline, fed by the native form
 *    handler (submit + submit-on-change) and callable directly by handlers;
 *  - submit-on-close, a close-time render guard (subclasses re-render from
 *    `_updateObject`), and an interactive-resize floor.
 *
 * Subclasses provide `static DEFAULT_OPTIONS` (with `form.submitOnChange` /
 * `form.closeOnSubmit` and a top-level `submitOnClose` as needed), `static PARTS`,
 * `_prepareContext`, and `_updateObject`. The V1 cruft (legacyOptions merge,
 * `getData` shim, dual defaultOptions) is intentionally gone.
 */
export class FFGFormApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    tag: "div",
    // Save controls use data-action="ffgSave" rather than type="submit"; see the handler.
    actions: {
      ffgSave: FFGFormApplication.ffgSave,
    },
    window: {
      contentTag: "form",
      resizable: false,
    },
    form: {
      // Native ApplicationV2 binds submit/change to the contentTag form and
      // calls this handler; we funnel both into the coalescing _onSubmit.
      handler: FFGFormApplication._formSubmitHandler,
      submitOnChange: false,
      closeOnSubmit: false,
    },
  };

  /** Interactive-resize floor; subclasses override via MIN_DIMENSIONS or _minDimensions(). */
  static MIN_DIMENSIONS = { width: 300, height: 200 };

  /**
   * @param {object} object    The legacy "form object" (a Document, or a plain
   *   wrapper such as the upgrade/talent modifier descriptor). Stored verbatim.
   * @param {object} [options] Legacy options: `title` and position hints
   *   (`width`/`height`/`left`/`top`); anything else passes through to V2.
   */
  constructor(object = {}, options = {}) {
    const { title, width, height, left, top, ...rest } = options;
    super({
      ...rest,
      window: { ...(rest.window ?? {}), ...(title ? { title } : {}) },
      position: {
        ...(rest.position ?? {}),
        ...(Number.isFinite(width) ? { width } : {}),
        ...(Number.isFinite(height) ? { height } : {}),
        ...(Number.isFinite(left) ? { left } : {}),
        ...(Number.isFinite(top) ? { top } : {}),
      },
    });
    this.object = object;
    this._submitting = false;
  }

  get isEditable() {
    return this.options.editable !== false;
  }

  /**
   * Run any inline scripts the rendered template carries (see
   * {@link executeInlineScripts}). Subclasses that override `_onRender` must
   * call super so their template scripts still run.
   * @override
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    executeInlineScripts(this.element);

    // NOTE: do not add a capture-phase `submit` listener that calls preventDefault here. It was
    // tried (2.1.20) to stop a native GET submission navigating the page, and it silently disabled
    // saving in every settings window and the OggDude importer: ApplicationV2's own submit handling
    // does not run once the event has been default-prevented, so cancelling the default action
    // cancels the save with it.
  }

  _minDimensions() {
    return this.constructor.MIN_DIMENSIONS;
  }

  async minimize(...args) {
    this._minimizing = true;
    try {
      return await super.minimize(...args);
    } finally {
      this._minimizing = false;
    }
  }

  /** Clamp interactive resize to the form's usable minimum (skip while minimizing). */
  setPosition(position = {}) {
    if (!this.element?.parentElement) return position;
    if (this._minimizing || this.minimized) return super.setPosition(position);
    const min = this._minDimensions();
    const clamped = { ...position };
    if (typeof clamped.width === "number" && clamped.width < min.width) clamped.width = min.width;
    if (typeof clamped.height === "number" && clamped.height < min.height) clamped.height = min.height;
    return super.setPosition(clamped);
  }

  /**
   * Native form `handler`. Called with `this` bound to the instance for both a
   * real submit and (when `form.submitOnChange`) a change. Delegate to the
   * coalescing pipeline; native handles closeOnSubmit afterwards from form config.
   */
  static _formSubmitHandler(event, _form, _formData) {
    return this._onSubmit(event);
  }

  /**
   * Save handler for a `data-action="ffgSave"` control.
   *
   * Settings templates used to save with `<button type="submit">`. When anything prevented the
   * framework's submit handling from running, the browser fell back to submitting the form for
   * real -- a GET navigation to a URL built from the field names, e.g.
   * `/game?currency_label=Glass&currency_key=glass&defaultKey=glass`, which reloaded Foundry at a
   * bogus address and left the interface misplaced until the query string was removed by hand.
   *
   * A `type="button"` control cannot trigger a native submission at all, so routing Save through an
   * action removes the failure mode rather than trying to intercept it. Cancelling the submit event
   * instead is NOT viable: ApplicationV2 skips its own handling once the event is default-prevented,
   * which silently disables saving everywhere (see the note in _onRender).
   *
   * @this {FFGFormApplication}
   */
  static async ffgSave(event, _target) {
    await this._onSubmit(event);
    if (this.options.form?.closeOnSubmit) await this.close();
  }

  /**
   * Override native change handling to (a) never submit on embedded-editor edits
   * and (b) mirror a range slider's value into its `.range-value` readout, then
   * defer to native (which fires submit-on-change when configured).
   */
  _onChangeForm(formConfig, event) {
    const input = event.target;
    if (input?.closest?.(".editor.prosemirror, .editor.tinymce")) return;
    if (input?.type === "range") {
      const field = input.parentElement?.querySelector(".range-value");
      if (field) {
        if (field.tagName === "INPUT") field.value = input.value;
        else field.innerHTML = input.value;
      }
    }
    return super._onChangeForm(formConfig, event);
  }

  _getSubmitData(updateData = {}) {
    if (!this.form) throw new Error("The form application has no registered form element.");
    const fd = new foundry.applications.ux.FormDataExtended(this.form);
    let data = fd.object;
    if (updateData) data = foundry.utils.mergeObject(data, updateData, { inplace: false });
    return foundry.utils.flattenObject(data);
  }

  /**
   * Coalescing submit. Returns the in-flight promise to concurrent callers so
   * close / inner-editor save flows wait for the flushed update. Does NOT close
   * -- the native pipeline owns closeOnSubmit (from `form.closeOnSubmit`), and
   * direct callers (onClickAttributeControl, submit-on-close) must not close.
   */
  async _onSubmit(event, { updateData = null } = {}) {
    event?.preventDefault?.();
    if (!this.form || !this.isEditable) return false;
    if (this._submitting) {
      this._submitPending = { updateData };
      return this._submitInFlight;
    }
    this._submitting = true;
    let formData;
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
        await this._updateObject(event, formData);
        if (this._submitPending) updateData = this._submitPending.updateData ?? updateData;
      } while (this._submitPending);
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

  async _updateObject(_event, _formData) {}

  /** Submit-on-close (opt-in) + block re-render races while tearing down. */
  async close(options = {}) {
    this._closing = true;
    try {
      if (this.options.submitOnClose && options.submit !== false && this.form && this.isEditable) {
        await this._onSubmit(new Event("submit", { cancelable: true }));
      }
      return await super.close(options);
    } finally {
      this._closing = false;
    }
  }

  async render(options, _options) {
    if (this._closing) return this;
    return super.render(options, _options);
  }
}
