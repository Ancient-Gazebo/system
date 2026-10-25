/**
 * New chat messages pull the chat log down to them.
 *
 * Core scrolls the log for a new message only while the log is already at its bottom, or for the
 * user's own message (ChatLog##postOne), and does it once, after every image in the log has loaded.
 * That leaves the newest card out of view in two common ways:
 *   - "at the bottom" means within the last 1% of the log and is re-read only when the log scrolls,
 *     so after scrolling up to read anything, the log stops following new messages altogether;
 *   - a card keeps growing after that one scroll: this system's render hook rewrites a roll card
 *     after an await, Spend Results, talent pills and special ammo append to it, and art loads late.
 * So each new message scrolls the log to its bottom and keeps it there for a moment while the card
 * settles. Scrolling by hand in that moment hands control straight back. A message that arrives
 * while the chat log is out of sight (another sidebar tab, a collapsed sidebar) is followed when the
 * log is shown again. A client setting, on by default.
 */

const SETTING = "followNewChatMessages";
/** How long a new message keeps the log pinned to its bottom, in ms. */
const SETTLE_MS = 2000;

let pinnedUntil = 0;
let pendingWhileHidden = false;
/** @type {ResizeObserver|null} */
let resizeObserver = null;
const watched = new WeakSet();

/** The chat log and its popout, where rendered. */
function chatApps() {
  return [ui.chat, ui.chat?.popout].filter((app) => app?.rendered && app.element);
}

/**
 * Scroll every chat log on screen to its end.
 * @returns {boolean} whether any log was on screen
 */
function scrollToEnd() {
  let shown = false;
  for (const app of chatApps()) {
    const scroll = app.element.querySelector(".chat-scroll");
    if (!scroll) continue;
    watch(scroll);
    // zero height: the log is hidden behind another sidebar tab or a collapsed sidebar
    if (!scroll.clientHeight) continue;
    shown = true;
    scroll.scrollTop = scroll.scrollHeight;
  }
  return shown;
}

/**
 * Follow a log's growth while pinned, and give control back as soon as the user scrolls it.
 * @param {HTMLElement} scroll  the log's `.chat-scroll`
 */
function watch(scroll) {
  if (watched.has(scroll)) return;
  watched.add(scroll);
  const log = scroll.querySelector(".chat-log");
  if (log) resizeObserver.observe(log);
  const release = () => {
    pinnedUntil = 0;
  };
  scroll.addEventListener("wheel", release, { passive: true });
  scroll.addEventListener("touchmove", release, { passive: true });
  // a press on the scroller itself rather than on a card is a grab of its scrollbar
  scroll.addEventListener("pointerdown", (event) => {
    if (event.target === scroll) release();
  });
}

function follow() {
  pinnedUntil = Date.now() + SETTLE_MS;
  pendingWhileHidden = !scrollToEnd();
}

/** Register the per-user setting. Call at init. */
export function registerChatFollowSettings() {
  game.settings.register("starwarsffg", SETTING, {
    name: "SWFFG.Settings.FollowNewChatMessages.Name",
    hint: "SWFFG.Settings.FollowNewChatMessages.Hint",
    scope: "client",
    config: true,
    default: true,
    type: Boolean,
  });
}

/** Start following new messages. Call once, at ready. */
export function registerChatFollow() {
  resizeObserver = new ResizeObserver(() => {
    if (Date.now() < pinnedUntil) scrollToEnd();
  });
  Hooks.on("createChatMessage", (message) => {
    // a whisper between others is not shown here, so there is nothing to follow
    if (!message.visible || !game.settings.get("starwarsffg", SETTING)) return;
    follow();
  });
  // A message that came in while the log was out of sight: follow it once the log is shown.
  Hooks.on("changeSidebarTab", (app) => {
    if (pendingWhileHidden && app === ui.chat) follow();
  });
  Hooks.on("collapseSidebar", (_sidebar, collapsed) => {
    if (pendingWhileHidden && !collapsed) follow();
  });
}
