/**
 * Guard against Foundry's "11m 364d ago" chat timestamps.
 *
 * `foundry.utils.timeSince` renders a chat message's age by subtracting the
 * message timestamp from the local clock and running the result through the
 * Earth calendar:
 *
 *   seconds    = (new Date() - timeStamp) / 1000
 *   components = game.time.earthCalendar.timeToComponents(seconds)
 *   return       game.time.earthCalendar.format(components, "ago", {maxTerms: 2, style: "narrow"})
 *
 * `timeToComponents` is a calendar DATE decomposer, not a duration decomposer.
 * Hand it a negative number and `_decomposeTimeYears` floors to year -1 and adds
 * a whole year back to the remainder, landing on "31 December of year -1" --
 * month 11, day 364. `CalendarData.formatDuration` does carry a `hasNegative`
 * guard meant to catch exactly this, but it walks the components in object key
 * order and `year` is the LAST key `timeToComponents` returns, so month and day
 * are already collected by the time the -1 trips it. With maxTerms 2 the result
 * is the constant string "11m 364d ago" for ANY negative delta -- it is a
 * signature, not a measurement (the "m" is months, not minutes).
 *
 * A delta goes negative whenever the viewing client's clock is behind the clock
 * that stamped the message. Since Foundry issue #12718 (closed, V13 Stable 3)
 * the SERVER stamps `ChatMessage#timestamp` from its own `Date.now()`, so the
 * offender is always the viewer's clock, and the bogus text persists until real
 * elapsed time overtakes the skew -- the chat log only re-renders timestamps
 * every 15s (`ChatLog.UPDATE_TIMESTAMP_FREQUENCY`).
 *
 * Upstream fixed the timestamp's authority but left the formatter alone, so we
 * clamp it here. `CalendarData#format` resolves named formatters through
 * `CONFIG.time.formatters` BEFORE falling back to the static method, so this is
 * a supported extension point -- nothing is monkey-patched, and in particular
 * `foundry.utils` is frozen and could not be patched anyway. Both render paths
 * funnel through it: the Handlebars `timeSince` helper on first paint, and
 * `ChatLog#updateTimestamps` on the 15s refresh.
 *
 * This is cosmetic. The real fix is syncing the offending client's clock; the
 * guard only stops a misconfigured machine from showing nonsense to its user.
 */

/**
 * Probe whether the running core build still mis-renders a negative duration.
 *
 * Tests the structural defect (a negative time decomposing into positive month
 * and day components) AND the visible symptom (a future time formatting
 * differently from "now"), so a core fix at either layer retires the guard on
 * its own without a version check.
 * @param {CalendarData} calendar   The Earth calendar `timeSince` formats against.
 * @returns {boolean}               Whether the guard is needed on this build.
 */
function isAffected(calendar) {
  const future = calendar.timeToComponents(-60);
  if (!(Number(future.year) < 0)) return false;
  if (!(Number(future.month) > 0 || Number(future.day) > 0)) return false;
  const now = calendar.timeToComponents(0);
  return calendar.format(future, "ago", { maxTerms: 2, style: "narrow" })
    !== calendar.format(now, "ago", { maxTerms: 2, style: "narrow" });
}

/**
 * Install the "ago" formatter guard, but only on builds that still need it.
 * Safe to call more than once; the probe fails on an already-guarded build
 * because the guard makes the two probe strings match.
 * @returns {void}
 */
export function registerChatTimestampGuard() {
  const formatters = CONFIG.time?.formatters;
  const calendar = game.time?.earthCalendar;
  if (!calendar || typeof formatters?.ago !== "function") return;

  try {
    if (!isAffected(calendar)) return;
  } catch (err) {
    // A future core may restructure this path entirely. Leave it alone.
    CONFIG.logger?.warn?.("Chat timestamp guard: probe failed, deferring to core", err);
    return;
  }

  const previous = formatters.ago;
  formatters.ago = function (calendar, components, options) {
    // A negative duration means the timestamp sits in this client's future,
    // which only happens when the local clock lags the server's.
    if (Number(components?.year) < 0) return game.i18n.localize("TIME.Now");
    return previous(calendar, components, options);
  };

  CONFIG.logger?.debug?.("Chat timestamp guard installed (core renders negative durations as '11m 364d ago')");
}
