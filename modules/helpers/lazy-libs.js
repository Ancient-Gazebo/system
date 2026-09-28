/**
 * On-demand loaders for the vendored libraries in `lib/`.
 *
 * These libraries used to be declared in `system.json` under `esmodules`/`scripts`/`styles`, so
 * every client downloaded and executed all of them during boot - before the loading bar appears -
 * even though each one serves a single window. jszip + jxon (~99 KB) are used ONLY by the
 * OggDude / SW Adversaries importers, which are GM-only and typically run once for the lifetime of
 * a world. (slimselect and datatables served only the removed Character Creator and are no longer
 * loaded at all.)
 *
 * On a hosted setup with a cold HTTP cache that is a meaningful share of the blank-screen time at
 * the start of a session, paid by every player on every first load.
 *
 * Both are UMD bundles that publish browser globals (`JSZip`, `JXON`), so they are injected as
 * classic `<script>` tags rather than imported. That is deliberate and not merely convenient:
 *
 *   - It preserves the exact loading semantics the call sites were written against; nothing had to
 *     change at `JSZip.loadAsync` / `JXON.xmlToJs`.
 *   - `lib/jxon/jxon.min.js` REQUIRES it. Its UMD wrapper ends `})(this, function (e, t) {...})`
 *     and its browser branch is `e.JXON = t(window)`. In a classic script `this` is `window`; in an
 *     ES module `this` is `undefined`, so importing it would throw on `undefined.JXON`. jxon must
 *     never be moved into `esmodules` or loaded with `import()`.
 *
 * Each URL is fetched at most once per client: the in-flight promise is cached and reused, so
 * reopening the importer costs nothing after the first time.
 */

/** @type {Map<string, Promise<void>>} Cached loads, keyed by URL. */
const _loads = new Map();

/**
 * Inject a classic `<script>` once and resolve when it has executed.
 *
 * @param {string} src            System-relative URL of the script.
 * @param {string} [globalName]   Global the bundle publishes. When it is already present the
 *                                script is assumed to be loaded (e.g. by a module) and is skipped.
 * @returns {Promise<void>}
 */
function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return Promise.resolve();
  if (_loads.has(src)) return _loads.get(src);

  const load = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = src;
    script.async = false; // preserve execution order across a batch of loads
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
    document.head.appendChild(script);
  });

  // A failed load must not be cached, or a transient network error would permanently disable the
  // feature for the rest of the session with no way to retry short of a reload.
  load.catch(() => _loads.delete(src));
  _loads.set(src, load);
  return load;
}

/**
 * Load jszip and jxon for the OggDude / SW Adversaries importers.
 *
 * Awaited at each importer entry point that touches `JSZip` or `JXON`. The XML helpers deeper in
 * the import (`ImportHelpers.getAttributeObject`, the per-type importers under
 * `importer/oggdude/importers/`) are synchronous and are only ever reached through one of those
 * entry points, so they need no loader of their own.
 *
 * @returns {Promise<void>}
 */
export async function loadImporterLibs() {
  await Promise.all([
    loadScript("systems/starwarsffg/lib/jszip/jszip.min.js", "JSZip"),
    loadScript("systems/starwarsffg/lib/jxon/jxon.min.js", "JXON"),
  ]);
}
