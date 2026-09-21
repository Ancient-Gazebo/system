import { getGroupCount } from "./minions.js";

export function registerTokenControls() {
  game.settings.register("starwarsffg", "showMinionCount", {
    name: game.i18n.localize("SWFFG.Settings.showMinionCount.Name"),
    hint: game.i18n.localize("SWFFG.Settings.showMinionCount.Hint"),
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
    onChange: (rule) => window.location.reload()
  });
  game.settings.register("starwarsffg", "showAdversaryCount", {
    name: game.i18n.localize("SWFFG.Settings.showAdversaryCount.Name"),
    hint: game.i18n.localize("SWFFG.Settings.showAdversaryCount.Hint"),
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
    onChange: (rule) => window.location.reload()
  });
    game.settings.register("starwarsffg", "adversaryItemName", {
    name: game.i18n.localize("SWFFG.Settings.AdversaryItemName.Name"),
    hint: game.i18n.localize("SWFFG.Settings.AdversaryItemName.Hint"),
    scope: "world",
    config: false,
    default: "Adversary",
    type: String,
    onChange: (rule) => window.location.reload()
  });
  game.settings.register("starwarsffg", "enableAdversaryCalc", {
    name: game.i18n.localize("SWFFG.Settings.enableAdversaryCalc.Name"),
    hint: game.i18n.localize("SWFFG.Settings.enableAdversaryCalc.Hint"),
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
    onChange: (rule) => window.location.reload()
  });
}

/**
 * Ratio of the current scene's grid size to the 100px grid the token overlays were designed on.
 * @returns {number}
 */
function getGridScale() {
  return (canvas?.dimensions?.size || 100) / 100;
}

export function drawMinionCount(token) {
  // Minion groups and vehicle minion groups. A vehicle can stop being a group, so clear any counter
  // left from when it was one rather than only skipping the draw.
  const counts = getGroupCount(token.actor);
  if (!counts || !game.settings.get("starwarsffg", "showMinionCount")) {
    token.minionCount?.destroy({ children: true });
    token.minionCount = null;
    return;
  }
  // every dimension below was tuned for a 100px grid; scale it to this scene's grid
  const gridScale = getGridScale();
  const borderWidth = 0.35 * gridScale;
  const friendlyColor = "0x00A2E84D";
  const enemyColor = "0x8800154D";
  const overflowColor = "0xDAA520";
  // calculate total and alive numbers of the group
  const curCount = Math.max(counts.alive, 0);
  const maxCount = counts.total;
  const maxRender = 6;

  // attempt to draw it on the token directly
  // check for existing copies of the container
  if (!token.children.find(i => i.name === "minionCount")) {
    const countContainer = new PIXI.Container();
    countContainer.name = "minionCount";
    token.minionCount = token.addChild(countContainer);
  } else {
    token.minionCount.removeChildren().forEach(i => i.destroy());
  }

  const tokenWidth = token.w;
  const markerWidth = 7 * gridScale;
  const markerHeight = 15 * gridScale;
  const insideGap = 5 * gridScale;
  const availableSpace = tokenWidth - ((markerWidth * maxCount) + (insideGap * (maxCount - 1)));
  const outsideGap = availableSpace / 2;

  if (maxCount > maxRender) {
    const text = new PIXI.Text(
      "∞",
      {
        fontFamily: "Arial",
        fontSize: 48 * gridScale,
        fill: overflowColor,
        align: "center",
        stroke: "0x000000",
        strokeThickness: 1,
        fontWeight: "bold" ,
      }
    );
    text.anchor.set(0.5);
    text.x = tokenWidth / 2;
    text.y = token.h - (12 * gridScale);
    token.minionCount.addChild(text);
  } else {
    for (let i = 0; i < curCount; i++) {
      const element = new PIXI.Graphics();
      // add the border
      element.lineStyle(borderWidth, "0x000000", 1);
      // draw the rectangle
      element.beginFill(friendlyColor);
      element.drawRoundedRect(0, 0, markerWidth, markerHeight, 2 * gridScale);
      element.endFill();
      // position it
      element.x = (i * (markerWidth + insideGap)) + outsideGap;
      element.y = token.h - markerHeight - (2 * gridScale);
      // add it to the container
      token.minionCount.addChild(element);
    }

    for (let i = 0; i < maxCount - curCount; i++) {
      const element = new PIXI.Graphics();
      // add the border
      element.lineStyle(borderWidth, "0x000000", 1);
      // draw the rectangle
      element.beginFill(enemyColor);
      element.drawRoundedRect(0, 0, markerWidth, markerHeight, 2 * gridScale);
      element.endFill();
      // position it
      element.x = ((i + curCount) * (markerWidth + insideGap)) + outsideGap;
      element.y = token.h - markerHeight - (2 * gridScale);
      // add it to the container
      token.minionCount.addChild(element);
    }
  }
}

