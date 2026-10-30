/* Injects autofill.js into a tab, runs it, and adds up the results. Used by the popup, the keyboard
   shortcut and the Fill button on the page (bridge.js).
     opts.frameId     fill only this frame (the Fill button fills the frame it's in); otherwise every
                      frame AutoInternship is allowed to touch
     opts.skipResume  don't attach the stored resume (Claude attaches one tailored to the job) */
async function runFill(tabId, opts = {}) {
  const target = opts.frameId == null ? { tabId, allFrames: true } : { tabId, frameIds: [opts.frameId] };
  await chrome.scripting.executeScript({ target, files: ['autofill.js'] });
  const results = await chrome.scripting.executeScript({
    target,
    func: (o) => (globalThis.__autointernship ? globalThis.__autointernship.fill(o) : null),
    args: [{ skipResume: !!opts.skipResume }],
  });
  return results.reduce((sum, r) => {
    const v = r && r.result;
    if (v) {
      sum.filled += v.filled;
      sum.left += v.left;
      if (v.resume) sum.resume = v.resume;
      sum.fields.push(...(v.fields || []));
      sum.prefilled.push(...(v.prefilled || []));
      sum.todo.push(...(v.todo || []));
    }
    return sum;
  }, { filled: 0, left: 0, resume: null, fields: [], prefilled: [], todo: [] });
}
