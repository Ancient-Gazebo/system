`2.1.x` - Foundry V14 migration
* This build runs on **Foundry V14** (`compatibility.verified: 14`) while remaining
  compatible with V13 (`minimum: 13`). Version-dependent behaviour is feature-detected
  at runtime rather than branched at build time, so one build serves both.
* Application framework: every window is now native ApplicationV2. The actor, item and
  adversary sheets run on shared `FFGDocumentSheet` / `FFGActorSheet` bases (which bridge
  the existing `getData` / `activateListeners` code), the ~13 settings, importer, editor
  and roller windows on `FFGFormApplication`, and all 36 dialogs on DialogV2. The V1/V2
  sheet split was collapsed - `ActorSheetFFGV2` / `ItemSheetFFGV2` / `AdversarySheetFFGV2`
  remain as deprecated aliases so existing `flags.core.sheetClass` assignments keep working.
* V14 removals and renames handled: ActiveEffect `duration` schema (a malformed core
  duration previously aborted every effect-bearing item create), `TokenDocument#effects`
  and `#overlayEffect`, `ActiveEffect#icon`, numeric change `#mode`, `CHAT_MESSAGE_TYPES`,
  the `renderChatMessage` hook, `rollMode`/`applyRollMode` (now `messageMode`/`applyMode`),
  `mergeObject`'s `performDeletions` option, and bare `randomID` / `mergeObject` /
  `AudioHelper` / `FilePicker` globals.
* Fixes surfaced by the migration:
  * Dice-status durations (Boost/Setback Next Check, per-combat statuses) moved from
    `system.duration` to flags - V14's strict effect model silently stripped the former,
    which would have stopped those statuses being consumed.
  * `ActiveEffectFFG.getStackCount` no longer throws on worlds without the Status Icon
    Counters module (this also affected V13).
  * Templates that wired themselves with an inline `<script>` (crew, currency and language
    settings, initiative) work again - the V2 pipeline assigns innerHTML, which never runs
    inline scripts; the initiative dice-pool inputs are now wired in JS.
  * XP refunds record the effective (sheet-visible) available XP in the log across all five
    refund paths, instead of the base value that Active Effects modify.
  * Manually typed values refresh whatever derives from them (damage track, minion alive
    counts and group-skill ranks); the damage track repaints locally so frequent edits do
    not pay for a full sheet render.
  * Roll-simulation setback dice were being dropped (`setBackDice` vs `setbackDice`).
* Installing as a separate system id offers a one-time import of a duplicated world's
  flags and settings from the original id (`game.ffg.migrateLegacyScope()`).

`3.0.5`
* Fixes:
  * Buying several of an item from a Stylish Shop gives the buyer that many. Stylish Shop looked for item quantity at `system.quantity`, which in this system holds the quantity's fields rather than the number, so every multi-unit purchase arrived as a single item. Bought items also never stacked with ones already owned, and item requirements counted each stack as 1. When the GM loads the world, the system now sets Stylish Shop's Item Quantity Path to `system.quantity.value`, unless a GM has already chosen a different path there.

`3.0.4`
* Fixes:
  * The Character Pilot's Claim Slot button claims for the character the panel is open on. It used to claim for whichever token was selected on the canvas, so a GM piloting one character with another's token selected claimed for the wrong one, or was refused for the wrong disposition.
  * Knockdown's extra advantage for larger targets now applies. Only vehicles record a silhouette, so for everything else the target's token size stands in for it (a 2x2 token counts as silhouette 2), and the option says so when it raises the price.

