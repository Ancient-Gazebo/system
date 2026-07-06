/**
 * Connectivity helpers for specialization talent trees, Force power trees, and signature
 * ability trees.
 *
 * All are 4-column grids stored as `talent0..talentN` / `upgrade0..upgradeN`, where the index
 * maps to row = floor(index / 4) and column = index % 4. Specialization talents are always a
 * single column wide; Force power and signature ability upgrades may span multiple columns
 * (single/double/triple/full), with the spanned-over columns stored as hidden placeholder entries.
 *
 * The "entry" of a tree is its top row: top-row specialization talents are bought directly,
 * top-row Force power upgrades connect to the always-owned basic power, and top-row signature
 * ability upgrades connect to the always-owned base ability (via its uplink nodes). A learned node
 * is only legitimately purchased if it has a path of learned nodes back to that top row.
 *
 * These helpers are used to validate refunds: a learned node may only be refunded if removing it
 * would not orphan any other learned node from the top row.
 */
export default class TalentTree {
  static GRID_WIDTH = 4;

  static SIZE_TO_INT = {
    single: 1,
    double: 2,
    triple: 3,
    full: 4,
  };

  /** Coerce the various truthy representations (true / "true") to a real boolean. */
  static _bool(value) {
    return value === true || value === "true";
  }

  /** The collection key ("talents" for specializations, "upgrades" for everything else). */
  static collectionKey(type) {
    return type === "specialization" ? "talents" : "upgrades";
  }

  /** Width (in columns) of the node at the given key. */
  static _size(nodes, key, type) {
    // Specialization talents are always a single column. Force power and signature ability
    // upgrades may span multiple columns (single/double/triple/full), with the spanned-over
    // columns stored as hidden placeholders.
    if (type !== "forcepower" && type !== "signatureability") return 1;
    return TalentTree.SIZE_TO_INT[nodes[key]?.size] || 1;
  }

  /** Whether a slot represents a real, displayed node (hidden placeholders do not). */
  static _isRealNode(node) {
    if (!node) return false;
    // Force power placeholders for spanned columns are explicitly not visible.
    if (node.visible === false || node.visible === "false") return false;
    return true;
  }

  static _index(key) {
    return parseInt(String(key).replace(/[^0-9]/g, ""), 10);
  }

  static _key(prefix, index) {
    return `${prefix}${index}`;
  }

  /**
   * Find the index of the real node in `row` whose column span covers `col`. Spanned columns are
   * stored as hidden placeholders, so we scan leftwards from `col` to find the node that owns it.
   * Returns null if no covering node exists.
   */
  static _nodeCoveringColumn(nodes, prefix, row, col, type) {
    if (col < 0 || col >= TalentTree.GRID_WIDTH) return null;
    for (let c = col; c >= 0; c--) {
      const idx = row * TalentTree.GRID_WIDTH + c;
      const key = TalentTree._key(prefix, idx);
      const node = nodes[key];
      if (!TalentTree._isRealNode(node)) continue;
      const span = TalentTree._size(nodes, key, type);
      if (c + span - 1 >= col) return idx;
      // a real node to the left whose span does not reach `col` means `col` is not covered by it
      return null;
    }
    return null;
  }

  /**
   * Build an undirected adjacency map (index -> Set(index)) across all real nodes in the tree,
   * derived from the link flags. This is independent of which nodes are learned.
   */
  static _buildAdjacency(nodes, type) {
    const prefix = type === "specialization" ? "talent" : "upgrade";
    const width = TalentTree.GRID_WIDTH;
    const adjacency = {};
    const addEdge = (a, b) => {
      if (a == null || b == null) return;
      (adjacency[a] = adjacency[a] || new Set()).add(b);
      (adjacency[b] = adjacency[b] || new Set()).add(a);
    };

    for (const key of Object.keys(nodes)) {
      const idx = TalentTree._index(key);
      if (Number.isNaN(idx)) continue;
      const node = nodes[key];
      if (!TalentTree._isRealNode(node)) continue;
      const row = Math.floor(idx / width);
      const col = idx % width;
      const size = TalentTree._size(nodes, key, type);

      // Right link -> the node immediately past this node's right edge, same row.
      if (TalentTree._bool(node["links-right"])) {
        const rightCol = col + size;
        if (rightCol < width) {
          const rightIdx = row * width + rightCol;
          if (TalentTree._isRealNode(nodes[TalentTree._key(prefix, rightIdx)])) {
            addEdge(idx, rightIdx);
          }
        }
      }

      // Top links -> the node(s) above, one per spanned column that declares a top connection.
      if (row >= 1) {
        for (let y = 1; y <= size; y++) {
          if (!TalentTree._bool(node[`links-top-${y}`])) continue;
          const targetCol = col + (y - 1);
          const targetIdx = TalentTree._nodeCoveringColumn(nodes, prefix, row - 1, targetCol, type);
          addEdge(idx, targetIdx);
        }
      }
    }
    return adjacency;
  }

  /**
   * Determine whether refunding (unlearning) the node identified by `refundKey` would disconnect
   * any other learned node from the tree's top row.
   *
   * @param {object} nodes      The talents/upgrades object from the item's system data.
   * @param {string} refundKey  The key being refunded (e.g. "talent7" / "upgrade5").
   * @param {string} type       "specialization", "forcepower", or "signatureability".
   * @returns {{ orphaned: boolean, orphans: string[] }}
   */
  static refundImpact(nodes, refundKey, type) {
    const prefix = type === "specialization" ? "talent" : "upgrade";
    const width = TalentTree.GRID_WIDTH;
    const refundIdx = TalentTree._index(refundKey);

    const learned = new Set();
    for (const key of Object.keys(nodes)) {
      const idx = TalentTree._index(key);
      if (Number.isNaN(idx)) continue;
      if (!TalentTree._isRealNode(nodes[key])) continue;
      if (TalentTree._bool(nodes[key].islearned)) learned.add(idx);
    }

    // Nodes that must remain supported after the refund (everything still learned except the one
    // being refunded).
    const mustRemain = new Set([...learned].filter((i) => i !== refundIdx));
    if (mustRemain.size === 0) return { orphaned: false, orphans: [] };

    const adjacency = TalentTree._buildAdjacency(nodes, type);

    // Roots: learned top-row nodes (other than the refunded one). The top row connects to the
    // tree entry (direct purchase) / the always-owned basic power.
    const queue = [];
    const reached = new Set();
    for (const idx of mustRemain) {
      if (Math.floor(idx / width) === 0) {
        reached.add(idx);
        queue.push(idx);
      }
    }

    // BFS through learned nodes only, never traversing through the refunded node.
    while (queue.length) {
      const current = queue.shift();
      const neighbors = adjacency[current] || new Set();
      for (const next of neighbors) {
        if (next === refundIdx) continue;
        if (!mustRemain.has(next)) continue;
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }

    const orphans = [...mustRemain]
      .filter((i) => !reached.has(i))
      .map((i) => TalentTree._key(prefix, i));
    return { orphaned: orphans.length > 0, orphans };
  }

  /** Convenience wrapper: true if the refund is safe (won't orphan anything). */
  static canRefund(nodes, refundKey, type) {
    return !TalentTree.refundImpact(nodes, refundKey, type).orphaned;
  }
}
