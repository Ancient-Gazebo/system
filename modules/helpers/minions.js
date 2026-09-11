/**
 * Minion kill helpers — bump a minion's wounds past the threshold that removes
 * one (or all) group members. Used by the Apply Crit chat button (a crit on a
 * minion kills one outright, RAW).
 */

export function getKillMinionUpdate(actor) {
  const minionHealth = Number(actor?.system?.unit_wounds?.value) || 0;
  if (minionHealth <= 0) return null;

  const currentHealth = Number(actor?.system?.stats?.wounds?.value) || 0;
  return { "system.stats.wounds.value": currentHealth + minionHealth + 1 };
}

export function getKillMinionGroupUpdate(actor) {
  const maxWounds = Number(actor?.system?.stats?.wounds?.max) || 0;
  return { "system.stats.wounds.value": maxWounds + 1 };
}

export async function killMinion(actor) {
  const update = getKillMinionUpdate(actor);
  if (!update) return false;
  await actor.update(update);
  return true;
}

export async function killMinionGroup(actor) {
  await actor.update(getKillMinionGroupUpdate(actor));
  return true;
}

/**
 * Vehicle minion groups — a formation of ships run under the minion rules. The group shares one hull
 * trauma and one system strain threshold (each the sum of its ships'), derived in
 * ActorFFG#_prepareVehicleGroupData. A ship is destroyed each time total hull trauma exceeds another
 * ship's share, and disabled each time total system strain does; the two are counted independently.
 */

export function isVehicleGroup(actor) {
  return actor?.type === "vehicle" && actor.system?.group?.enabled === true;
}

/**
 * Group skill rank for a minion group with `members` able to act: one rank per member past the
 * first, capped at 5 (mirrors ActorFFG#_prepareMinionData).
 */
export function getGroupSkillRank(members) {
  return Math.clamp((Number(members) || 0) - 1, 0, 5);
}

/**
 * Alive / total counts for the token group counter, or null when the actor is not a group.
 */
export function getGroupCount(actor) {
  if (actor?.type === "minion") {
    return { alive: Number(actor.system.quantity?.value) || 0, total: Number(actor.system.quantity?.max) || 0 };
  }
  if (isVehicleGroup(actor)) {
    return { alive: Number(actor.system.group.operational) || 0, total: Number(actor.system.group.size) || 0 };
  }
  return null;
}

export function getDestroyShipUpdate(actor) {
  if (!isVehicleGroup(actor)) return null;
  const group = actor.system.group;
  const size = Number(group.size) || 0;
  // The derived threshold is exactly one effective ship share per ship (Active Effect bonuses included).
  const share = size > 0 ? (Number(actor.system.stats?.hullTrauma?.max) || 0) / size : 0;
  const destroyed = Number(group.destroyed) || 0;
  if (share <= 0 || destroyed >= size) return null;
  // Push the total just past the next ship's share. Adding a whole share to the current total instead
  // overshoots, destroying two ships when the total already sits exactly on a boundary.
  return { "system.stats.hullTrauma.value": (destroyed + 1) * share + 1 };
}

export function getDestroyShipGroupUpdate(actor) {
  const max = Number(actor?.system?.stats?.hullTrauma?.max) || 0;
  return { "system.stats.hullTrauma.value": max + 1 };
}

export async function destroyShip(actor) {
  const update = getDestroyShipUpdate(actor);
  if (!update) return false;
  await actor.update(update);
  return true;
}