/**
 * Calculate the total Adversary rank for an actor by summing the ranks of every item whose name
 * matches the configured adversary item name (default "Adversary"). Returns 0 for actors without
 * the talent (or for missing actors), which makes it safe to call against any target.
 * @param {Actor} actor - the actor to inspect
 * @returns {number} total adversary ranks
 */
export function getAdversaryLevel(actor) {
  if (!actor) {
    return 0;
  }
  const itemName = game.settings.get("starwarsffg", "adversaryItemName");
  const adversaryItems = actor?.items?.filter(i => i.name === itemName) || [];
  let adversaryLevel = 0;
  adversaryItems.forEach(function (item) {
    adversaryLevel += item?.system?.ranks?.current || 0;
  });
  return adversaryLevel;
}

export function drawAdversaryCount(token) {
  // The badge can outlive the reason it was drawn - the setting gets switched off, or the ranks are
  // removed from the actor - and `refreshToken` then has to take it away again, so both of those
  // paths clear instead of simply skipping the draw (this mirrors drawMinionCount). The lookup by
  // name is the fallback for a container that survived a re-render the property did not.
  const clearBadge = () => {
    const existing = token.adversaryLevel ?? token.children.find(i => i.name === "adversaryLevel");
    existing?.destroy({ children: true });
    token.adversaryLevel = null;
  };
  if (!game.settings.get("starwarsffg", "showAdversaryCount")) {
    clearBadge();
    return;
  }
  const overflowColor = "0xDAA520";
  let adversaryLevel = getAdversaryLevel(token?.actor);
  if (adversaryLevel <= 0) {
    clearBadge();
    return;
  }
  // attempt to draw it on the token directly
  // check for existing copies of the container
  if (!token.children.find(i => i.name === "adversaryLevel")) {
    const countContainer = new PIXI.Container();
    countContainer.name = "adversaryLevel";
    token.adversaryLevel = token.addChild(countContainer);
  } else {
    token.adversaryLevel.removeChildren().forEach(i => i.destroy());
  }
  // Clamp BEFORE the texture path is built. Only adversary-1..6.png ship, and the clamp used to
  // run after the filename was interpolated, so seven or more ranks requested an image that does
  // not exist and the badge silently failed to draw.
  const overflow = adversaryLevel > 5;
  if (overflow) {
    adversaryLevel = 6;
  }
  const sprite = PIXI.Sprite.from(`systems/starwarsffg/images/adversary/adversary-${adversaryLevel}.png`);
  // Tuned against a 1x1 token on a 100px grid. Scale by the TOKEN's own footprint rather than by
  // the grid alone: a 2x2 or 4x4 token spans several grid squares, so a badge sized from the grid
  // stayed at its 1x1 size and shrank to a speck adrift near the middle of a large token. Deriving
  // the factor from the token makes every size render the same proportions the 1x1 case was tuned
  // for, and taking the smaller dimension preserves the aspect ratio on a non-square token instead
  // of letting a short, wide one push the badge past its bottom edge.
  const tokenScale = Math.min(token.w, token.h) / 100;
  sprite.scale.set(0.15 * tokenScale, 0.15 * tokenScale);
  // Centre by anchor rather than by subtracting a hard-coded half-width: the images are 280-284px
  // wide, so the old `- 20` was a hair narrow and the error grew with the token (5px adrift at
  // 4x4). An anchor is exact at every size and does not need the texture to have loaded yet.
  sprite.anchor.set(0.5, 0);
  sprite.x = token.w / 2;
  sprite.y = (token.h / 2) + (15 * tokenScale);
  if (overflow) {
    sprite.tint = overflowColor;
  }
  token.adversaryLevel.addChild(sprite);
}
