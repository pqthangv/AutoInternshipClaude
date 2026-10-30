/* Injects autofill.js into every frame of a tab it's allowed to touch, runs it,
   and adds up the results. Used by the popup and the keyboard shortcut. */
async function runFill(tabId) {
  const target = { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: ['autofill.js'] });
  const results = await chrome.scripting.executeScript({
    target,
    func: () => (globalThis.__applyfile ? globalThis.__applyfile.fill() : null),
  });
  return results.reduce((sum, r) => {
    const v = r && r.result;
    if (v) {
      sum.filled += v.filled;
      sum.left += v.left;
      if (v.resume) sum.resume = v.resume;
    }
    return sum;
  }, { filled: 0, left: 0, resume: null });
}
