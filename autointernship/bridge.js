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
    document.documentElement.appendChild(root);
  }

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
  function reportText(r) {
    if (!r.ok) return `AutoInternship couldn't fill this page: ${r.error}`;
    const lines = [`AutoInternship report: filled ${r.filled}, left ${r.left}.`];
    const list = (title, items, fmt) => { if (items.length) lines.push('', title, ...items.map((x) => `- ${fmt(x)}`)); };
    list('Filled:', r.fields, (f) => `${f.label}: ${f.value}`);
    list('Already filled (not changed):', r.prefilled, (f) => `${f.label}: ${f.value}`);
    list('Left for you or Claude:', r.todo, (t) => {
      const about = [t.kind, t.required ? 'required' : ''].filter(Boolean).join(', ');
      return `${t.label} (${about})${t.options ? `. Choices: ${t.options.join(' | ')}` : ''}`;
    });
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

  // Shows the button once the frame has a form (forms often load after the page), or hides it when the
  // switch is turned off.
  function update(on) {
    clearInterval(timer);
    if (!on) { if (root) root.remove(); root = null; return; }
    const check = () => { if (!root && hasForm()) build(); if (root) clearInterval(timer); };
    check();
    if (!root) timer = setInterval(check, 1500);
  }

  const isOn = (settings) => !settings || settings.fillButton !== false;
  chrome.storage.local.get('settings').then(({ settings }) => update(isOn(settings)));
  chrome.storage.onChanged.addListener((changes) => { if (changes.settings) update(isOn(changes.settings.newValue)); });
})();
