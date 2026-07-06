# Star Wars FFG — DataModel layer

This folder adds faithful Foundry V13 DataModels for every Actor and Item subtype.

## Files
- `actor-models.js` — `AnyField`, the shared `FFGTypeModel` base, and the 6 actor models.
- `item-models.js` — the 20 item models.
- `index.js` — `FFG_ACTOR_DATAMODELS` / `FFG_ITEM_DATAMODELS` registration maps.

All three are **auto-generated** from `template.json`. Do not hand-edit; regenerate
instead so the schemas stay a field-for-field mirror of the historical shapes.

## How it's wired
`modules/swffg-main.js` (init hook) sets:
```js
CONFIG.Actor.dataModels = foundry.utils.mergeObject(CONFIG.Actor.dataModels ?? {}, FFG_ACTOR_DATAMODELS);
CONFIG.Item.dataModels  = foundry.utils.mergeObject(CONFIG.Item.dataModels  ?? {}, FFG_ITEM_DATAMODELS);
```
To revert, remove those two lines and the import. (Reverting only restores behaviour
for future saves; keys already pruned by a save are not recovered — hence: test on a copy.)

## Design
- Fixed structures → typed `SchemaField` / `NumberField` / `StringField` / `BooleanField`.
- Dynamic maps (`attributes`, `skills`, `currency`, and the talent/upgrade trees) → `ObjectField`,
  so arbitrary keys are preserved rather than dropped.
- Free-form arrays → `ArrayField(new AnyField())` (pass-through element, nothing dropped).
- Numeric fields are nullable and clean numeric strings automatically.
- `FFGTypeModel.migrateData` defensively coerces any top-level ObjectField value that
  loaded as null/array/primitive back to `{}` so legacy data can't break cleaning.

## Before you trust it — test on a COPY of a world
1. Open a character, minion, vehicle, and homestead; confirm fields render and nothing blanks out.
2. Add a custom skill and a free-form attribute modifier; save; reload; confirm both persist.
3. Open a weapon/armour and a specialization with a populated talent tree; confirm qualities,
   attachments, and talent linkages persist.
4. Run the OggDude/SWA importer for one item and one actor.
5. Confirm the crafting module still creates items, and Active Effects targeting
   `system.attributes.*` / Mystic Alignment thresholds still apply.
6. Watch the console at world load for any deprecation notice about template.json + dataModels.

## Pre-flight prune scan (read-only)
`tools/datamodel-prune-scan.js` reports any stored keys the models would prune on next save.
Run it from a Script macro or the console:
```js
scanDataModelPruning();
```
A clean world reports zero prunable keys.

## template.json is now schema-only (single source of truth)
`template.json` carries only the type lists; all field definitions live in the
DataModels. The importer's `ImportHelpers.getTemplate(type)` builds blank items
from the registered model rather than reading template.json fields. The original
full template is preserved as `template.full.json.bak` for reference / rollback
(to revert: restore it over `template.json` and revert the `getTemplate` change).
