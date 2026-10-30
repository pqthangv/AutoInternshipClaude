/* Keyboard shortcut, first-run setup, and fills started from the Fill button on the page (bridge.js). */
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

// The Fill button (bridge.js) can't inject autofill.js itself, so it asks here after a real click.
// Only AutoInternship's own scripts can send this message; web pages can't. It fills only the frame
// that asked, and never attaches the stored resume, because Claude attaches one tailored to each job.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'autointernship:fill' || !sender.tab) return false;
  (async () => {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings && settings.fillButton === false) return reply({ ok: false, error: 'The Fill button is turned off on the AutoInternship profile page.' });
    const r = await runFill(sender.tab.id, { frameId: sender.frameId, skipResume: true });
    badge(sender.tab.id, String(r.filled), '#1E7B4E');
    reply({ ok: true, ...r });
  })().catch((err) => reply({ ok: false, error: String((err && err.message) || err) }));
  return true; // the reply comes later
});

function badge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 6000);
}
