/**
 * Monk's Combat Details compatibility shim (Foundry V13).
 *
 * MCD's "open combat tracker" feature repositions the popped-out combat tracker from its
 * renderCombatTracker hook via MonksCombatDetails.repositionCombat(). Under Foundry V13 the popout
 * is an ApplicationV2, whose position.width / position.height are commonly the string "auto"
 * rather than pixel numbers. MCD 13.x computes:
 *
 *     left = sidebar.offsetLeft - app.position.width   // number - "auto" = NaN
 *
 * and assigning NaN through the ApplicationV2 position proxy throws:
 *
 *     TypeError: 'set' on proxy: trap returned falsish for property 'left'
 *
 * The exception aborts repositionCombat before the CSS is applied, so the popout is left stranded
 * at the left edge of the screen (reported by both players and GMs). This was fixed upstream in
 * MCD 14.x, which reads element.offsetWidth / offsetHeight instead - but 13.05 is the last release
 * compatible with Foundry V13, so we shim it here.
 *
 * The shim wraps repositionCombat: before delegating to the original it copies real pixel
 * measurements into app.position.width/height so the original's math produces finite numbers, and
 * afterwards it verifies the resulting coordinates are finite, recomputing a sane on-screen
 * position if not.
 *
 * Soft dependency: no-op when the module is absent, inactive, or 14.x+ (already fixed upstream).
 */

export function registerMonksCombatDetailsShim() {
  Hooks.once("ready", () => {
    try {
      const module = game.modules.get("monks-combat-details");
      if (!module?.active) return;
      // 14.x and later fixed the underlying bug upstream; leave them alone
      if (foundry.utils.isNewerVersion(module.version, "13.99")) return;
      const MCD = game.MonksCombatDetails;
      if (!MCD || typeof MCD.repositionCombat !== "function") {
        CONFIG.logger.debug("Monk's Combat Details detected but repositionCombat not found; skipping shim");
        return;
      }

      const original = MCD.repositionCombat.bind(MCD);
      MCD.repositionCombat = function (app) {
        try {
          // Feed the original real pixel numbers so its offset math cannot produce NaN
          const el = app?.element;
          if (el) {
            if (!Number.isFinite(app.position.width)) app.position.width = el.offsetWidth || 300;
            if (!Number.isFinite(app.position.height)) app.position.height = el.offsetHeight || 400;
          }
          original(app);
        } catch (err) {
          CONFIG.logger.warn(`Monk's Combat Details reposition shim: original reposition failed (${err.message}); recovering`);
        }
        // Safety net: whatever happened above, land the popout at a finite, on-screen position
        try {
          let { left, top } = app.position;
          if (!Number.isFinite(left) || !Number.isFinite(top)) {
            const sidebar = document.getElementById("ui-right");
            const width = Number.isFinite(app.position.width) ? app.position.width : (app.element?.offsetWidth || 300);
            if (!Number.isFinite(left)) {
              left = Math.max((sidebar?.offsetLeft ?? (window.innerWidth - 320)) - width, 0);
            }
            if (!Number.isFinite(top)) {
              top = sidebar?.offsetTop ?? 70;
            }
          }
          app.setPosition({ left: Math.max(left, 0), top: Math.max(top, 0) });
        } catch (err) {
          CONFIG.logger.warn(`Monk's Combat Details reposition shim: fallback positioning failed (${err.message})`);
        }
      };
      CONFIG.logger.info("Applied Monk's Combat Details V13 combat tracker popout repositioning shim");
    } catch (err) {
      CONFIG.logger.warn(`Failed to apply Monk's Combat Details shim: ${err}`);
    }
  });
}
