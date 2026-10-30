/* Fill button
   Claude in Chrome can't press AutoInternship's shortcut, open its popup or run JavaScript on a page,
   but it can click and read. So on application pages this adds a small "Fill with AutoInternship" button.
   Clicking it fills the page, and a panel beside it lists what was filled, what was already filled and
   what's left. Claude (or you) reads that panel instead of the whole form, which saves time and tokens.

   Only real clicks count: yours, or Claude's, which reach Chrome as real mouse input. A page's own scripts
   can't fake one (event.isTrusted is false for script clicks), so a page can't start a fill by itself.

   Runs on the application sites listed in manifest.json. The button appears only in frames that have a
   form, and only while "Show the Fill button on application pages" is on (the default). On multi-step
   forms (Workday's "Save and Continue"), click it again on each step. It never attaches your stored
   resume, because Claude attaches one tailored to each job; the popup and shortcut still do. */
(() => {
  if (window.__autointernshipButton) return;
  window.__autointernshipButton = true;

  const GREEN = '#1E7B4E';
  let root = null;   // our elements on the page, or null while the button isn't shown
  let timer = null;

  // A frame has a form once it shows a few fields. Job postings without one get no button.
  const hasForm = () => document.querySelectorAll('input:not([type=hidden]), select, textarea, button[aria-haspopup="listbox"]').length >= 3;

  // Inline styles with "all: initial" first, so the site's own CSS can't restyle or hide our elements.
  const css = (el, s) => el.setAttribute('style', `all: initial; box-sizing: border-box; font: 13px/1.45 system-ui, sans-serif; ${s}`);

  function build() {
    root = document.createElement('div');
    root.id = 'autointernship';
    // A tab on the right edge, about a third of the way down the page (or the embedded form's frame).
    // Not in a corner, where sites keep their own menus. The report opens just below the button.
    css(root, 'position: fixed; right: 0; top: 35%; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end;');

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'autointernship-fill-button';
    button.textContent = 'Fill with AutoInternship';
    css(button, `cursor: pointer; background: ${GREEN}; color: #fff; font-weight: 600; padding: 8px 12px; border-radius: 8px 0 0 8px; box-shadow: 0 2px 6px rgba(0,0,0,.25);`);
    button.addEventListener('click', (e) => { if (e.isTrusted) run(button); });

    const panel = document.createElement('div');
    panel.id = 'autointernship-report';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-label', 'AutoInternship report');
    css(panel, 'display: none; width: 340px; max-height: 50vh; overflow: auto; margin-top: 6px; padding: 10px 12px; background: #fff; color: #1d1d1b; border: 1px solid #ccc; border-radius: 8px 0 0 8px; box-shadow: 0 2px 10px rgba(0,0,0,.2); white-space: pre-wrap;');

    root.append(button, panel);
    attach();
    keeper.observe(document, { childList: true, subtree: true });
  }

  // Inside <body>, so the report is part of the page text Claude reads (text outside <body> is often skipped).
  const attach = () => (document.body || document.documentElement).appendChild(root);

  // Some sites replace the whole page when their scripts finish loading (Greenhouse's job boards do,
  // a few seconds in on a slow connection), which takes the button with it. Watch for that and put it
  // straight back, so it doesn't vanish for a moment or for good.
  const keeper = new MutationObserver(() => { if (root && !root.isConnected) attach(); });

  async function run(button) {
    button.disabled = true;
    button.textContent = 'Filling…';
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: 'autointernship:fill' });
    } catch (_) {
      r = { ok: false, error: 'AutoInternship was updated. Reload this page and try again.' };
    }
    showReport(r || { ok: false, error: 'No answer from AutoInternship.' });
    button.disabled = false;
    button.textContent = 'Fill with AutoInternship';
  }

  // The report as plain text, so it reads the same on screen, in a screenshot and in the page text.
  // Kept short on purpose, because Claude reads all of it on every page: what's left (the part to act on)
  // comes first, one line each; what was filled follows as one compact line, since it's only needed for
  // the application record. Long labels, values and choice lists are cut with "…" (full values are in
  // the profile).
  const KIND = { textarea: 'text box', 'custom dropdown': 'dropdown', radio: 'choice' };
  const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
  const choices = (opts) => opts.slice(0, 8).map((o) => cut(o, 30)).join(' | ') + (opts.length > 8 ? ` | +${opts.length - 8} more` : '');
  const pair = (f) => `${cut(f.label, 60)} = ${cut(f.value, 60)}`;

  function reportText(r) {
    if (!r.ok) return `AutoInternship couldn't fill this page: ${r.error}`;
    const lines = [`AutoInternship report: filled ${r.filled}, left ${r.left}.`];
    if (r.todo.length) {
      lines.push('', 'Left for you or Claude (* = required):', ...r.todo.map((t) =>
        `- ${cut(t.label, 90)}${t.required ? '*' : ''} (${KIND[t.kind] || t.kind}${t.options ? `: ${choices(t.options)}` : ''})`));
    }
    if (r.fields.length) lines.push('', `Filled: ${r.fields.map(pair).join(' · ')}`);
    if (r.prefilled.length) lines.push('', `Already filled: ${r.prefilled.map(pair).join(' · ')}`);
    return lines.join('\n');
  }

  function showReport(r) {
    const panel = root.querySelector('#autointernship-report');
    panel.textContent = reportText(r);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close AutoInternship report');
    css(close, 'display: block; margin-top: 8px; cursor: pointer; color: #555; text-decoration: underline;');
    close.addEventListener('click', () => { panel.style.display = 'none'; });
    panel.appendChild(close);
    panel.style.display = 'block';
  }

  // While the switch is on, checks every 1.5 seconds: shows the button once the frame has a form (forms
  // often load after the page), and as a backup to the keeper above, puts it back if a redraw dropped it.
  // Turning the switch off removes it.
  function update(on) {
    clearInterval(timer);
    if (!on) { keeper.disconnect(); if (root) root.remove(); root = null; return; }
    const check = () => {
      if (!root) { if (hasForm()) build(); } else if (!root.isConnected) attach();
    };
    check();
    timer = setInterval(check, 1500);
  }

  const isOn = (settings) => !settings || settings.fillButton !== false;
  chrome.storage.local.get('settings').then(({ settings }) => update(isOn(settings)));
  chrome.storage.onChanged.addListener((changes) => { if (changes.settings) update(isOn(changes.settings.newValue)); });
})();
