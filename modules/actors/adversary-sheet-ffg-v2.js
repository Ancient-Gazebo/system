import { AdversarySheetFFG } from "./adversary-sheet-ffg.js";

/**
 * @deprecated Collapsed alias of {@link AdversarySheetFFG} (V2-full migration).
 * Retained so worlds whose actors carry
 * `flags.core.sheetClass === "ffg.AdversarySheetFFGV2"` keep resolving without
 * a data migration. Registered in `swffg-main.js` without `makeDefault`.
 */
export class AdversarySheetFFGV2 extends AdversarySheetFFG {}
