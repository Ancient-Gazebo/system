/**
 * DataModel pre-flight prune scanner  (READ-ONLY — makes no changes)
 * ------------------------------------------------------------------
 * Reports any stored `system` keys that the newly-registered DataModels would
 * prune on the next save, so you can review before committing to the migration.
 *
 * HOW TO RUN
 *   1. Load a COPY of your world with this updated system installed.
 *   2. Create a Script macro (or open the browser console / F12) and paste/run:
 *        game.starwarsffg?.scanDataModelPruning?.() ?? scanDataModelPruning();
 *      (This file auto-registers `scanDataModelPruning` on `window` and, if the
 *       system API object exists, on `game.starwarsffg.scanDataModelPruning`.)
 *   3. Read the console summary. Nothing is written to any document.
 *
 * WHAT IT CHECKS
 *   For every world Actor/Item, each embedded Item on actors, and each synthetic
 *   (unlinked) token actor, it compares the raw stored data (`_source.system`)
 *   against what the registered model represents (`system.toObject()`). Any key
 *   present in storage but absent afterwards would be dropped on the next write.
 *
 *   Dynamic maps (attributes, skills, currency, talent/upgrade trees) are modelled
 *   as ObjectField and preserved wholesale, so they should never appear here.
 */
(function () {
  function collectMissing(source, kept, path, out) {
    if (Array.isArray(source)) return; // arrays preserved by AnyField; not key-pruned
    if (source && typeof source === "object") {
      for (const k of Object.keys(source)) {
        const childPath = path ? `${path}.${k}` : k;
        const keptHas = kept && typeof kept === "object" && !Array.isArray(kept) && (k in kept);
        if (!keptHas) {
          out.push(childPath);
        } else {
          collectMissing(source[k], kept[k], childPath, out);
        }
      }
    }
  }

  function scanDoc(doc, label, results) {
    try {
      const source = doc?._source?.system;
      if (!source || typeof source !== "object") return;
      const kept = doc.system?.toObject ? doc.system.toObject() : null;
      if (!kept) return;
      const missing = [];
      collectMissing(source, kept, "", missing);
      if (missing.length) {
        results.push({ label, type: doc.type, id: doc.id, name: doc.name, pruned: missing });
      }
    } catch (err) {
      results.push({ label, type: doc?.type, id: doc?.id, name: doc?.name, error: String(err) });
    }
  }

  function scanDataModelPruning() {
    const results = [];

    for (const a of game.actors) {
      scanDoc(a, "Actor", results);
      for (const i of a.items) scanDoc(i, "Actor>Item", results);
    }
    for (const i of game.items) scanDoc(i, "Item", results);

    // Unlinked (synthetic) token actors on scenes
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (token.actorLink) continue;
        const ta = token.actor;
        if (!ta) continue;
        scanDoc(ta, `Token@${scene.name}`, results);
        for (const i of ta.items) scanDoc(i, `Token@${scene.name}>Item`, results);
      }
    }

    const withPruning = results.filter((r) => r.pruned?.length);
    const withErrors = results.filter((r) => r.error);

    console.group("%cFFG DataModel prune scan", "font-weight:bold;color:#46c1ff");
    console.log(`Documents flagged with prunable keys: ${withPruning.length}`);
    console.log(`Documents that errored during scan:   ${withErrors.length}`);
    if (withPruning.length) {
      console.table(
        withPruning.map((r) => ({
          where: r.label, type: r.type, name: r.name, id: r.id,
          prunedCount: r.pruned.length, prunedKeys: r.pruned.join(", "),
        }))
      );
    }
    if (withErrors.length) console.warn("Scan errors:", withErrors);
    if (!withPruning.length && !withErrors.length) {
      console.log("%cNo prunable keys found — migration is non-lossy for this world.", "color:#5dd97a");
    }
    console.groupEnd();

    ui.notifications?.info(
      `DataModel scan: ${withPruning.length} document(s) with prunable keys. See console (F12) for details.`
    );
    return results;
  }

  // Expose for easy invocation.
  globalThis.scanDataModelPruning = scanDataModelPruning;
  Hooks?.once?.("ready", () => {
    try {
      game.starwarsffg = game.starwarsffg || {};
      game.starwarsffg.scanDataModelPruning = scanDataModelPruning;
    } catch (e) { /* no-op */ }
  });
})();
