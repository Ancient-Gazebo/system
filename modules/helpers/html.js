/**
 * Tiny HTML helpers for the windows that build their markup in code.
 *
 * `foundry.utils.escapeHTML` only exists on newer builds, and this system still loads on V13, so
 * the escape lives here. No imports, so it is safe to pull in from anywhere.
 */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };

/**
 * @param {*} value
 * @returns {string} the value as text that is safe to interpolate into markup or an attribute
 */
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

/**
 * @param {string} key   a localization key
 * @param {object} [data]
 * @returns {string} the localized (and formatted, when data is given) string, HTML-escaped
 */
export function loc(key, data) {
  return escapeHTML(data ? game.i18n.format(key, data) : game.i18n.localize(key));
}
