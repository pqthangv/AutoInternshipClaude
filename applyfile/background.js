/* Keyboard shortcut and first-run setup. */
importScripts('runner.js');

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-page' || !tab || tab.id == null) return;
  try {
    const r = await runFill(tab.id);
    badge(tab.id, String(r.filled), '#1E7B4E');
  } catch (_) {
    badge(tab.id, '!', '#A8650A');
  }
});

function badge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 6000);
}
