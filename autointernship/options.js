const $ = (s, root = document) => root.querySelector(s);
const LISTS = ['work', 'projects', 'education', 'savedAnswers'];
const MAX_RESUME = 4 * 1024 * 1024;

let profile = AutoInternship.defaults();
let saveTimer = null;

/* ---------- Saving ---------- */

function setStatus(text, saved) {
  const el = $('#saveStatus');
  el.textContent = text;
  el.classList.toggle('saved', saved);
}

function scheduleSave() {
  setStatus('Saving…', false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

async function save() {
  try {
    await chrome.storage.local.set({ profile });
    setStatus('Saved', true);
  } catch (err) {
    setStatus(`Not saved: ${err.message}`, false);
  }
}

/* ---------- Rendering ---------- */

function renderFields() {
  document.querySelectorAll('[data-key]').forEach((el) => { el.value = profile[el.dataset.key] ?? ''; });
}

function renderList(kind) {
  const box = $(`[data-list="${kind}"]`);
  const tpl = $(`#${kind}Tpl`);
  box.textContent = '';
  profile[kind].forEach((item, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.index = i;
    node.querySelectorAll('[data-field]').forEach((el) => { el.value = item[el.dataset.field] ?? ''; });
    const up = node.querySelector('[data-action="up"]');
    if (up) up.disabled = i === 0;
    box.appendChild(node);
  });
  $(`[data-empty="${kind}"]`).hidden = profile[kind].length > 0;
}

function renderAll() {
  renderFields();
  LISTS.forEach(renderList);
}

// The self-identification dropdowns get their choices from shared.js, where autofill.js's matching
// codes are listed too. Runs before the first render, so saved choices show up.
document.querySelectorAll('select[data-choices]').forEach((sel) => {
  for (const [value, text] of Object.entries(AutoInternship.SELF_ID_LABELS[sel.dataset.choices])) sel.add(new Option(text, value));
});

/* ---------- Editing ---------- */

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.key) {
    profile[el.dataset.key] = el.value;
    scheduleSave();
  } else if (el.dataset.field) {
    const entry = el.closest('[data-index]');
    const kind = entry.parentElement.dataset.list;
    profile[kind][Number(entry.dataset.index)][el.dataset.field] = el.value;
    scheduleSave();
  }
});

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const kind = add.dataset.add;
    profile[kind].push(AutoInternship.blank[kind]());
    renderList(kind);
    const entries = $(`[data-list="${kind}"]`).children;
    const first = entries[entries.length - 1].querySelector('input, textarea');
    if (first) first.focus();
    scheduleSave();
    return;
  }
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const entry = action.closest('[data-index]');
  const kind = entry.parentElement.dataset.list;
  const i = Number(entry.dataset.index);
  if (action.dataset.action === 'remove') {
    profile[kind].splice(i, 1);
  } else if (action.dataset.action === 'up' && i > 0) {
    [profile[kind][i - 1], profile[kind][i]] = [profile[kind][i], profile[kind][i - 1]];
  }
  renderList(kind);
  scheduleSave();
});

/* ---------- Resume ---------- */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function renderResume() {
  const { resume } = await chrome.storage.local.get('resume');
  const info = $('#resumeInfo');
  info.textContent = '';
  if (resume) {
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = resume.name;
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = `  ${AutoInternship.prettyBytes(resume.size || 0)}`;
    info.append(name, meta);
    $('#resumePick').textContent = 'Replace file';
  } else {
    const empty = document.createElement('span');
    empty.className = 'file-meta';
    empty.textContent = 'No resume attached yet.';
    info.append(empty);
    $('#resumePick').textContent = 'Choose file';
  }
  $('#resumeRemove').hidden = !resume;
}

function resumeError(text) {
  $('#resumeError').textContent = text;
  $('#resumeError').hidden = !text;
}

$('#resumePick').addEventListener('click', () => $('#resumeFile').click());

$('#resumeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  resumeError('');
  if (file.size > MAX_RESUME) {
    resumeError(`${file.name} is ${AutoInternship.prettyBytes(file.size)}. Use a file under 4 MB, such as a PDF export without large images.`);
    return;
  }
  try {
    const data = await fileToBase64(file);
    await chrome.storage.local.set({ resume: { name: file.name, type: file.type, size: file.size, data } });
    renderResume();
  } catch (err) {
    resumeError(`Couldn’t save ${file.name}: ${err.message}`);
  }
});

$('#resumeRemove').addEventListener('click', async () => {
  await chrome.storage.local.remove('resume');
  renderResume();
});

/* ---------- Fill button ---------- */

// Whether bridge.js shows the "Fill with AutoInternship" button on application pages. It's a setting of
// this browser, not part of your profile, so it's stored separately and isn't in the backup. On by default.
async function renderFillButton() {
  const { settings } = await chrome.storage.local.get('settings');
  $('#fillButton').checked = !settings || settings.fillButton !== false;
}

$('#fillButton').addEventListener('change', async (e) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), fillButton: e.target.checked } });
});

/* ---------- Backup ---------- */

function flash(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1600);
}

// Named profile.json because that's the file the internship-application skill reads from the job-search folder.
$('#exportJson').addEventListener('click', (e) => {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  AutoInternship.download('profile.json', blob);
  flash(e.currentTarget, 'Downloaded');
});

$('#importPick').addEventListener('click', () => $('#importJson').click());

$('#importJson').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const note = $('#importNote');
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a profile');
    const next = AutoInternship.tidyProfile(Object.assign(AutoInternship.defaults(), data));
    for (const kind of LISTS) {
      next[kind] = Array.isArray(next[kind])
        ? next[kind].filter((x) => x && typeof x === 'object').map((x) => Object.assign(AutoInternship.blank[kind](), x))
        : [];
    }
    profile = next;
    renderAll();
    await save();
    note.textContent = `Restored from ${file.name}.`;
  } catch (_) {
    note.textContent = `${file.name} isn’t an AutoInternship backup. Choose the .json file you downloaded from this page.`;
  }
});

/* ---------- Start ---------- */

(async () => {
  const { profile: stored } = await chrome.storage.local.get('profile');
  profile = AutoInternship.tidyProfile(Object.assign(AutoInternship.defaults(), stored || {}));
  for (const kind of LISTS) if (!Array.isArray(profile[kind])) profile[kind] = [];
  renderAll();
  renderResume();
  renderFillButton();
})();
