/**
 * A DialogV2 that cannot be stranded on screen by a failing button callback.
 *
 * Core closes a dialog only AFTER the pressed button's callback resolves: `DialogV2#_onSubmit`
 * awaits the callback, then calls `close()`. `_onClickButton` neither awaits nor catches
 * `_onSubmit`, so anything that throws part-way through a callback - a selector that matched
 * nothing, a rejected document update, a logging helper that blew up after the real work had
 * already been done - skips the close entirely. The dialog is left open, looking as though the
 * action never happened, with the only evidence an unhandled rejection in the console. That is
 * what left "Purchase Upgrade" and "Grant XP" sitting on screen after the purchase or grant had
 * in fact gone through.
 *
 * Every button callback is wrapped so it always resolves; the error is logged and surfaced as a
 * notification instead of being swallowed, and the dialog then closes exactly as it would have
 * on success.
 *
 * Used by importing it under the DialogV2 name:
 *   `import { GuardedDialogV2 as DialogV2 } from "<path>/dialog-helpers.js";`
 * The static entry points all funnel through `DialogV2.wait`, which constructs `new this(config)`,
 * so `wait` / `confirm` / `prompt` / `input` are all covered by the subclass.
 *
 * `options.submit` is deliberately NOT wrapped: `wait()` replaces it with its own resolver, and
 * swallowing an error there would leave the returned promise pending forever.
 */
export class GuardedDialogV2 extends foundry.applications.api.DialogV2 {
  /** @inheritDoc */
  _initializeApplicationOptions(options) {
    const initialized = super._initializeApplicationOptions(options);
    // super normalizes the buttons array into an { [action]: button } object.
    const context = initialized.window?.title || "this action";
    for (const button of Object.values(initialized.buttons ?? {})) {
      if (typeof button.callback === "function" && !button.callback.ffgGuarded) {
        button.callback = closeOnFailure(button.callback, context);
      }
    }
    return initialized;
  }
}

/**
 * Wrap a DialogV2 button callback so a failure inside it cannot skip the dialog's close.
 * See {@link GuardedDialogV2} for why this is needed.
 *
 * @param {Function} fn       the original callback, `(event, button, dialog) => any`. Arrow
 *                            functions keep their lexical `this`, so wrapping is transparent.
 * @param {string} [context]  short description of the action (the dialog title, by default),
 *                            used in the log line and the notification.
 * @returns {Function} a callback that always resolves.
 */
export function closeOnFailure(fn, context = "this action") {
  const guarded = async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      // Straight to console.error rather than through CONFIG.logger. The logger is assigned
      // during the system's init hook, so `CONFIG.logger?.error?.()` silently no-ops if it is
      // ever missing or replaced - and the optional chaining hides that, leaving a caught
      // exception with no trace at all beyond the notification. An error big enough to have
      // aborted a dialog callback must always reach the console.
      console.error(`${CONFIG?.module ?? "Star Wars FFG"} | Dialog action failed: ${context}`, err);
      ui.notifications?.error?.(game.i18n.format("SWFFG.Dialogs.ActionFailed", { context }));
    }
  };
  guarded.ffgGuarded = true;
  return guarded;
}
