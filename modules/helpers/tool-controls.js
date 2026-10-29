/**
 * Scene-control entry points for the table tools: Request a Roll (GM), the Character Pilot and the
 * Relationship Web.
 */
import RollRequestApp from "../apps/roll-request.js";
import CharacterPilot from "../apps/character-pilot.js";
import RelationshipWeb from "../apps/relationship-web.js";

/**
 * Add the tool buttons to the Token scene controls.
 *
 * Must be called during `init` / `setup`, for the same reason as registerDispositionControls:
 * SceneControls builds its control record once, on first render, before the `ready` hook.
 */
export function registerToolControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    // V13+ hands over a record keyed by control name; tolerate the legacy array shape as well.
    const tokenControl = Array.isArray(controls) ? controls.find((c) => c.name === "tokens") : controls?.tokens;
    if (!tokenControl) return;
    const add = (tool) => {
      if (Array.isArray(tokenControl.tools)) tokenControl.tools.push(tool);
      else {
        tokenControl.tools ??= {};
        tokenControl.tools[tool.name] = tool;
      }
    };

    // The system's settings are registered partway through an async init hook. On a slow load the
    // controls can be built before that has finished, and an unregistered setting throws - which
    // would drop both buttons. Treat "not registered yet" as the default, which is on.
    const enabled = (key) => {
      try {
        return game.settings.get("starwarsffg", key);
      } catch (err) {
        return true;
      }
    };

    if (game.user.isGM && enabled("enableRollRequests")) {
      add({
        name: "ffgRollRequest",
        order: 101,
        title: "SWFFG.RollRequest.Title",
        icon: "fa-solid fa-dice",
        // Buttons resolve on click instead of becoming the active tool.
        button: true,
        onChange: (event, active) => {
          if (active) RollRequestApp.open();
        },
      });
    }

    if (enabled("enableCharacterPilot")) {
      add({
        name: "ffgCharacterPilot",
        order: 102,
        title: "SWFFG.Pilot.Title",
        icon: "fa-solid fa-gamepad",
        button: true,
        onChange: (event, active) => {
          if (active) CharacterPilot.open();
        },
      });
    }

    // Only offered while the Stylish Relationship Tracker, which holds the bonds, is active.
    if (enabled("enableRelationshipWeb") && RelationshipWeb.available) {
      add({
        name: "ffgRelationshipWeb",
        order: 103,
        title: "SWFFG.RelationshipWeb.Title",
        icon: "fa-solid fa-circle-nodes",
        button: true,
        onChange: (event, active) => {
          if (active) RelationshipWeb.open();
        },
      });
    }
  });
}
