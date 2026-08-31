/**
 * On-demand loaders for the vendored libraries in `lib/`.
 *
 * These libraries used to be declared in `system.json` under `esmodules`/`scripts`/`styles`, so
 * every client downloaded and executed all of them during boot - before the loading bar appears -
 * even though each one serves a single window:
 *
 *   - slimselect + datatables (~226 KB js/css) are used ONLY by the Character Creator.
 *   - jszip + jxon (~99 KB)   are used ONLY by the OggDude / SW Adversaries importers, which are
 *                             GM-only and typically run once for the lifetime of a world.
 *
 * On a hosted setup with a cold HTTP cache that is a meaningful share of the blank-screen time at
 * the start of a session, paid by every player on every first load.
 *
 * All four are UMD bundles that publish browser globals (`SlimSelect`, `DataTable`, `JSZip`,
 * `JXON`), so they are injected as classic `<script>` tags rather than imported. That is deliberate
 * and not merely convenient:
 *
 *   - It preserves the exact loading semantics the call sites were written against; nothing had to
 *     change at `new SlimSelect(...)` / `new DataTable(...)` / `JSZip.loadAsync` / `JXON.xmlToJs`.
 *   - `lib/jxon/jxon.min.js` REQUIRES it. Its UMD wrapper ends `})(this, function (e, t) {...})`
 *     and its browser branch is `e.JXON = t(window)`. In a classic script `this` is `window`; in an
 *     ES module `this` is `undefined`, so importing it would throw on `undefined.JXON`. jxon must
 *     never be moved into `esmodules` or loaded with `import()`.
 *
 * Each URL is fetched at most once per client: the in-flight promise is cached and reused, so
 * reopening the Character Creator or the importer costs nothing after the first time.
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

/** @type {?HTMLLinkElement} The most recently inserted vendor stylesheet, used to chain the next. */
let _lastVendorLink = null;

/**
 * Find the `<link>` these vendor stylesheets must be inserted after.
 *
 * Cascade position matters and is easy to get wrong here. While slimselect.css and
 * datatables.min.css were declared in `system.json` they sat at the END of the system's own
 * styles but BEFORE every module stylesheet and before `styles/mandar.css`, which
 * `swffg-main.js` appends at `init` for the mandar theme. Simply appending them to `<head>` on
 * demand would move them past both, letting stock DataTables/SlimSelect rules win over theme and
 * module overrides written to beat them - mandar's `.ss-main` block is exactly that, an
 * equal-specificity rule that only wins on document order.
 *
 * So they are re-inserted where they used to be: immediately after the last of the system's own
 * manifest styles. Later entries in that list are preferred; the fallbacks matter only if that
 * list is ever reordered.
 *
 * @returns {?HTMLLinkElement}
 */
function systemStyleAnchor() {
  for (const style of ["lib/pure/grids-min.css", "styles/swffg-sheet2.css", "styles/starwarsffg.css"]) {
    const link = document.head.querySelector(`link[rel="stylesheet"][href*="starwarsffg/${style}"]`);
    if (link) return link;
  }
  return null;
}

/**
 * Inject a `<link rel="stylesheet">` once and resolve when it has been applied.
 *
 * The promise resolves rather than rejects on error: missing styling degrades a window's
 * appearance, but it should never be the reason the window refuses to open.
 *
 * @param {string} href  System-relative URL of the stylesheet.
 * @returns {Promise<void>}
 */
function loadStylesheet(href) {
  if (_loads.has(href)) return _loads.get(href);

  const load = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => {
      console.warn(`starwarsffg | failed to load stylesheet: ${href}`);
      resolve();
    }, { once: true });

    // Chain off the previous vendor sheet so a batch keeps its declared order.
    const anchor = _lastVendorLink ?? systemStyleAnchor();
    if (anchor) anchor.insertAdjacentElement("afterend", link);
    else document.head.appendChild(link);
    _lastVendorLink = link;
  });

  _loads.set(href, load);
  return load;
}

/**
 * Load slimselect and datatables (scripts + styles) for the Character Creator.
 *
 * Awaited by `CharacterCreator#_onRender` before it constructs any `SlimSelect`/`DataTable`.
 *
 * @returns {Promise<void>}
 */
export async function loadCharacterCreatorLibs() {
  await Promise.all([
    loadScript("systems/starwarsffg/lib/slimselect/slimselect.js", "SlimSelect"),
    loadScript("systems/starwarsffg/lib/datatables/datatables.min.js", "DataTable"),
    loadStylesheet("systems/starwarsffg/lib/slimselect/slimselect.css"),
    loadStylesheet("systems/starwarsffg/lib/datatables/datatables.min.css"),
  ]);
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
