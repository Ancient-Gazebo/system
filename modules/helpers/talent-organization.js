/**
 * Helper for organizing talents on an actor sheet into user-defined, collapsible tabs
 * with manual ordering. Works for talents from any source (owned items or specializations),
 * since organization is stored on the actor (by a stable talent key) rather than relying on
 * document sort values.
 *
 * Flag shape (actor.flags.starwarsffg.talentOrganization):
 * {
 *   enabled: boolean,                                  // manual organization on/off
 *   tabs: [{ id: string, name: string, collapsed: bool }],
 *   assignments: { [talentKey]: { tab: string|null, sort: number } }
 * }
 */
export default class TalentOrganization {
  static FLAG = "talentOrganization";
  static DEFAULT_TAB = "__default__";
  static SORT_STEP = 1000;

  /**
   * Stable identifier for a talent in the rendered talent list. The merged list is keyed by
   * itemId (falling back to name), matching what the rest of the sheet uses.
   */
  static talentKey(talent) {
    if (!talent) return "";
    return String(talent.itemId || talent.name || "");
  }

  /** Return a normalized organization object (never null). */
  static get(actor) {
    const raw = actor?.getFlag?.("starwarsffg", TalentOrganization.FLAG) || {};
    return {
      enabled: !!raw.enabled,
      defaultCollapsed: !!raw.defaultCollapsed,
      tabs: Array.isArray(raw.tabs) ? raw.tabs.map((t) => ({
        id: t.id,
        name: t.name ?? "",
        collapsed: !!t.collapsed,
      })) : [],
      assignments: (raw.assignments && typeof raw.assignments === "object") ? foundry.utils.deepClone(raw.assignments) : {},
    };
  }

  static async save(actor, org) {
    return actor.setFlag("starwarsffg", TalentOrganization.FLAG, org);
  }

  static isEnabled(actor) {
    return TalentOrganization.get(actor).enabled;
  }

  /**
   * Build the grouped, ordered structure used by the template.
   * @param {Actor} actor
   * @param {Array} talentList - the (already merged) list of talents to display
   * @returns {{enabled: boolean, groups: Array}}
   */
  static buildGroups(actor, talentList) {
    const org = TalentOrganization.get(actor);
    const list = Array.isArray(talentList) ? talentList : [];

    if (!org.enabled) {
      return { enabled: false, groups: [] };
    }

    // valid tab ids (plus the implicit default)
    const validTabIds = new Set([TalentOrganization.DEFAULT_TAB, ...org.tabs.map((t) => t.id)]);

    // bucket talents by their assigned tab (unknown/missing -> default)
    const buckets = {};
    buckets[TalentOrganization.DEFAULT_TAB] = [];
    for (const tab of org.tabs) buckets[tab.id] = [];

    list.forEach((talent, index) => {
      const key = TalentOrganization.talentKey(talent);
      const assignment = org.assignments[key];
      let tabId = assignment?.tab;
      if (!tabId || !validTabIds.has(tabId)) tabId = TalentOrganization.DEFAULT_TAB;
      const sort = Number.isFinite(assignment?.sort) ? assignment.sort : (index + 1) * TalentOrganization.SORT_STEP;
      buckets[tabId].push({ ...talent, talentKey: key, _sort: sort, _index: index });
    });

    const sortBucket = (arr) => arr.sort((a, b) => (a._sort - b._sort) || (a._index - b._index));

    const groups = [];
    // default group always first
    groups.push({
      id: TalentOrganization.DEFAULT_TAB,
      name: game.i18n.localize("SWFFG.TalentOrganization.DefaultTab"),
      collapsed: org.defaultCollapsed,
      isDefault: true,
      talents: sortBucket(buckets[TalentOrganization.DEFAULT_TAB]),
    });
    // then user tabs in their defined order
    for (const tab of org.tabs) {
      groups.push({
        id: tab.id,
        name: tab.name,
        collapsed: tab.collapsed,
        isDefault: false,
        talents: sortBucket(buckets[tab.id]),
      });
    }

    return { enabled: true, groups };
  }

  static async setEnabled(actor, enabled) {
    const org = TalentOrganization.get(actor);
    org.enabled = !!enabled;
    return TalentOrganization.save(actor, org);
  }

