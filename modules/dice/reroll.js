import { RollFFG } from "./roll.js";
import { DicePoolFFG } from "./pool.js";

/**
 * Rebuild an FFG roll's dice pool as a fresh, unevaluated roll. Shared by the chat log's Reroll and
 * Escalate entries and by the Destiny Reroll table tool.
 * @param {RollFFG} original
 * @param {object} [options]
 * @param {boolean} [options.escalate=false]  upgrade the check and the difficulty once each
 * @returns {RollFFG}
 */
export function buildReroll(original, { escalate = false } = {}) {
  // Rebuild the fixed symbols that were layered on top of the dice (talents,
  // equipment, manual pool additions) so the reroll carries identical modifiers.
  const added = {};
  for (const result of original.addedResults ?? []) {
    // A bond was paid for with a Destiny Point on that roll; the reroll does not get it for free.
    if (result.source === "bond") continue;
    const key = result.type.toLowerCase();
    added[key] = (added[key] ?? 0) + (result.negative ? -result.value : result.value);
  }

  // Count the FFG dice back into a DicePoolFFG so Escalate can upgrade them.
  // Non-FFG terms (standard dice, numeric modifiers) are carried over verbatim
  // using their `expression` ("2d20") rather than `formula`, because the FFG dice
  // override the latter with a display shorthand ("5p") the parser cannot read.
  const denomToPool = { p: "proficiency", a: "ability", c: "challenge", i: "difficulty", b: "boost", s: "setback", f: "force" };
  const poolCounts = {};
  const extraParts = [];
  let lastOperator = "+";
  for (const t of original.terms) {
    if (t instanceof foundry.dice.terms.OperatorTerm) {
      lastOperator = t.operator;
    } else if (game.ffg.diceterms.includes(t.constructor)) {
      const key = denomToPool[t.constructor.DENOMINATION];
      poolCounts[key] = (poolCounts[key] ?? 0) + t.number;
    } else {
      extraParts.push({ op: lastOperator, expr: t.expression });
    }
  }

  const pool = new DicePoolFFG(poolCounts);
  if (escalate) {
    pool.upgrade(1);
    pool.upgradeDifficulty(1);
  }

  let formula = pool.renderDiceExpression();
  for (const part of extraParts) {
    formula = formula ? `${formula} ${part.op} ${part.expr}` : part.op === "-" ? `-${part.expr}` : part.expr;
  }

  return new RollFFG(formula, original.data, added, original.flavorText);
}
