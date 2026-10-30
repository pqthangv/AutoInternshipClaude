/* Keyboard shortcut, first-run setup, and fills Claude asks for through the bridge. */
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

// The Claude bridge (bridge.js) can't inject autofill.js itself, so it asks here. A fill only runs when
// "Let Claude start fills" is on (which saves a random claudeKey in your profile) and the request carries
// that key, so other pages can't start one. It fills only the frame that asked, and never attaches the
// stored resume, because Claude attaches a resume tailored to each job.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'autointernship:fill' || !sender.tab) return false;
  (async () => {
    const { profile } = await chrome.storage.local.get('profile');
    const key = profile && profile.claudeKey;
    if (!key) return reply({ ok: false, error: 'Claude fills are off. Turn on "Let Claude start fills" on the AutoInternship profile page.' });
    if (msg.key !== key) return reply({ ok: false, error: 'Wrong key. Download the AutoInternship backup (profile.json) again and put it in the job-search folder.' });
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
