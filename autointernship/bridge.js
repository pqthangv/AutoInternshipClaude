/* Claude bridge
   Claude in Chrome can't press AutoInternship's keyboard shortcut (its key presses go straight to the page, so
   Chrome's extension shortcuts never see them). This lets Claude start a fill with a page message instead.

   It runs on the application sites listed in manifest.json and only listens. The background does the fill,
   and only when "Let Claude start fills" is on and the message carries the key from your profile
   (claudeKey in profile.json).

   From JavaScript on the page:
     window.postMessage({ type: 'autointernship:fill', key: '<claudeKey>', id: 'any id' }, '*')
   For a form inside an iframe (a Greenhouse form embedded in a company's careers page, for example),
   post the same message to that iframe's contentWindow. Only frames on the listed sites answer.

   The answer comes back as a message to the window that asked:
     { type: 'autointernship:result', id, frame, ok, filled, left,
       fields:    [{ label, value }],                     filled just now, with the value now on the page
       prefilled: [{ label, value }],                     already had a value; left as it was
       todo:      [{ label, kind, options?, required? }], left for Claude or you
       error? }                                            when ok is false
   It fills only the current page. On multi-step forms (Workday), send it again after each
   "Save and Continue". Nothing is sent anywhere else. */
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'autointernship:fill' || typeof d.key !== 'string' || !e.source) return;
  const source = e.source;
  // Answer only the window that asked (the report holds your details), at the origin it asked from.
  const origin = e.origin && e.origin !== 'null' ? e.origin : '*';
  const answer = (r) => source.postMessage({ type: 'autointernship:result', id: d.id, frame: location.href, ...r }, origin);
  try {
    chrome.runtime.sendMessage({ type: 'autointernship:fill', key: d.key }, (r) => {
      const err = chrome.runtime.lastError;
      answer(r || { ok: false, error: err ? err.message : 'No answer from AutoInternship.' });
    });
  } catch (err) {
    // Happens when AutoInternship was reloaded after this page opened.
    answer({ ok: false, error: 'AutoInternship was updated. Reload this page and try again.' });
  }
});
