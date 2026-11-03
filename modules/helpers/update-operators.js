/**
 * Mark one key of an object inside an update for deletion. V14 has an operator for it and
 * deprecates the old `-=key` form, which V13 still needs.
 * @param {object} update - the object holding the key in the update, changed in place
 * @param {string} key
 */
export function markDeleted(update, key) {
  const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
  if (game.release.generation >= 14 && ForcedDeletion) update[key] = ForcedDeletion.create();
  else update[`-=${key}`] = null;
}

/**
 * Mark every key of `stored` that `next` lacks for deletion, at any depth, so an update with
 * `next` replaces `stored` instead of merging into it. Arrays need nothing: an update replaces them.
 * @param {object} stored - the value as saved
 * @param {object} next - the incoming value, changed in place
 */
export function markRemovedKeys(stored, next) {
  const isPlain = (value) => value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!isPlain(stored) || !isPlain(next)) return;
  for (const [key, value] of Object.entries(stored)) {
    if (next[key] === undefined) markDeleted(next, key);
    else markRemovedKeys(value, next[key]);
  }
}