  static async addTab(actor, name) {
    const org = TalentOrganization.get(actor);
    org.enabled = true;
    org.tabs.push({
      id: `tab_${foundry.utils.randomID()}`,
      name: name || game.i18n.localize("SWFFG.TalentOrganization.NewTab"),
      collapsed: false,
    });
    return TalentOrganization.save(actor, org);
  }

  static async renameTab(actor, tabId, name) {
    const org = TalentOrganization.get(actor);
    const tab = org.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.name = name;
    return TalentOrganization.save(actor, org);
  }

  static async toggleCollapse(actor, tabId) {
    const org = TalentOrganization.get(actor);
    if (tabId === TalentOrganization.DEFAULT_TAB) {
      org.defaultCollapsed = !org.defaultCollapsed;
      return TalentOrganization.save(actor, org);
    }
    const tab = org.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.collapsed = !tab.collapsed;
    return TalentOrganization.save(actor, org);
  }

  /**
   * Reorder a tab, placing it before `beforeTabId` (or at the end if null). Dropping before the
   * implicit default tab places it first among the user tabs.
   */
  static async moveTab(actor, tabId, beforeTabId = null) {
    const org = TalentOrganization.get(actor);
    const idx = org.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const [tab] = org.tabs.splice(idx, 1);
    let insertIndex = org.tabs.length;
    if (beforeTabId && beforeTabId !== TalentOrganization.DEFAULT_TAB) {
      const bi = org.tabs.findIndex((t) => t.id === beforeTabId);
      if (bi >= 0) insertIndex = bi;
    } else if (beforeTabId === TalentOrganization.DEFAULT_TAB) {
      insertIndex = 0;
    }
    org.tabs.splice(insertIndex, 0, tab);
    return TalentOrganization.save(actor, org);
  }

  static async deleteTab(actor, tabId) {
    const org = TalentOrganization.get(actor);
    org.tabs = org.tabs.filter((t) => t.id !== tabId);
    // any talents assigned to the removed tab fall back to the default group
    for (const key of Object.keys(org.assignments)) {
      if (org.assignments[key]?.tab === tabId) {
        org.assignments[key].tab = TalentOrganization.DEFAULT_TAB;
      }
    }
    return TalentOrganization.save(actor, org);
  }

  /**
   * Move a talent into a tab, positioned before `beforeKey` (or at the end if null).
   * Re-numbers sort values for every talent in the destination tab so ordering is stable.
   * @param {Actor} actor
   * @param {Array} talentList - the merged talent list (for current ordering)
   * @param {string} movedKey
   * @param {string} targetTabId
   * @param {string|null} beforeKey - talentKey of the row to insert before, or null for end
   */
  static async moveTalent(actor, talentList, movedKey, targetTabId, beforeKey = null) {
    const org = TalentOrganization.get(actor);
    org.enabled = true;
    const validTabIds = new Set([TalentOrganization.DEFAULT_TAB, ...org.tabs.map((t) => t.id)]);
    if (!validTabIds.has(targetTabId)) targetTabId = TalentOrganization.DEFAULT_TAB;

    // current ordering of the destination tab (using the same logic as buildGroups)
    const built = TalentOrganization.buildGroups(actor, talentList);
    const targetGroup = built.groups.find((g) => g.id === targetTabId);
    let orderedKeys = targetGroup ? targetGroup.talents.map((t) => t.talentKey) : [];

    // remove the moved talent if it is already in this tab, then insert at the target spot
    orderedKeys = orderedKeys.filter((k) => k !== movedKey);
    let insertIndex = orderedKeys.length;
    if (beforeKey) {
      const idx = orderedKeys.indexOf(beforeKey);
      if (idx >= 0) insertIndex = idx;
    }
    orderedKeys.splice(insertIndex, 0, movedKey);

    // persist explicit tab + sort for everything now in the destination tab
    orderedKeys.forEach((key, index) => {
      org.assignments[key] = { tab: targetTabId, sort: (index + 1) * TalentOrganization.SORT_STEP };
    });

    return TalentOrganization.save(actor, org);
  }
}
