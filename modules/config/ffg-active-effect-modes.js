/**
 * Pre-V14 numeric ActiveEffect change modes, mirrored locally.
 *
 * V14 deprecated direct access to `CONST.ACTIVE_EFFECT_MODES`: it is now a Proxy
 * that logs a compatibility warning on every property read, in favour of the new
 * string change types (`CONST.ACTIVE_EFFECT_CHANGE_TYPES`, removed-support in V16).
 * V14 still accepts the legacy numeric `mode` field on effect changes and migrates
 * it internally, and this system's effect read/write logic (EffectHelpers.MODES,
 * the modifier helpers, and the ~45 change definitions) is built on these numeric
 * modes. So we keep the exact pre-V14 values and simply stop touching the
 * deprecated global — behaviour is byte-identical on V13 and V14, but the warning
 * is gone.
 *
 * Values match `CONST.ACTIVE_EFFECT_MODES` exactly (CUSTOM:0 … OVERRIDE:5). This
 * file intentionally has no imports so it is safe to pull into static class
 * initializers (e.g. EffectHelpers) without circular-dependency risk.
 */
export const AE_MODES = Object.freeze({
  CUSTOM: 0,
  MULTIPLY: 1,
  ADD: 2,
  DOWNGRADE: 3,
  UPGRADE: 4,
  OVERRIDE: 5,
});
