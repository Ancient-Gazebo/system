# CLAUDE.md — starwarsffg

Guidance for AI assistants (Claude Code) working in this repository. Read this
before editing.

## What this is

`starwarsffg` — the **Star Wars FFG** game system for **Foundry VTT**
(`system.json`: id `starwarsffg`, version `2.1.0`, compatibility minimum 13 /
verified 14 — it runs on **both V13 and V14**). This is a maintained fork
descended from Jaxxa's implementation; upstream lives at
`StarWarsFoundryVTT/StarWarsFFG`.

**Version-dependent behaviour is feature-detected at runtime**
(`game.release.generation >= 14`), never branched at build time, so one build
serves both generations. Follow that pattern for anything V14 renamed or removed
(`messageMode`/`applyMode` vs `rollMode`/`applyRollMode`, `applyOperators` vs
`performDeletions`, ActiveEffect change `type` vs `mode`, ...). Reading a
deprecated accessor logs a warning even when you do not use the value, so prefer
`_source` / short-circuits (`c.type ?? c.mode`) over touching it.

The whole tree ships to end users as the installed system, so runtime assets
(`lib/`, `images/`, `fonts/`, compiled `styles/*.css`) are all version-controlled
on purpose — they are not build output to be regenerated.

## Repository layout

- `modules/` — all system JavaScript (ES modules, no bundler).
  - `swffg-main.js` — **primary entry point**; the `init` hook registers config,
    sheets, and DataModels. `dice-pool-ffg.js` is also loaded directly.
  - `actors/`, `items/` — Actor/Item documents and their sheets.
  - `apps/` — the ApplicationV2 bases every window is built on:
    `ffg-document-sheet.js` (actor/item sheets; bridges the legacy `getData` /
    `activateListeners` style onto `_prepareContext` / `_onRender`, and owns the
    submit pipeline, inline ProseMirror editors, tabs and drag/drop),
    `ffg-actor-sheet.js` (actor layer: drops, token controls) and
    `ffg-form-application.js` (settings/importer/editor windows, plus
    `executeInlineScripts`).
  - `datamodels/` — DataModels for every actor/item subtype. **Auto-generated
    from `template.json`; do not hand-edit** (see that folder's README.md).
  - `active-effects/active-effect-ffg.js` — `ActiveEffectFFG`, the customized
    Active Effects pipeline (suppression + apply overrides feed the dice pool).
  - `helpers/`, `apps/`, `config/`, `importer/` (OggDude/SWA import),
    `integrations/`, `settings/`, `tokens/`, `dice/`.
- `templates/` — Handlebars (`.html`) templates for sheets, chat, dialogs.
- `lib/` — **vendored** third-party libs referenced directly by `system.json`
  (slimselect, datatables, jszip, jxon, pure, `@swrpg-online`). Treat as
  read-only; do not edit or "clean up" — Foundry loads these paths verbatim.
- `styles/` — compiled CSS checked in as-is (no SCSS sources in this tree).
- `tools/datamodel-prune-scan.js` — read-only diagnostic (`scanDataModelPruning()`).
- `lang/` — localization JSON.
- `template.json` — schema-only type lists (field defs now live in DataModels).
  `template.full.json.bak` is the preserved pre-migration template for rollback.

## Editing conventions

**Validate every JS change with acorn before considering it done:**
```bash
npx acorn --ecma2022 --module <file.js> > /dev/null
```
Parsing is necessary but **not sufficient**: an import accidentally placed inside
a header comment still parses, while the class below it extends an undefined
identifier and aborts system init. After structural edits, also confirm every
`class X extends Y` resolves to an import or a local declaration.
A silent exit means it parses. This is the required syntax gate — a single bad
`str_replace` (e.g. deleting a JSDoc comment boundary) has previously produced a
blank character sheet at runtime, which acorn would have caught immediately.

This check also runs automatically as a pre-commit hook (`hooks/pre-commit`,
activated via `git config core.hooksPath hooks`): commits with a JS syntax error
are blocked. Don't rely on it as a substitute for validating your own edits.

Lint (config permitting):
```bash
npx eslint modules
```

- No build step is required to load the system; edited `.js`/`.html`/`.css` are
  used directly. (`package.json` references gulp for SCSS, but no SCSS/gulpfile
  ships in this tree.)
- Match the existing style of the file you're in; prefer small, surgical diffs.

## Gotchas that have bitten this codebase before

- **DataModel schema pruning.** Foundry prunes any `system.*` path not declared
  in the DataModel on the next save. If a value must persist, the schema needs a
  matching `SchemaField`/`ObjectField` declaration. Dynamic maps (attributes,
  skills, currency, talent/upgrade trees) use `ObjectField` precisely so
  arbitrary keys survive. Run `scanDataModelPruning()` on a **copy** of a world
  before trusting a schema change.
- **DataModels are generated, not hand-written.** Regenerate from `template.json`
  rather than editing `datamodels/*.js` directly, or the schema and the historical
  data shapes drift apart.
- **Active Effects → dice pool.** Modifier math must account for AE modifiers
  (e.g. characteristic-based weapon damage, suppression of gear effects). Changes
  to `ActiveEffectFFG` ripple into damage, dice pools, and derived stats — test
  those paths together.
- **ApplicationV2 everywhere.** There is no V1 path left: sheets extend the
  `apps/` bases, dialogs are `DialogV2`. `ActorSheetFFGV2` / `ItemSheetFFGV2` /
  `AdversarySheetFFGV2` are deprecated empty aliases kept only so existing
  `flags.core.sheetClass` values resolve — do not add behaviour to them.
- **The V2 render pipeline assigns `innerHTML`, which never runs inline
  `<script>` in a template.** Several dialogs used to wire themselves that way;
  wire listeners in JS (or call `executeInlineScripts`) instead.
- **`render` intent is explicit.** V1 re-rendered on every submit; the V2
  pipeline threads a `render` flag through `_onSubmit` → `_updateObject` →
  `document.update`. Anything shown that is computed in `getData` goes stale
  without it. Prefer a targeted DOM update for hot paths (see
  `ActorSheetFFG.computeVitalTrack` / `_paintVitalTrack`, shared with `getData`
  so the two cannot drift).
- **Never read `game.*` at module scope.** Modules are imported before `game` is
  populated; a module-level `game.release`/`game.settings` read throws during
  init and takes the whole system down. Evaluate lazily inside a function.
- **`system.experience.available` is the BASE value.** Purchases subtract from it
  via Active Effects, so it is not what the XP box shows. Edit mode suspends
  those effects, so reading it there is base too. XP log entries record the
  *effective* value — derive from the newest log entry, not the field.
- **Never edit `lib/`.** It's vendored and shipped; fixes belong in `modules/`,
  not in third-party code.

## Testing

There is no headless unit suite that must pass; validation is runtime in Foundry.
For schema/data changes, exercise on a **copy** of a world: open a character,
minion, vehicle, and homestead; add a custom skill and a free-form modifier;
save, reload, and confirm nothing blanks out (the checklist in
`modules/datamodels/README.md` is the reference).

## Commits

- Keep commits focused; describe the bug/behavior, not just the file touched.
- Files are normalized to LF via `.gitattributes`; don't fight it.
