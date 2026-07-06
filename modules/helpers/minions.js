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
