const $ = (s) => document.querySelector(s);
const IS_EDGE = navigator.userAgent.includes('Edg/');
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function showResult(r) {
  $('#legend').classList.add('done');
  $('#filledText').textContent = r.filled ? `${count(r.filled, 'field', 'fields')} filled` : 'Nothing filled';
  $('#leftText').textContent = r.left ? `${count(r.left, 'field', 'fields')} still empty` : 'Nothing left empty';

  const notes = [];
  if (r.resume) notes.push(`Attached ${r.resume}.`);
  if (!r.filled && !r.left) notes.push('No form fields found here. If the form opens in a pop-up, open it first, then fill again.');
  else if (r.left) notes.push('Fill the amber fields yourself, or let Claude finish them.');
  $('#note').textContent = notes.join(' ');
  $('#note').hidden = !notes.length;
}

function showError(err) {
  const msg = String((err && err.message) || err);
  $('#error').textContent = /chrome:|edge:|extensions gallery|cannot be scripted|Cannot access/i.test(msg)
    ? 'Your browser doesn’t let extensions fill this page. Open the job application and try again.'
    : `Couldn’t fill this page: ${msg}`;
  $('#error').hidden = false;
}

async function init() {
  const { profile: stored } = await chrome.storage.local.get('profile');
  const profile = Object.assign(AutoInternship.defaults(), stored || {});
  const empty = AutoInternship.isEmpty(profile);
  $('#emptyState').hidden = !empty;
  $('#ready').hidden = empty;

  const openProfile = () => chrome.runtime.openOptionsPage();
  $('#editProfile').addEventListener('click', openProfile);
  $('#setup').addEventListener('click', openProfile);

  if (!empty) {
    const who = $('#who');
    who.append('Filling as ');
    const strong = document.createElement('strong');
    strong.textContent = AutoInternship.fullName(profile) || profile.email;
    who.append(strong);
  }

  $('#fill').addEventListener('click', async () => {
    const btn = $('#fill');
    btn.disabled = true;
    btn.textContent = 'Filling…';
    $('#error').hidden = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      showResult(await runFill(tab.id));
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Fill again';
    }
  });

  chrome.commands.getAll((cmds) => {
    const foot = $('#shortcut');
    const cmd = cmds.find((c) => c.name === 'fill-page');
    if (cmd && cmd.shortcut) {
      foot.textContent = `Shortcut: ${cmd.shortcut}`;
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = 'Set a keyboard shortcut';
      b.addEventListener('click', () => chrome.tabs.create({ url: IS_EDGE ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' }));
      foot.append(b);
    }
  });
}

init();
