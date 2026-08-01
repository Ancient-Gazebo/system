import { ItemSheetFFG } from "./item-sheet-ffg.js";

/**
 * @deprecated Collapsed alias of {@link ItemSheetFFG} (V2-full migration).
 * The former V1/V2 item-sheet split is gone: both names now resolve to the
 * same native ApplicationV2 sheet, and the `v2` class / initial-tab
 * differences that used to live here are folded into
 * `ItemSheetFFG.DEFAULT_OPTIONS`.
 *
 * This empty alias is retained so that existing worlds whose documents carry
 * `flags.core.sheetClass === "ffg.ItemSheetFFGV2"` keep resolving without a
 * data migration. Its registration in `swffg-main.js` is kept (without
 * `makeDefault`) for the same reason.
 */
export class ItemSheetFFGV2 extends ItemSheetFFG {}