`3.0.3`
* Fixes:
  * Strain from the table tools follows the actor that takes it. Minions and rivals (and a nemesis or character whose Strain Threshold is switched off) have no strain track: strain they suffer - Suffer Strain in Spend Results, the Stun quality, the Character Pilot's second maneuver, the GM's target tools - is now taken as wounds instead of being written to a track nothing reads, and Recover Strain is shown as unavailable rather than charging advantage for nothing. Apply Damage treats a nemesis without a strain threshold the same way.
  * A quality is recognised by its whole name, not its first word, so "Stun Setting" is no longer offered as a Stun activation in Spend Results.
  * The Character Pilot lists an adversary's weapons even though NPC weapons are never flagged as equipped.
  * The Combat Carousel sits below anything another module pins to the top of the screen (Simple Timekeeping & Calendar's bar) instead of over it.

`3.0.2`
* Enhancements:
  * Added a set of table tools, each with its own switch under Configure Settings -> Table Tools:
    * Roll Request. A new button in the GM's token controls asks one or more online players for a skill check: pick the players, the skill, the difficulty, upgrades, boost, setback and the roll's visibility. Each player gets a pop-up and a whispered chat card, and rolls through the normal roll dialog with their own character's ranks and modifiers (`game.ffg.RollRequestApp.open()`).
    * Spend Results. Roll cards show the advantage, threat, triumph and despair still unspent, with a Spend button. The dialog offers the combat table during an encounter and a shorter general table otherwise, the weapon's active qualities when the roll was an attack, and any options the GM has added (Configure Settings -> Spend Results Options). Spending is recorded on the roll and announced in chat, and mechanical effects are applied: strain recovered or suffered, a boost / setback / upgrade on someone's next check, Prone, and the weapon-quality conditions. Players spend advantage and triumph; threat and despair are the GM's.
    * Weapon quality automation. Cumbersome adds its difficulty when the wielder's Brawn falls short, Auto-fire is a tick box in the roll dialog, and the active qualities (Auto-fire, Linked, Blast, Burn, Concussive, Disorient, Ensnare, Guided, Knockdown, Stun, Sunder) can be triggered from Spend Results. Extra hits from Auto-fire and Linked pre-fill the Hits field of Apply Damage, which also opens on strain for a Stun Damage weapon and on system strain for an Ion weapon against a vehicle. Qualities that only make sense against a body are not offered against a vehicle.
    * Character Pilot. A panel (token controls or Token HUD) that tracks a character's action and maneuvers for the turn and puts Aim, Guarded Stance, Take Cover, Stand Up, Assist, Draw / Holster, weapon attacks and End Turn one click away, with GM tools for the targeted token (`game.ffg.CharacterPilot.open()`).
    * Combat Carousel. The round's initiative slots as a strip along the top of the canvas, with a Claim button on the open slot. Each user can collapse it.
  * Additional Defence Skills (Configure Settings): any skill can be set to face a target's Melee or Ranged Defence when it is rolled with a token targeted, for Force power skills and custom combat skills.
  * "Next Check" statuses now stack without any module: a second Boost Next Check raises a count on the existing status instead of being lost. With Status Icon Counters installed the count is the module's own badge.
  * New Cover (+1 ranged defence) and Guarded Stance (+1 melee defence, a setback on the character's own combat checks) statuses.
  * Items can be given from an inventory row's right-click menu ("Give to..."), and the recipient list puts the characters of players who are online first. The handshake button on inventory rows can be hidden per actor with the new "Show Trade Icon" sheet option.
* Fixes:
  * A stacked item's inventory row holds four controls (split, give, edit, delete), which did not fit the actions column, so that row's quantity and equipped columns sat out from under their headers. The column is now wide enough whenever the give control is shown.

`3.0.1`
* Enhancements:
  * The Armour list on the Combat tab can be organized into named, collapsible tabs with drag-and-drop ordering, the same way the Gear, Weapons, Talents and Abilities lists can (the folder icon in the list header). Each list keeps its own tabs.

`3.0.0`
* Enhancements:
  * A modified weapon or armour value in the equipment lists now shows where it came from. Hovering damage, critical, range, defence, soak or hardpoints lists each contribution - the item's own modifiers, its qualities, its attachments, the characteristic added to damage and any Skill Damage - on character, NPC, adversary and vehicle sheets.
  * Vehicle weapons can be dragged from one vehicle's sheet onto another's to copy them there, the same way weapons, armour and gear are copied between characters (the original stays put). Dropping one on a character is refused.
  * Item stacks can now be split. A divide button appears on any weapon, armour, gear, or cargo/storage row holding more than one, opening a dialog to peel off part of the stack (e.g. 7 stimpacks into 4 + 3) as a new sibling stack in the same inventory.
  * Players can now trade items directly. A "give" (handshake) button on weapon, armour, and gear rows lets a character send the item to another character; if the recipient is owned by another online player they get an accept/decline prompt and the hand-off happens peer-to-peer with no GM action required (falling back to the active GM for offline recipients or NPC/loot actors). Plain gear merges into a matching stack on arrival; weapons, armour, and customised/equipped items stay as distinct rows.
  * Ship and homestead cargo rows gained a "take" button to withdraw a chosen quantity into one of your characters, splitting the cargo stack as needed (relayed through the active GM when the cargo actor is GM-owned).
  * Stackable weapons (grenades, charges, spare power packs, etc.) can now have their quantity tracked from the inventory list. A new "Stackable (track quantity)" toggle in a weapon's Sheet Options adds an inline quantity +/- control to its weapon row; the column also appears automatically for any weapon whose count is already above 1. Encumbrance already scaled by weapon quantity, so counts now contribute correctly without opening the item sheet. The same toggle and inline quantity column are available for vehicle weapons (missiles, torpedoes, and other limited-count mounts) on the vehicle sheet.
  * Deleting an item from an actor sheet now asks for confirmation first, so an accidental click on the trash icon no longer instantly removes it. This can be turned off per-user via the new "Confirm item deletion" client setting.
  * Added a built-in Critical Injury / Critical Hit roller. Launch it from the "Roll Critical" button in the Items sidebar or the Destiny Tracker GM menu (or call `game.ffg.CriticalRollerFFG.launch()`). It populates results from world Item folders (or compendium packs) of `criticalinjury` / `criticaldamage` items, queries the user for the relevant modifiers (+10 per existing critical, +10 per rank of Lethal Blows, -10 per rank of Durable, +10 per Critical-rating activation, plus a free flat field), rolls 1d100 with those modifiers, and posts the matched critical to chat. Supports rolling two results and choosing between them. The roller does not apply results to actors.
  * Talents and Abilities gained the same "+" control the weapon, armour and gear lists have, adding a blank talent or ability to the sheet to be configured from its own item sheet.
  * The OggDude importer gained a "Skip Superseded Originals" option, on by default. A reworked data set cannot delete the stock specialization or Force power it replaces, only shadow it, so both used to be imported. A stock specialization is now skipped when no career still lists it and it is not universal, and a stock Force power when an authored power of the same name exists; talents and signature abilities are never filtered. On an unmodified data set every stock specialization is still on a career, so the option changes nothing.
  * Stealth is offered alongside Vigilance and Cool in the initiative dialog without having to be flagged "use for initiative" on each actor. A baseline skill is skipped for any actor whose skill list does not define it.
* Fixes:
  * Rolling a weapon sometimes rolled the bare skill instead of the attack (no weapon name, damage or crit on the card). The row was resolved by counting parent elements up from the click target, and a weapon row nests a second `.roll-button` inside the first, so a click that landed on the wrapper rather than the icon - its right margin, or the strip above and below the icon - resolved one level too high and dropped the weapon.
  * The Adversary rank badge no longer shrinks to a speck on large tokens. It was sized from the grid alone, so a 4x4 token got the same 1x1 badge (10% of its width instead of 42%); it now scales with the token's own footprint. Seven or more ranks drew no badge at all, because the clamp to the six shipped images ran after the filename was built. The badge is also cleared again when the setting is turned off or the ranks are removed, instead of being left painted on the token.
  * A second client editing wounds or strain no longer has the change reverted. Those fields are saved with the re-render suppressed so the damage track can repaint locally, but that option is broadcast and suppressed the re-render everywhere - leaving any other open copy of the sheet showing the old number, which submit-on-close then wrote back over the change (the token bar snapping back with it). Remote clients now re-sync those inputs, skipping any field being typed into.
  * Imported armour gave no soak or defence when worn, and imported careers and specializations granted no (or only some) career skills. The OggDude importer copied those stats into the item's (inherent) Active Effect after a fixed 50ms wait for the effect to be created, and silently skipped it whenever it lost that race - 99 of 112 armours and most careers/specializations in an imported compendium. The importer now waits for the effect; items heal themselves as they are dragged out of a compendium or have those stats edited by any means; and a migration (also `game.ffg.repairInherentStatEffects()`, which lists every item it changes in the console) repairs world items and items owned by player characters. Adversaries are deliberately left alone - their soak, defence and skills come from a stat block that already includes their gear, and the adversary importer leaves these effects at zero so armour is not counted twice. Repaired armour that is not equipped is switched off, so armour that was never worn cannot start adding soak.
  * Actor sheets returned nothing from `render()`, so `await actor.sheet.render(true)` resumed before the sheet existed, and an update-driven refresh landing within 100ms could swallow the render that was opening the sheet. Calls are now merged into one render and every caller gets the rendered sheet.
  * Closing a species, career or specialization sheet without changing anything wrote its (inherent) effect twice, every time, and a species briefly stored thresholds short by its own Brawn/Willpower in between. Effect writes on item save are now skipped when nothing differs.
  * The first open of a gear, armour, weapon or actor sheet no longer writes an empty options flag (several racing writes, including for players on their own items).
  * Removing a combatant from an encounter other than the one currently viewed did nothing, and creating a new encounter threw an error per combatant; both used the viewed encounter instead of the combatant's own. The removal handler can also no longer be left switched off by a delete that fails.
  * The skills list importer reloads the page after an import or reset again.
  * An item sheet that re-rendered while its window had no size (a hidden or minimised tab reports 0x0) remembered a width of 0 and then threw "'set' on proxy: trap returned falsish for property 'width'" on every later open until a reload - and because weapon chat cards built the whole sheet just to summarise qualities, those cards failed to render too. Sheets now only remember real sizes, and chat cards summarise qualities directly.
  * The actor item rules (one species and one career per character, critical damage only on vehicles, and so on) were registered by the first actor sheet opened, and only if no module had hooked item creation first - so in some worlds they never applied, and before anyone opened a sheet they did not apply either. They are now registered once at load.
  * Initiative could not be rolled for a combatant without a token, nor by anyone playing with the game canvas disabled (the roll silently did nothing), and the dialog title could read "Rolling Initiative undefined".
  * Data preparation is roughly twice as fast: item descriptions are rendered for display only when a sheet shows them, instead of for every item on every preparation. Minion and adversary token badges are no longer rebuilt on every frame of token movement.
  * XP purchases and refunds are much faster. Every talent, Force power upgrade, signature ability, item purchase, refund and XP grant used to switch the actor into edit mode and back just to read the base available XP, which disabled and then re-enabled every Active Effect on the actor and its items - 26 to 60 database writes and as many sheet re-renders per purchase. The base value is now read straight from the stored data: a tree purchase or refund takes 4 writes.
  * Swapping a character's species no longer wipes out their spent XP. Removing the old species subtracted its starting XP from the *effective* available XP (after purchases) and stored the result as the base, so every purchase was deducted a second time - replacing a 175 XP species with a 95 XP one on a character with 235 XP spent left them at -25 available instead of 210.
  * Attachment modifications that affect the character now apply. Attachments dropped from an OggDude import carry their modifiers but no Active Effects, so, for example, a Portable Plasma Shield gave no melee defence and Custom Fit removed no setback. Missing effects are now built when an attachment is installed; the 2.1.39 migration (and `game.ffg.repairInherentStatEffects()`) builds them for attachments already on world items and player characters' items, switched off unless the item is equipped and the modification active.
  * Equipping armour or a weapon no longer switches on the effects of optional modifications that were never installed: only the first modification of the first attachment was ever checked.
  * An attachment refused for lack of hardpoints no longer applies its modifiers anyway.
  * An item created and equipped in one go (by a macro, a module, or a quick click after a drop) could end up equipped but applying none of its modifiers. The drop handler and the equip handler each synced the item's effects across several awaited writes and ran side by side, so a stale "unequipped" write could land last. Effect syncs for an item now run one at a time against its current state.
  * Deleting a quality from an attachment that also has hidden modifications (such as the Actuating Module's two Damage +1 entries) deleted the wrong entry. The qualities list is a merged summary, so its row position was never an index into the modifications; the row is now matched by name.
  * [ROLL] tags in an owned item's description threw an error instead of rolling.
  * The Force power and signature ability purchase lists showed every entry twice when the world held a copy of a compendium item; the world copy is now listed once. Signature abilities also no longer treat an imported "false" tree node as learned.
  * Renaming a quality that is also one of an attachment's modifications (such as an imported "Unique Mod") no longer throws "Cannot convert undefined or null to object" and leaves the old name in place. Every save in an attachment's Modifications tab rebuilt its modifications from the form fields alone, dropping each one's id, type and Type setting - and, for a modification with no modifiers, its modifier list altogether, which the quality editor then choked on. The tab now keeps what its form does not show, and saving an entry it already stripped repairs it. The editor's window title also follows a rename instead of keeping the old name.
  * A typo in the Custom Status Effects setting no longer takes the whole system down. The warning for invalid JSON was raised during init, before notifications exist, which threw out of the error handler and aborted the rest of init - sheet registration included. The bad statuses are now skipped and the warning appears once the world has loaded.
  * The OggDude importer no longer empties career descriptions. Careers stripped the first line of the description twice, and whenever a later section header existed the second pass wiped everything. All importers now share one clean-up that drops only a leading name header ([H3] or [H4]) and leaves every other description exactly as the data set wrote it; a one-line weapon, vehicle or attachment description is no longer thrown away, armour loses the duplicated name header the other equipment already lost, and a paragraph break the old code happened to collapse is kept.
  * Imported specializations keep their category tags (they were written to a field that no longer exists and silently dropped), and source entries written as plain text (`<Source>User Data</Source>`) or as sibling `<Source>` elements are imported instead of discarded.
  * An imported vehicle attachment now costs the hardpoints its data names; it cost none until someone opened and saved it.
  * Weapon range adds up every modifier that changes it - its own, its qualities' and its attachments' - instead of only the last one, and an unrecognised base range is no longer snapped to the first band by an unrelated modifier. Remaining hardpoints count the ones granted by mods and attachments. A quality brought by an attachment shows all of its ranks rather than one, a soak quality on armour shows in the armour's own soak, and a modifier set directly on an unowned weapon or armour shows in the values on its own sheet. (Display only: owned items, rolls and character totals are unchanged.)
  * A weapon or armour quality with more than one rank now scales every change of its Active Effect (Defence, for one, covers both melee and ranged; only melee was scaled), and by the quality's own rank - it previously also counted the ranks of same-named modifications on attachments, which carry their own effects.
  * Removing a combatant no longer drops initiative claims. Its own claim was found by reading the tracker's rendered rows, so with the tracker not on screen it was missed: the claim was left pointing at a deleted combatant, and a claim someone else held on the removed combatant's slot was lost instead of moving to the replacement slot. Both are now read from the encounter's claim data.
  * "Remove Last Slot" keeps a claim on the last slot with whoever made it (it used to hand the replacement slot to itself), builds a generic replacement when the last slot was a generic one (an actor-less slot had no side, and the tracker skipped it), and no longer rolls the encounter into the next round when the turn was on the last slot - which also left that round's claims behind.
  * Talents, specializations and signature abilities dropped onto a specialization, career or species sheet land on the sheet they were dropped on. With two sheets of the same type open, drops went to the first one opened.
  * Buying a Signature Ability for a character with no career says a career is needed, instead of failing with a console error.
  * Dragging an owned weapon onto the hotbar makes an "Attack with" macro again (it threw on an undefined variable), and core no longer builds a second macro for a drop the system has already handled.
  * The "Base Ability" label on a signature ability sheet stops short of the header buttons instead of running underneath them, and hidden button labels on Force power, signature ability and specialization trees no longer catch clicks.
  * Upgrade descriptions on Force power and signature ability sheets stop above the cost and the purchase/settings icons at the foot of each box (they scroll) instead of running under them, and the basic power's cost has a line of its own.
  * Installing an attachment checks the hardpoints the item has LEFT, not its total, so an item can no longer take on more attachments than it has room for.
  * Rolling initiative for a vehicle works with a world's own crew roles. Only a role named exactly "Pilot" was looked for, so with roles such as "Driver / Pilot" or "Space Pilot" the vehicle's own data (which has no skills) was used and the roll threw "Cannot read properties of undefined (reading 'Vigilance')". The roll now uses whoever holds the Initiative crew role from the Crew settings, then a "Pilot", then any crew role that uses the vehicle's handling - the one whose skill suits the vehicle (space or planetary) when there are several. A vehicle with none of these says so instead of failing.
  * Base Force powers, signature abilities and specializations bought with the sheet's purchase buttons can be refunded from the XP log, and so can specializations bought by drag-and-drop. Only drag-and-drop Force powers and signature abilities used to carry the refund data, so the rest showed no refund button; purchases already in the log get the button too. A specialization is refunded like the others: its XP comes back and it is removed, but not while any of its talents is still learned.
  * A weapon with no Critical rating (0, shown as "—") no longer gains a rating of 1 as soon as any attachment is installed. The "never below 1" rule was applied once per attachment; it now runs once, after every quality and attachment, and only for weapons that have a rating. This also corrects the rating on the weapon's chat card and the Apply Crit eligibility check.
  * Species created with their characteristics already filled in - every species the OggDude importer makes, and any made by a macro or module - carried their wound and strain thresholds twice, with the wrong values, and a character they were dropped on got roughly double (a wound threshold of 22 instead of 11). They are now built with one change per stat, and a species still carrying the duplicates is rebuilt from its own stats when it lands on a character. Species edited through their sheet were not affected.
  * The species repair (`game.ffg.migrateSpeciesInherentEffects()`) works again. It failed on every species with a ReferenceError and repaired nothing, and on V14 it would have rewritten every species on every run even when nothing had changed.
  * Actor sheets render faster: every render built the sheet's entire context once per skill row - about 35 times - just to draw the skill dice previews.
  * A modifier added to a weapon, armour or gear a character is carrying but has not equipped no longer applies until the item is equipped.
  * Exporting the XP log no longer strips the refund link from skill and characteristic purchases. It deleted each entry's id from the live log, so their refund buttons disappeared - for good once the log was next saved. Importing a file that is not an XP log now reports an error.
  * Picking a sound in the roll dialog for a weapon that had been rolled before no longer stops the roll (saving the sound threw); the sound is remembered on the weapon itself rather than on the actor.
  * The Group Manager's Obligation and Duty tables list the characters' Obligation and Duty items again. They read an old field the data model no longer has, so both tables were empty and every roll reported nothing triggered.
  * Cancelling or closing the initiative dialog no longer leaves whatever asked for the roll waiting forever.
  * Unticking a minion group skill sets its rank to 0 instead of -1 (or a blank), and the stored count of living minions is a whole number.
  * Setting a character's Willpower from a macro or module with a text value ("3") no longer turns the strain threshold into text (a threshold of 10 became "103"), and clearing the Brawn box no longer writes an invalid wound threshold.
  * Opening an actor sheet no longer writes the edit-mode flags every time - two database writes per actor per session, and an error for a player who can only view the actor - and no longer switches off another user's edit mode. An edit mode left behind by a reload is still cleared.
  * Chat messages are re-rendered for dice symbols only when they contain some. This speeds up loading the chat log, and the system no longer throws away listeners other modules add inside a message.
  * A weapon chat card shows an encumbrance, price or rarity that attachments bring down to 0 as 0 rather than the base value.
  * Buying or refunding talents and Force power upgrades works on an unlinked token's actor (its owner was looked up by the scene's id).
  * An item carrying a modifier row with no target (left by the pre-2.1.40 modifications editor) no longer aborts its drop onto an actor, and a quality with no modifiers no longer throws after a weapon or armour save.
  * The OggDude importer labels the Motivations entry properly instead of showing a raw localization key, dice pool tooltips no longer throw on a modifier source they do not recognise, and a player loading a world the GM has not opened since the last update no longer hits an error at the end of loading.
* Removed:
  * The character creation wizard (the Actors-directory button, its window, templates and player-to-GM socket requests), along with the settings only it used: default obligation, duty, morality and credits, maximum rarity, restricted items, and the background, obligation, species, career, motivation and item compendium lists. The specialization, signature ability, Force power and talent compendium settings stay, since the character sheet's purchase buttons use them.

`2.0.3`
* Enhancements:
  * Signature Abilities and their upgrade nodes can now be refunded, matching the existing behavior for Talents, Skills, and Force Powers (refundable from the item tree, the actor sheet, and the XP log; node refunds are blocked when they would orphan a connected upgrade)
  * Strain, Hull Trauma, and System Strain can now be set above the threshold on tokens ([#2177](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2177))
* Fixes:
  * Fixes an issue where edit mode can get stuck on and require a reload to fix ([#2202](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2202))
  * "Rival" and "Nemesis" default images are now swapped (to their appropriate setting!)
  * The PC Wizard no longer spams a trillion temporary actors ([#2183](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2183))
  * The PC Wizard now properly sets starting/total XP and generates entries in the XP log ([#2178](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2178))
  * Fix for Talents granting their modifier when dropped onto a Specialization regardless of learned status ([#2203](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2203))
  * Encumbrance threshold now updates when manual edits to Brawn are applied ([#2197](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2197))
  * Re-importing data without also loading skills no longer automatically fails ([#2196](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2196))
  * Vehicle and Force Power sheet content heights have been corrected - they now use all available space instead of including a large amount of deadspace at the bottom ([#2194](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2194))
  * Character sheets have had their main details block slightly rearranged and had the styling slightly improved ([#2187](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2187))
  * Characteristic mods are now properly created when importing items (requires a re-import to apply) ([#2193](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2193))
  * Characteristic-based weapons now get their base damage correct without having to open/close the item sheet ([#2180](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2180))
  * Fix for Armor Soak mods not applying correctly (note that the mods will need to be re-created for the fix to apply) ([#2191](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2191))
  * Fix for weapons not receiving dice modifiers from Modifiers installed on Attachments ([#2179](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2179))
  * Hide tabs on sheets when a player has a limited view to it ([#2161](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2161))
  * The edit button is no longer shown for talents from specializations (which cannot be edited) ([#2143](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2143))
  * Correct opening Talent information for custom Specializations ([#2144](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2144))
  * Update Mod value for Career Skills to be a checkbox ([#2146](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2146))
  * Obligation/Motiviation headers are no longer smushed ([#2192](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2192))
  * Unscoped CSS in the system is now properly scoped to only impact system assets ([#2190](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2190))

`2.0.2`
* Fixes:
  * the PC wizard now works for non-GMs ([#2165](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2165))

`2.0.1`
* Fixes:
  * Correct armor and weapon encumbrance not applying to actors ([#2159](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2159))

`2.0.0`
* Enhancements:
  * Foundry v13 support!
  * Suppressing AE popups from items equipping
  * Weapons now have an ammo option, fantastic for Grenades and Launchers! ([#1984](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1984))
  * Specializations can now be set as universal via their sheets ([#2028](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2028))
  * Item sources can now be added and removed ([#2028](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2028))
  * Item and actor tags can now be viewed, added, and removed ([#2028](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2028))
    * These tags can be used by macros and will be used by the Enhancements module
  * Expanding talents on actor sheets or sending to chat now displays the long description instead of the short ([#2029](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2029))
  * Added "Active Effects" tab to character sheet ([#2060](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2060))
  * Added the ability to export/import XP log ([#2050](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2050))
  * Allow gear to have modifiers which impact actors ([#2058](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2058))
  * Allow setting images for Force Powers and Signature Abilities ([#2076](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2076))
  * Added a player character creation wizard ([#1974](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1974))
  * Added two tours to explain the system - one for basic sheet use and one for Edit Mode ([#1987](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1987))
  * Specialization, force power, and signature ability pages update the color of connections from learned talents/upgrades ([#2064](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2064))
  * Medical item flag, which allows to do less actions in order to use stimpack/droid patch: increases stimpacks usage, decreases the current healing item's quantity, applies proper amount of healing to actor's current wounds) ([#2113](https://github.com/StarWarsFoundryVTT/StarWarsFFG/pull/2113))
* Notes:
  * The OggDude _Character_ Importer has been retired ([#1988](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1988))
    * The _Data_ importer is still supported and is still recommended to import things like species, specializations, and items
* Fixes:
  * Fix armor adjusted values was not considering all modifiers for soak, defence and encumbrance ([#1991](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1991)
  * Fix species talents/abilities being added/removed by each player online leading to duplicates if GM is online. ([#1832](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1832))
  * Fix for defence not applied during combat checks as setback dice ([#2009](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2009)()
  * Fix for defence mods to distinguish between melee and ranged ([#1985](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1985))
  * Fix uncontrolled active effect messing with actor stats while in Edit Mode - disable any change instead of the base stats ([#1976](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1976))
  * Fix for handling wasn't affecting piloting pool ([#1983](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1983))
  * Fix defence and soak is not applying from armour if created within actor sheet ([#2011](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2011))
  * Fix characteristics not applying damage to item
  * Bump dice simulation library version to bring in a fix where two dice faces were wrong
  * Mods and Modifiers can now target custom skills on actors ([#1973](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1973))
  * Imported species now correctly set Encumbrance without having to open/close them ([#1982](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1982))
  * Fix for inability to add a modifier to a talent after creating it, closing the sheet, and re-opening it ([#1972](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1972))
  * Fix vehicle sheets not opening if skill is missing from assigned crew ([#1978](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1978))
  * Max characteristic setting is now properly enforced when manually editing sheets ([#1994](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1994))
  * Purchasing a talent in a specialization now properly activates any modifiers for tha talent
  * Manually adjusting XP can be submitted with the enter key ([#2036](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2036))
  * Fix for AEs on items dragged onto actors being active despite the item not being equipped ([#2037](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2037))
  * Fix for editing specialization top description not showing current text ([#2041](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2041))
  * the OggDude Dataset importer now uses custom default images if images are not provided ([#2044](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2044))
  * Removed the `Stat All` modifier option, which was a union of `Stat`, `Weapon Stat`, `Vehicle Stat`, and `Amor Stat` ([#1986](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1986))
  * Fix universal specializations costing more XP when purchased via drag-and-drop ([#2057](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2057))
  * Moving items from a token to an actor will no longer remove the item from the parent actor of the token ([#2067](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2067))
  * Fix for Force Power upgrades sometimes being purchasable despite not having enough XP ([#2074](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2074))
  * XP granted by species is now removed if the species is removed ([#2083](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2083))
  * Fix various stats on an actor changing when Edit Mode is enabled and >1 person has the sheet open
  * Removing a species now removes associated Abilities
  * Drag-and-dropping a talent onto an actor in Genesys now prompts to spend XP
  * Macros coming from Compendiums will no longer generate an error and fail to copy
  * Drag-and-dropping items from an actor sheet now preserves Foundry-native information ([#2117](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2117))
  * Qualities on attachments are now properly transferred to items when the attachment is drag-and-dropped to an item ([#2125](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/2125))
  * Popped-out elements are no longer set to max height ([#1714](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1714))

`1.910`
* Fixes:
  * Correct XP manual adjustment bug ([#1948](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1948))
  * The chat Dice Roller now works again ([#1951](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1951))
  * Remove sheet v1 for Actors and items, as it's not being supported and can actively that actor/item ([#1950](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1950))
  * The importer now correctly processes Die modifiers, fixing talents (especially on species) ([#1957](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1957))
    * Note that this requires a re-import of the species and talents
  * Imported Species now apply characteristics to Wounds and Strain thresholds without having to open + close them once ([#1955](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1955))
    * Note that this requires a re-import of the species
  * Vehicle sheets no longer break when a crew member has been deleted ([#1959](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1959))
  * Force Dice Boost now accounts for the full Force Rating ([#1949](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1949))
  * OggDude data imports now default to deleting existing compendiums (most updated import logic relies on the compendiums not existing) ([#1964](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1964))
  * Actor sheets should no longer go wild when manually adjusting XP ([#1954](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1954))
  * Fixed a strange bug where XP would sometimes plummet to -20 and total would become null
  * Custom statuses are no longer defined in the _drawbar function (whoops lol)

`1.909`
* Features:
  * New default images have been added for common items and actors!
    * These images have been commissioned specifically for this system
    * Please check out the artists work if you like the icons! `DistraKit` [on Twitter](https://x.com/DistraKit)
  * Stamina bars now indicate when a threshold has been exceeded! ([#1912](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1912))
  * Force Dice can now be added to the Initiative roller ([#1915](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1915))
  * The Dice Pool window now shows likelihood of success for the roll (this is configurable and defaults to only GMs)
  * You can now define additional status effects to apply via the settings menu ([#1941](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1941))
* Fixes:
  * Vehicle stats can now be edited when edit mode is enabled ([#1896](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1896))
  * Removed the Active Effect from XP Adjustments to make them the same as XP Grants ([#1909](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1909))
  * Encumbrance is now properly calculated as Brawn + 5 ([#1921](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1921))
  * Career Skills from imported Careers and Specializations applies without having to open/close item once ([#1903](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1903))
  * Buying a rank in Brawn now properly increases Soak as well ([#1905](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1905))
  * Adding a Mod to an attachment on a Weapon no longer duplicates the mod ([#1838](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1838))
  * Custom skills can now be set as Career Skills by Careers / Specializations ([#1907](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1907))
  * `Skill Force Dice` modifiers now dynamically read the Force Dice pool (they still accept a number, it's just ignored ([#1890](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1890))
  * GMs granting XP no longer sends available XP plummeting like the younglings who trusted Anakin ([#1899](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1899))
  * Fix for dragging talent onto Specialization not properly persisting the Ranked property ([#1938](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1938))
  * Further improved migration of worlds made before 1.907

`1.908`
* Fixes:
  * Correct several bugs in the world migration code for `1.907`

`1.907`
* Features:
  *  [Active Effects](https://foundryvtt.com/article/active-effects/) have been implemented. This means it's now possible to make changes to actors with status effects - [even custom ones](https://github.com/StarWarsFoundryVTT/StarWarsFFG/wiki/Creating-New-Statuses)!
  * New built-in status effects for single-use boost/setback dice, staggered, disoriented, and staggered
  * End-to-end tests for new functionality are in place. Hopefully, this will reduce bugs going forward ([#1837](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1837))
  * Add Force Power Roll button ([#1827](http://overlord.wrycu.com:12121/game))
  * Added support for universal specializations (requires a re-import of the data) ([#1778](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1778))
  * Noted that Oggdude _character_ importer is deprecated and is likely to result in stat mismatches
  * Career skills now have first-class support and can be set without using modifiers! ([#1861](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1861))
  * some XP purchases made going forward can be refunded ([#1809](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1809))
* Fixes:
  * Talent modifiers on specializations are now properly cleaned up when a new talent overrides an old one
  * Force powers, signature abilities, and specializations now use a unified UI to editing upgrades/talents on their sheets ([#1828](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1828))
  * Dragging a talent onto a specialization now properly copies the state of forceTalent, conflictTalent, and Ranks ([#1805](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1805))
  * Modifier options are now unified: the same options are presented, regardless of actor, mod, or attachment type ([#1800](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1800))
  * Vehicle images are now properly capped at 200 px high ([#1807](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1807))
  * The custom combat tracker now supports using the `secret` token disposition ([#1813](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1813))
  * It's now possible to remove an actor from the custom combat tracker even if no slots have been claimed this round
  * Corrected translations not occurring for Initiative mode and group manager PC list mode ([#1814](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1814))
  * Corrected default item names when created in actors ([#1815](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1815))
  * The crew role update button is now localized ([#1822](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1822))
  * The Popout modifier window now has a scrollbar! You can now see the giant modifier list directly on force powers ([#1824](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1824))
  * Fix for talent send-to-chat not working if the talent came from a specialization ([#1819](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1819))
  * Update "Not enough XP" language to be more generic ([#1820](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1820))
  * A limited subset of qualities now have dice mods created upon import ([#1836](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1836))
  * Actors who roll a `0` for initiative no longer continue to show a prompt to roll initiative ([#1865](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1865))
  * Fix for removing actor before combat starts - the slot is no longer retained as a generic slot and is deleted ([#1864](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1864))
  * Prevent duplicate Hook activation on Actor sheets ([#1818](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1818))

`1.906`
* Features:
  * Compendiums have been migrated back to world compendiums (from system compendiums) ([#1794](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1794))
    * This means they will not be deleted every update _after this one_
    * Once again: **THIS UPDATE WILL DELETE ALL SYSTEM COMPENDIUMS**
  * Attachments now actually work! ([#1215](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1215), [#1768](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1768))
  * Item qualities, upgrades, etc now use tooltips instead of a fake item window when sent to chat
  * You can now adjust token wounds above the threshold ([#1769](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1769))
  * Token bars now display wounds above threshold and most colors are configurable ([#1769](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1769))
  * You can now kill a minion or minion group directly from their sheet with a single click! ([#1744](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1744))
  * Add derived stats of strainOverThreshold, woundsOverThreshold, hullOverThreshold, and systemStrainOverThreshold to actors (for things like Bar Brawl) ([#1781](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1781))
  * You can now provide a reason for manual XP adjustments ([#1630](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1630))
  * Users with limited view access on Nemesis actors can now view the bio. (GMs can hide content by using the `secret` block in the Bio) ([#1774](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1774))
* Fixes:
  * Remove usage of deprecated `math.clamped` in favor of `math.clamp`
  * Fix skill roll sometimes showing a pool of only 2 difficulty when clicked ([#1763](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1763))
  * XP Spending now uses a generic symbol instead of a dollar sign ([#1732](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1732))
  * Fix for skill-roll macros not being created on drag-and-drop into macro hotbar ([#1786](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1786))
  * Prevent abilities on species from duplicating when the importer is run more than once ([#1721](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1721))
  * Do not import item name in the description of the item ([#1795](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1795))
  * Do not include base mods in weapon description when running the importer ([#1795](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1795))
  * Unranked unique mods are now properly imported without ranks ([#1795](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1795))
  * Correct talent ownership bug ([#1773](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1773))
  * Show error if a non-custom skill is removed from actor ([#1571](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1571))
  * Update wording of `Dice Theme` setting to more accurately reflect what it changes ([#1795](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1795))

`1.905`
* Fixes
  * Hotfix for inability to roll dice with modifiers (e.g. critical injuries)

`1.904`
* Features:
  * Optionally include GM Characters in the Group Manager ([#1680](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1680))
  * Add EditorConfig settings
  * Add basic Eslint config
  * Alphabetize species, careers, specializations, signature abilities, and force powers on actor sheets ([#1723](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1723))
  * A notification will be generated if all system compendiums are empty ([#1693](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1693))
  * The importer now has a "select all" so you don't have to click each item individually ([#1724](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1724))
  * Add long description for talents and move sources out of description for all items ([#1640](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1640))
  * Weapon "special" field moved to the configuration tab ([#1715](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1715))
* Fixes:
  * Apply Force Powers upgrades to character ([#1542](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1542))
  * Imported skill modifiers have better formatted attributes key names ([#1663](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1663))
  * Updated Spanish localizations
  * Updated French localizations
  * Retain token settings when copying actors ([#1673](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1673))
  * Non FFG Dice rolls with multiple terms are accepted again ([#1664](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1664))
  * Escape menu toggles in the normal way again ([#1670](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1670))
  * Force Power: Empty mod list doesn't reset basic force power anymore ([#1669](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1669))
  * Updating a talent from a specialization tree updates the tree ([#1643](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1643))
  * Force Power: Import basic force power mods ([#1686](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1686))
  * Get embedded item data from `system` variable instead of root
  * Use correct type when importing a Force Boost mods ([#1687](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1687))
  * Item attachments' mods use parent item mod type when present ([#1624](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1624))
  * Talent cost set when preparing tree instead of template ([#1704](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1704))
  * Qualities are linked to parent item ([#1612](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1612))
  * Assign correct modifiers type to armor: "armour" instead of "armor" ([#1697](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1697))
  * Remove Destiny Tracker hardcoded size, allowing it to grow and shrink when font size is changed ([#1688](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1688))
  * Assign correct modifiers type to armor: "armour" instead of "armor" ([#1697](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1697))
  * Skill purchases on actors now work via the dollar sign again ([#1713](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1713))
  * Use defense when building pool bug ([#1603](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1603))
  * Allow to set challenge dices when create a dice pool.
  * Allow zero as a valid value when updating vehicle stats ([#1717](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1717))
  * Replace deprecated Document.createDocuments calls with Document() constructor ([#1683](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1683))
  * Problem with Destiny Roll ([#1730](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1730))
  * Show removed setback dice icons and optionnally remove them from all rolls ([#1720](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1720))
  * Problem with rolling of standard dice ([#1731](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1731))
  * Allow weapon status check for dice roll also for shipweapon
  * Blind GM rolls are now properly hidden from players ([#1712](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1712))
  * Properly use Genesys story points when the theme is set to Genesys ([#1711](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1711))
  * Stop using deprecated `select` Handlebars helper ([#1632](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1632))
    * Note that the same _code_ is in use, it is just no longer using the built-in (and deprecated) version
  * Correctly show claimed slot combatants in combat tracker ([#1703](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1703))
  * Combat tracker no longer spawns infinite combatants under certain conditions ([#1733](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1733))

`1.903`
* Features:
  * Updated "item cards" to match the Mandar theme
    * This change includes many minor improvements to the cards, such as showing damage on weapons and purchased talents on specializations
  * Generic slot combat tracker: The action to take when removing a combatant is now configurable. This is in place of the previously-confusing (and quite annoying) behavior where you had to claim a slot in order to remove a combatant
  * Dragging-and-dropping items on actors now prompts for spending XP to purchase that item ([#1588](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1588))
  * XP spending now consistently uses a dollar sign to trigger spending instead of the various methods it previously used ([#1629](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1629))
  * Settings have been refactored to be more organized and easier to navigate ([#1639](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1639))
  * Destiny point flipping is now themed ([#1658](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1658)
  * Set default token settings when creating new actor ([#1652](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1652)))
* Fixes:
  * Includes species characteristics bonus when calculating characteristic upgrade cost ([#1638](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1638))
  * Specializations: Talents are now correctly looked up in compendium ([#1642](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1642)))
  * Generic slot combat tracker: Removed "unused" slot checking (on combatant defeat) as they would sometimes lead to actors being unable to act
  * Weapon `special` text now properly renders dice icons ([#1625](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1625))
  * Species without ability don't cause an error preventing their talents from being loaded anymor ([1641](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1641)))
  * Specializations: Embedded talents are now correctly linked to their compendium ([#1650](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1650)))
  * Vehicle `Pilot` role now works for Genesys ([#1597](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1597))

`1.902`
* Features:
  * Modified the Specialization sheet; moved the XP cost off of the talents, changed the appearance of talent connections, and improved how the sheet scales when the window is resized.
  * Increased the default size of the popout editor (e.g., used for editing the description of a Specialization)
  * Purchase improvements
    * Grouped specializations in selection popup by in and out of career
    * Grouped force powers in selection popup  by required force rating
    * Spending XP now whispers the GM to notify them (this can be disabled in the system settings)
  * Manual XP adjustments now result in an entry in the XP log
  * Max characteristic and skill ranks are now configurable ([#1532](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1532))
* Fixes:
  * Removed the "purchase" context menu option when editing a Specialization that is not attached to a character
  * Improves nested tag formatting (e.g., allows for strings like `[B]Average ([di][di]) Skill[b]` to properly render)
  * Purchasing force powers now looks at the correct attribute (it should no longer claim you are not strong enough in the force for powers!) ([#1584](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1584))
  * Vehicle weapon images now have a max width of 500px (up from 130px) ([#1576](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1576))
  * Fixed talent descriptions not showing up on specializations after being dragged-and-dropped ([#1573](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1573))
  * Fixed destiny pool roll not populating in tracker ([#1592](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1592))
  * Specializations no longer take forever to open ([#1593](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1593))
  * SWA import now properly imports ranked talents ([#1572](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1572))
  * SWA import no longer improperly matches the wrong talents in rare occasions
  * Characteristic XP cost is now calculated excluding any boosts from modifiers ([#1594](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1594))

`1.901`
* Features:
  * Added a sheet option to disable Force Pool on Rival and Nemesis actor sheets ([#1502](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1502))
  * The importer will no longer include every source as a header element, making it easier to read
* Fixes:
  * Fixed a bug where item qualities sometimes showed "you do not have permission to view this item" for non-GMs ([#1552](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1552))
  * Fixed changing skill characteristics not working ([#1550](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1550))
  * Skill descriptions are now properly imported ([#1551](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1551))
  * Talents from species no longer multiply ranks when combined with purchased talents ([#1540](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1540))
  * Fixed a bug where some text disappeared from descriptions ([#1559](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1559))
  * Fixed a bug where paragraph tags did not properly result in new lines
  * Creating combat via the group manager now works again ([#1545](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1545))
  * Removing initiative slots from combat now works ([#1545](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1545))
  * Soak can now go below the Brawn value if auto-calculation is turned off ([#1371](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1371))
  * Imported Vehicle improvements ([#1537](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1537)):
    * Navicomputer is now imported
    * Hyperdrive primary is set to null if no hyperdrive is installed
    * Hyperdrive secondary is imported (and set to null if no hyperdrive is installed)
  * `system.json` no longer generates warnings ([#1538](https://github.com/StarWarsFoundryVTT/StarWarsFFG/issues/1538))
  * Weapon-on-actor macros now work with the Enhancements module animations ([enhancements module #202](https://github.com/wrycu/StarWarsFFG-Enhancements/issues/202))

`1.900`
* Features:
  * Support for FoundryVTT v12
    * Compendiums are now system defined. This means they cannot be deleted, but was required for the v12 migration
  * **Characters / Nemesis / Rivals / Minions**
    * All actor sheets now default to v2 (they can still be manually changed back to v1)
    * v2 sheets: Critical injuries are now in a dedicated tab
    * Characters: Players can now buy levels in characteristics by clicking the characteristic name
    * Characters: XP available/total moved to XP log tab
    * Characters with v2 sheets: Obligation / morality / conflict moved to a dedicated tab
    * Nemesis / Rivals / Minions: Abilities created during the SWA import process are now created as "Ability" items instead of populating in the biography section
  * **Vehicles**
    * Overall tab layout updated
    * Vehicles can now be classified as "space" or "not space"
      * This data is automatically included when the importer is run
    * A single, dedicated "pilot" role was created which selects the appropriate skill based on how the vehicle is classified ("space" or "not space")
    * You can now roll a vehicle weapon using a crew member from that weapon
    * Crew selection is now a multi-select dropdown instead of requiring you to drag-and-drop the same actor multiple times
    * Dragging crew onto vehicles now prompts for the initial role selection, instead of assigning "(none)"
    * Defense silhouettes are now customizable
      * This data is automatically included when the importer is run
  * **Items**
    * All item sheets now default to v2 (they can still be manually changed back to v1)
    * Signature abilities can now have required specialization upgrades defined
      * This data is automatically included when the importer is run
      * If defined on a signature ability, attempting to purchasing it checks if the required specialization upgrades are purchased
    * Purchasing Force Powers now checks the required force rating
    * Species can now have starting XP defined
      * This data is automatically included when the importer is run
      * Dragging a species onto a player character grants the starting XP
    * Species can now include abilities to grant the actor they are added to
      * This data is automatically included when the importer is run
    * Obligations and duties may now have notes set on them
      * This data is automatically included when the character importer is run
  * **Combat**
    * The target's defense dice are now added if you target it (this is configurable per-client)
  * **Importer-specific changes**
    * The importer now includes categories from the source dataset intended for programmatic interpretation, e.g. the Holdout Blaster is tagged with "Blaster Pistol", "Holdout blaster", "Blaster", "Pistol", "Ranged"
* Fixes:
  * **Characters / Nemesis / Rivals / Minions**
    * Corrected tooltip for equipped/unequipped gear (and localized it)
    * Fixed a bug where talents displayed blank
    * Fixed a bug where attempting to view a talent on a specialization tree did not open anything
    * Swapped "melee" and "ranged" defense to match the printed books
    * Nemesis / Rivals / Minions: Removed ability to buy skill ranks
    * Characters: Added a check for sufficient XP for purchasing Signature Abilities and Force powers
    * Characters: The buy talent button on specializations no longer disappears when buying >1 talent at a time
    * Characters: "Fix" purchasing skills at the bottom of the skill list by adding a dedicated purchase button
    * Characters: The XP log no longer shows an edit button, as it is currently read only
    * Characters: Fixed a bug where talents directly granted to an actor (i.e. not via a specialization) did not appear on the first opening of the character sheet each load
    * Minions: Show "group skill" instead of "career skill"
  * **Vehicles**
    * Vehicle mods are now imported as the correct type (ship mods)
  * **Items**
    * Sending a signature ability to chat now includes purchased upgrades
    * Fix overflowing "special" field on weapons in Mandar theme
    * Correct default Signature ability height so the bottom isn't ever-so-slightly cut off
    * The "talent" tab on species items now uses the talent icon instead of the configure icon
    * The "item modifier" item type has had the description height corrected
  * **Combat**
    * Fixed double-slot-claim bug in the combat tracker
    * Fixed a bug preventing removing combatants from combat
    * Fixed a bug  where removing a combatant would un-claim another slot
    * Fixed a bug where removing a combatant from the canvas would not properly update the tracker
  * **Importer**:
    * Career data (signature abilities, specializations) is now properly set when the OggDude importer is run with existing compendiums
    * Re-running the importer no longer duplicates weapons on vehicles
    * Vehicle images are now imported when "vehicles" are imported
  * **Misc**
    * Granting XP to the entire group now updates the XP logs for those players (previously, only single-actor grants updated the log)

`1.809`
* Features:
  * You can now (optionally) spend XP! See [the wiki](https://github.com/StarWarsFoundryVTT/StarWarsFFG/wiki/new%E2%80%90features%E2%80%90v1.809#xp-spending) for more info
  * Added actor types for Nemesis and Rival
  * Weapons can now have stat mods (permitting setting e.g. the `defensive` quality)
  * Initiative rolls can be upgraded
  * Actor dice pools now show fixed results
  * `Remove setback dice` is now shown on crew dice pools
  * Wounds and stats are set as the default stats for tokens
  * Gear, weapons, and armor can now hide the `price` and `rarity` fields (via sheet options)
  * Macros are now created with the image of the item and can be created to display items
  * Specializations and signature abilities can be associated with careers (see "new importer features" below)
  * Signature abilities now have a base cost (see "new importer features" below)
  * Species can now include talents (see "new importer features" below)
  * New importer features:
    * Species talents are now set
    * Career specializations and signature abilities are now imported
    * Signature ability base cost is imported
    * Force power base cost and minimum force rating is imported
    * SWA importer imports actors as Nemesis/Rival/Minion as appropriate
* Fixes:
  * Corrected dice images for Genesys not properly embedded in Journals
  * CSS:
    * Reworked scroll heights for most sheets
    * Reworked name centering for most sheets
    * Fixed giant dice in expanded roll card in the Mandar theme. Again.
  * Importer improvements:
    * Ship attachments are now set to the correct item type
    * Misc qualities on weapons/armor are now imported properly
  * Improved GM detection for combat events
  * Fixed expanding items with `null` item qualities (e.g. expanding a weapon on an actor sheet)
  * Fixed viewing item qualities with HTML elements in them
  * Fix for non-GMs being unable to open some item qualities
  * Fix for drag-and-drop items from compendiums not working until the item sheet was opened at least once
  * Fixed a bug for adversary levels above 5 not showing up
