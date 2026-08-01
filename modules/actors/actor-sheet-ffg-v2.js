import { ActorSheetFFG } from "./actor-sheet-ffg.js";

/**
 * @deprecated Collapsed alias of {@link ActorSheetFFG} (V2-full migration).
 * The former V1/V2 actor-sheet split is gone: both names now resolve to the
 * same native ApplicationV2 sheet, and the `v2` class / template / dimensions
 * / tabs / scrollY that used to live here are folded into
 * `ActorSheetFFG.DEFAULT_OPTIONS`.
 *
 * This empty alias is retained so worlds whose actors carry
 * `flags.core.sheetClass === "ffg.ActorSheetFFGV2"` keep resolving without a
 * data migration. Its registration in `swffg-main.js` is kept (without
 * `makeDefault`) for the same reason.
 */
export class ActorSheetFFGV2 extends ActorSheetFFG {}
