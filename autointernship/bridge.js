/* Fill button
   Claude in Chrome can't press AutoInternship's shortcut, open its popup or run JavaScript on a page,
   but it can click and read. So on application pages this adds a small "Fill with AutoInternship" button.
   Clicking it fills the page, and a panel beside it lists what was filled, what was already filled and
   what's left. You read the panel; Claude reads the same report from the page text (a hidden copy at the
   top of the form), and works through what's left instead of the whole form, which saves time and tokens.

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
  const FIELDS = 'input:not([type=hidden]), select, textarea, button[aria-haspopup="listbox"]';
  let root = null;   // our elements on the page, or null while the button isn't shown
  let timer = null;
  let copy = null;   // the report's text copy beside the form (see placeCopy), or null
  let copyFields = []; // the fields on the page when the copy was made

  // A frame has a form once it shows a few fields. Job postings without one get no button.
  const hasForm = () => document.querySelectorAll(FIELDS).length >= 3;

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
    css(panel, 'display: none; position: relative; width: 340px; margin-top: 6px; background: #fff; color: #1d1d1b; border: 1px solid #ccc; border-radius: 8px 0 0 8px; box-shadow: 0 2px 10px rgba(0,0,0,.2);');
    // The panel's text is in a shadow root: it shows on screen and in screenshots, but not in the page
    // text, which gets the copy beside the form instead (see placeCopy). Otherwise pages read whole would
    // carry the report twice. Only the text scrolls, so the close button stays in view on a long report.
    const text = document.createElement('div');
    text.id = 'autointernship-report-text';
    text.attachShadow({ mode: 'open' });
    css(text, 'display: block; max-height: 50vh; overflow: auto; padding: 10px 30px 10px 12px; white-space: pre-wrap;');

    // An × in the top corner. The right padding above keeps the text from running under it.
    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'autointernship-report-close';
    close.textContent = '×';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close AutoInternship report');
    css(close, 'position: absolute; top: 4px; right: 6px; width: 24px; height: 24px; cursor: pointer; text-align: center; font-size: 20px; line-height: 22px; color: #555;');
    close.addEventListener('click', hideReport);

    panel.append(text, close);
    root.append(button, panel);
    attach();
    keeper.observe(document, { childList: true, subtree: true });
  }

  const attach = () => (document.body || document.documentElement).appendChild(root);

  // Some sites replace the whole page when their scripts finish loading (Greenhouse's job boards do,
  // a few seconds in on a slow connection), which takes the button with it. Watch for that and put it
  // straight back, so it doesn't vanish for a moment or for good. It also drops the report once the
  // fields it describes are gone (Workday's next step), so nobody reads a stale list.
  const keeper = new MutationObserver(() => {
    if (root && !root.isConnected) attach();
    if (copy && copyFields.filter((f) => f.isConnected).length < copyFields.length / 2) hideReport();
  });

  // Claude reads pages with get_page_text, which keeps only the page's main content when there is one
  // (<main>, <article> or a content <div>). The panel lives in <body>, outside all of those, so on
  // Greenhouse job boards and Workday, Claude never saw the report and found every field by screenshot.
  // The form is always in the part that's kept, so a copy of the report goes at the top of it: the <form>
  // with the most fields, or else the closest element holding them all (fields in the site's header or
  // menu don't count). The copy is hidden the way "Skip to main content" links are: invisible and taking
  // no space, but still part of the page text.
  function placeCopy(textValue) {
    removeCopy();
    const fields = [...document.querySelectorAll(FIELDS)].filter((f) => !root.contains(f) && f.getClientRects().length
      && !f.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="search"]'));
    if (!fields.length) return;
    const forms = new Map();
    for (const f of fields) { const form = f.closest('form'); if (form) forms.set(form, (forms.get(form) || 0) + 1); }
    let anchor = null;
    let most = 2;
    for (const [form, n] of forms) if (n > most) { anchor = form; most = n; }
    if (!anchor) {
      anchor = fields[0].parentElement;
      while (anchor && !fields.every((f) => anchor.contains(f))) anchor = anchor.parentElement;
    }
    if (!anchor) return;
    copy = document.createElement('div');
    copy.id = 'autointernship-report-copy';
    css(copy, 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: pre-wrap;');
    copy.textContent = textValue;
    anchor.prepend(copy);
    copyFields = fields;
  }

  function removeCopy() {
    if (copy) copy.remove();
    copy = null;
    copyFields = [];
  }

  function hideReport() {
    removeCopy();
    const panel = root && root.querySelector('#autointernship-report');
    if (panel) panel.style.display = 'none';
  }

  async function run(button) {
    hideReport(); // the last report is out of date as soon as a new fill starts
    // A fill with many dropdowns takes several seconds. A page read in the meantime should say so,
    // rather than look like a page with no report at all (which sends Claude back to screenshots).
    placeCopy('AutoInternship report: still filling this page. Wait a few seconds and read the page again.');
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
  // the profile). Name boxes the site filled differently from the profile get their own "Check" lines
  // up top, because a wrong name is easy to miss in the compact line; on most pages there are none.
  // So does a graduation date the form didn't offer, where the closest one was picked instead: the record
  // should say what the form says and what the real date is.
  const KIND = { textarea: 'text box', 'custom dropdown': 'dropdown', radio: 'choice' };
  const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
  const choices = (opts) => opts.slice(0, 8).map((o) => cut(o, 30)).join(' | ') + (opts.length > 8 ? ` | +${opts.length - 8} more` : '');
  const pair = (f) => `${cut(f.label, 60)} = ${cut(f.value, 60)}`;

  function reportText(r) {
    if (!r.ok) return `AutoInternship couldn't fill this page: ${r.error}`;
    // The saved-answer count lets Claude see when the extension is behind profile.json (see autofill.js).
    const tidied = r.tidied || [];
    const lines = [`AutoInternship report: filled ${r.filled}, left ${r.left}${tidied.length ? `, tidied ${tidied.length}` : ''}.${r.saved != null ? ` Profile: ${r.saved} saved answers.` : ''}`];
    const differ = r.prefilled.filter((f) => f.profile);
    const same = r.prefilled.filter((f) => !f.profile);
    if (differ.length) {
      lines.push('', 'Check: the site filled these differently from the profile:', ...differ.map((f) => `- ${pair(f)} (profile: ${cut(f.profile, 60)})`));
    }
    const nearest = r.fields.filter((f) => f.profile);
    if (nearest.length) {
      lines.push('', "Check: the profile's date isn't offered, so the closest one was picked:", ...nearest.map((f) => `- ${pair(f)} (profile: ${cut(f.profile, 60)})`));
    }
    if (r.todo.length) {
      lines.push('', 'Left for you or Claude (* = required):', ...r.todo.map((t) =>
        `- ${cut(t.label, 90)}${t.required ? '*' : ''} (${t.note || `${KIND[t.kind] || t.kind}${t.options ? `: ${choices(t.options)}` : ''}`})`));
    }
    // Work descriptions the site copied badly from the resume (see tidyDescription in autofill.js). Said in
    // full, because the record should mention it and Claude can't see the whole box otherwise.
    if (tidied.length) {
      lines.push('', 'Tidied (the site copied these badly from the resume):', ...tidied.map((t) => {
        const what = [t.removed && `removed "${cut(t.removed, 120)}"`, t.joined && `joined ${t.joined} broken line${t.joined > 1 ? 's' : ''}`];
        return `- ${cut(t.label, 60)}: ${what.filter(Boolean).join('; ')}`;
      }));
    }
    if (r.fields.length) lines.push('', `Filled: ${r.fields.map(pair).join(' · ')}`);
    if (same.length) lines.push('', `Already filled: ${same.map(pair).join(' · ')}`);
    return lines.join('\n');
  }

  function showReport(r) {
    const panel = root.querySelector('#autointernship-report');
    const value = reportText(r);
    panel.querySelector('#autointernship-report-text').shadowRoot.textContent = value;
    placeCopy(value);
    panel.style.display = 'block';
  }

  // While the switch is on, checks every 1.5 seconds: shows the button once the frame has a form (forms
  // often load after the page), and as a backup to the keeper above, puts it back if a redraw dropped it.
  // Turning the switch off removes it.
  function update(on) {
    clearInterval(timer);
    if (!on) { keeper.disconnect(); removeCopy(); if (root) root.remove(); root = null; return; }
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
