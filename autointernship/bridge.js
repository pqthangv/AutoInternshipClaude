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

  // Some forms are built from web components that keep their boxes in each component's shadow root
  // (SmartRecruiters' application form). A plain querySelectorAll doesn't look in there, so those pages
  // got no button, and Claude's page tools don't either, so Claude had no file box to attach a resume to
  // (see "File boxes Claude can reach" below). These look inside open shadow roots; closed ones can't be read.
  function shadowRoots() {
    const out = [];
    const walk = (r) => { for (const el of r.querySelectorAll('*')) if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); } };
    walk(document);
    return out;
  }

  // The element in the page itself that holds el: el, or the outermost component it sits in.
  function outerHost(el) {
    let n = el;
    for (let r = n.getRootNode(); r !== document && r.host; r = n.getRootNode()) n = r.host;
    return n;
  }

  const ours = (el) => !!outerHost(el).closest('#autointernship, .autointernship-file');

  // The page's fields, its own first, then those inside components; ours don't count. Stops at `limit`.
  function pageFields(roots, limit = Infinity) {
    const out = [];
    for (const r of [document, ...roots]) {
      for (const f of r.querySelectorAll(FIELDS)) {
        if (ours(f)) continue;
        out.push(f);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  // A frame has a form once it shows a few fields. Job postings without one get no button.
  const hasForm = (roots = shadowRoots()) => pageFields(roots, 3).length >= 3;

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
  // no space, but still part of the page text. A field inside a component counts as the component, since
  // the copy has to go in the page itself (closest and contains stop at a shadow root).
  function placeCopy(textValue) {
    removeCopy();
    const fields = pageFields(shadowRoots()).filter((f) => f.getClientRects().length
      && !outerHost(f).closest('header, nav, footer, [role="banner"], [role="navigation"], [role="search"]'));
    if (!fields.length) return;
    const hosts = fields.map(outerHost);
    const forms = new Map();
    for (const h of hosts) { const form = h.closest('form'); if (form) forms.set(form, (forms.get(form) || 0) + 1); }
    let anchor = null;
    let most = 2;
    for (const [form, n] of forms) if (n > most) { anchor = form; most = n; }
    if (!anchor) {
      anchor = hosts[0].parentElement;
      while (anchor && !hosts.every((h) => anchor.contains(h))) anchor = anchor.parentElement;
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
        const what = [t.removed && `removed "${cut(t.removed, 120)}"`, t.joined && `joined ${t.joined} broken line${t.joined > 1 ? 's' : ''}`,
          t.now != null && `"${cut(t.was, 40)}" → "${cut(t.now, 40)}"`]; // the phone number's format (tidyPhone)
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
  // The same checks keep the "Open this form on its own page" link and the file boxes in place (see below).
  // Turning the switch off removes them.
  function update(on) {
    clearInterval(timer);
    if (!on) {
      timer = null;
      keeper.disconnect(); removeCopy(); if (root) root.remove(); root = null;
      if (openLink) openLink.remove(); openLink = null; told = 0;
      for (const box of fileBoxes.values()) box.wrap.remove();
      fileBoxes.clear();
      return;
    }
    const check = () => {
      const roots = shadowRoots();
      if (!root) { if (hasForm(roots)) build(); } else if (!root.isConnected) attach();
      if (FRAMED_FORM()) tellTop();
      placeOpenLink();
      placeFileBoxes(roots);
    };
    check();
    timer = setInterval(check, 1500);
  }

  /* "Open this form on its own page"
     iCIMS shows its last step's forms (veteran, disability and similar self-ID forms) in a frame from another
     iCIMS address, and Claude's page tools can't see inside a frame: not the fields, not this report, not
     the signature box or Submit. The address of that frame isn't readable from the page either. So the
     frame tells the page above it, through background.js, and the page shows a link to the form's own
     address just above the frame. Opened that way the form is an ordinary page, Fill button included. */
  const FRAMED_FORM = () => window !== window.top && /\.icims\.com$/.test(location.hostname) && location.pathname.startsWith('/forms');
  let told = 0;       // tries at telling the page above (in a framed form)
  let openLink = null; // the link (on the page above)

  // In the framed form: tell the page above until it has the link (its script may load after ours).
  async function tellTop() {
    if (told < 0 || told > 20 || !hasForm()) return;
    told++;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'autointernship:framed-form' });
      if (r && r.ok) told = -1;
    } catch (_) { /* the extension was reloaded; nothing to do */ }
  }

  function showOpenLink(url) {
    if (!openLink) {
      openLink = document.createElement('a');
      openLink.id = 'autointernship-open-frame';
      openLink.textContent = 'Open this form on its own page (AutoInternship)';
      css(openLink, `display: inline-block; margin: 8px 0; padding: 6px 10px; border: 2px solid ${GREEN}; border-radius: 6px; color: ${GREEN}; font-weight: 600; text-decoration: underline; cursor: pointer;`);
    }
    openLink.href = url;
    placeOpenLink();
  }

  function placeOpenLink() {
    if (!openLink || openLink.isConnected) return;
    const host = new URL(openLink.href).host;
    const frame = document.querySelector('iframe#icims_formFrame')
      || [...document.querySelectorAll('iframe')].find((f) => { try { return new URL(f.src).host === host; } catch (_) { return false; } });
    if (frame && frame.parentNode) frame.parentNode.insertBefore(openLink, frame);
    else if (document.body) document.body.prepend(openLink);
  }

  /* File boxes Claude can reach
     A file box inside a component's shadow root has no reference in Claude's page tools, so its file upload
     tool can't reach it (SmartRecruiters' Resume box). Below each such box shown on the page goes a plain
     one of ours, named after its section ("Resume file (AutoInternship)"). A file put in ours is handed to
     the site's box, the way a file you pick reaches it, and a line under it says whether the form shows it. */
  const fileBoxes = new Map(); // the site's file box → ours
  let fileCount = 0;

  function placeFileBoxes(roots) {
    // First drop ours whose site box is gone (the site redrew it), so a new one takes its name.
    for (const [real, box] of fileBoxes) if (!real.isConnected) { box.wrap.remove(); fileBoxes.delete(real); }
    for (const r of roots) {
      if (root && root.contains(outerHost(r.host))) continue;
      for (const real of r.querySelectorAll('input[type="file"]')) {
        let box = fileBoxes.get(real);
        // r.host is the box's own component; the input itself is often hidden behind the component's label.
        if (real.disabled || !r.host.getClientRects().length) { if (box) box.wrap.remove(); continue; }
        if (!box) { box = makeFileBox(real); fileBoxes.set(real, box); }
        if (!box.wrap.isConnected) {
          const at = boxAnchor(real);
          if (!box.named) nameFileBox(box, at);
          if (at.parentElement && at !== document.body) at.after(box.wrap); else document.body.append(box.wrap);
        }
        // In case a file arrived without a change event (the upload tool sets files from outside the page).
        handOver(box);
      }
    }
  }

  // Ours goes just below the component, and outside any other component's children: one slotted into a
  // component (SmartRecruiters puts its file box inside a form-field component) would be laid out by it.
  function boxAnchor(real) {
    let h = outerHost(real);
    while (h.parentElement && h.parentElement.shadowRoot) h = h.parentElement;
    return h;
  }

  function makeFileBox(real) {
    const id = `autointernship-file-${++fileCount}`;
    const wrap = document.createElement('div');
    wrap.className = 'autointernship-file';
    css(wrap, `display: block; margin: 8px 0; padding: 8px 10px; border: 2px dashed ${GREEN}; border-radius: 6px; background: #fff; color: #1d1d1b;`);
    const label = document.createElement('label');
    label.htmlFor = id;
    css(label, 'display: block; font-weight: 600; margin-bottom: 4px;');
    const input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    if (real.accept) input.accept = real.accept;
    input.multiple = real.multiple;
    input.style.cssText = 'display: block; font: 13px system-ui, sans-serif;'; // not "all: initial": it hides the file button
    const status = document.createElement('div');
    css(status, 'display: block; margin-top: 4px; color: #555;');
    status.textContent = "A file put here goes to the form's box above.";
    wrap.append(label, input, status);
    const box = { wrap, label, input, status, real, named: false, sent: '' };
    input.addEventListener('change', () => handOver(box));
    input.addEventListener('input', () => handOver(box));
    return box;
  }

  // The section's name: the nearest short text above the component that isn't a question of its own
  // ("Resume"), else the box's own label, else "File".
  function nameFileBox(box, at) {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const hasFields = (el) => el.matches(FIELDS) || !!el.querySelector(FIELDS) || subRoots(el).some((r) => r.querySelector(FIELDS));
    let name = '';
    search: for (let n = at, up = 0; n && n !== document.body && up < 6; n = n.parentElement, up++) {
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.closest('#autointernship, .autointernship-file') || /^(STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/.test(s.tagName) || !s.getClientRects().length) continue;
        if (hasFields(s)) break search;
        const t = clean(s.textContent);
        if (t && t.length <= 60) { name = t; break search; }
      }
    }
    if (!name) name = clean([...(box.real.labels || [])].map((l) => l.textContent).join(' ') || box.real.getAttribute('aria-label'));
    // The box's own label is often just its button ("Choose a file or drop it here"), which names nothing.
    if (!name || name.length > 60 || /^(choose|select|browse|drop|upload|attach)( an?| your)? files?\b|^browse\b/i.test(name)) name = 'File';
    let full = /\bfile$/i.test(name) ? `${name} (AutoInternship)` : `${name} file (AutoInternship)`;
    const taken = new Set([...fileBoxes.values()].filter((b) => b !== box && b.named).map((b) => b.label.textContent));
    for (let i = 2; taken.has(full); i++) full = full.replace(/( \d+)? \(AutoInternship\)$/, ` ${i} (AutoInternship)`);
    box.label.textContent = full;
    box.input.setAttribute('aria-label', full);
    box.named = true;
  }

  // Shadow roots inside el (el's own included), for looking at a component's contents.
  function subRoots(el) {
    const out = [];
    const walk = (r) => { for (const n of r.querySelectorAll('*')) if (n.shadowRoot) { out.push(n.shadowRoot); walk(n.shadowRoot); } };
    if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); }
    walk(el);
    return out;
  }

  const deepText = (el) => [el.textContent, ...subRoots(el).map((r) => r.textContent)].join(' ');

  function handOver(box) {
    const files = [...(box.input.files || [])];
    if (!files.length) return;
    const key = files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');
    if (key === box.sent) return;
    box.sent = key;
    const send = box.real.multiple ? files : files.slice(0, 1);
    const names = send.map((f) => `"${f.name}"`).join(', ');
    try {
      const dt = new DataTransfer();
      for (const f of send) dt.items.add(f);
      box.real.files = dt.files;
      // composed: some components listen for these outside their own shadow root.
      box.real.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      box.real.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch (_) {
      box.status.textContent = "AutoInternship couldn't hand this file to the form. Attach it in the form's own box.";
      return;
    }
    box.status.textContent = `Handing ${names} to the form…`;
    // The site's box often empties itself once it has read the file, so whether it took it shows only in what
    // the form displays: the file's name, somewhere in the component above ours.
    const at = boxAnchor(box.real);
    const started = Date.now();
    const look = () => {
      if (box.sent !== key) return; // another file came since
      if (send.every((f) => deepText(at).includes(f.name))) {
        box.status.textContent = `The form shows ${names}.`;
        box.wrap.style.borderStyle = 'solid';
      } else if (Date.now() - started < 5000) {
        setTimeout(look, 300);
      } else {
        box.status.textContent = `Handed ${names} to the form, but the form doesn't show its name. Check it with a screenshot.`;
      }
    };
    setTimeout(look, 300);
  }

  // Only the page at the top shows the link; background.js sends it the framed form's own address.
  if (window === window.top) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg || msg.type !== 'autointernship:open-frame' || !timer) return false; // !timer: the switch is off
      showOpenLink(msg.url);
      reply({ ok: true });
      return false;
    });
  }

  const isOn = (settings) => !settings || settings.fillButton !== false;
  chrome.storage.local.get('settings').then(({ settings }) => update(isOn(settings)));
  chrome.storage.onChanged.addListener((changes) => { if (changes.settings) update(isOn(changes.settings.newValue)); });
})();
