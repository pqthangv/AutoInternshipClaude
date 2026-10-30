/* Applyfile autofill
   Injected into the current tab only when you click "Fill this page" or press the shortcut.
   It reads your profile from chrome.storage.local, fills the fields it recognizes, never
   overwrites anything that already has a value, and outlines fields on the page:
     solid green  = filled from your profile
     dashed amber = still empty, for you or Claude
   Nothing is sent anywhere. */
(() => {
  if (globalThis.__applyfile) return;

  const GREEN = '#1E9E5A';
  const AMBER = '#E0A020';
  const MARK = 'data-applyfile';
  const PREV = 'data-applyfile-prev';

  const FILLABLE_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'date', 'month']);
  const DEFAULT_KINDS = ['text', 'select'];
  const YESNO_KINDS = ['text', 'select', 'radio'];

  // Never auto-filled. These get an amber outline so you (or Claude, with your OK) handle them.
  const SENSITIVE = /\b(ssn|social security|social insurance|national insurance|tax id|passport|driver'?s? licen[cs]e|date of birth|birth ?date|dob|bank|routing|account number|credit card|card number|cvv|password)\b/;
  const DEMOGRAPHIC = /\b(gender|sex|pronouns?|race|racial|ethnicity|ethnic|hispanic|latin[oax]|veteran|disability|disabled|sexual orientation|transgender|lgbt\w*|religion|religious|marital)\b/;
  // Fields that ask about someone else (a referrer, a manager) rather than you.
  const NOT_SELF = /\b(refer\w*|reference|emergency|manager|supervisor|recruiter|parent|guardian|spouse|company|employer|school|hiring)\b/;
  const NOT_PHONE = new RegExp(NOT_SELF.source + '|\\b(type|code|extension|ext)\\b');

  const yn = (v) => (v === 'yes' || v === 'no' ? v : null);
  const W0 = (f) => (p) => p.work && p.work[0] && p.work[0][f];
  const loc = (p) => (p.city && p.state ? `${p.city}, ${p.state}` : [p.city, p.country].filter(Boolean).join(', '));
  const edu0 = (p) => (p.education && p.education[0]) || {};
  // "May 2028" → "2028" for a year-only field, "May" for a month-only field.
  const MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
  function gradValue(v, label) {
    if (!v) return v;
    const year = String(v).match(/\b(19|20)\d{2}\b/);
    const month = String(v).match(MONTH_RE);
    if (/\byear\b/.test(label) && !/\bmonth\b/.test(label)) return year ? year[0] : v;
    if (/\bmonth\b/.test(label) && !/\byear\b/.test(label)) return month ? month[0] : null;
    return v;
  }

  // Order matters: the first rule that matches a field wins.
  const RULES = [
    { re: /\bprefer\w* (first )?name\b|\bnick ?name\b|\bgoes by\b|\bknown as\b/, max: 60, not: NOT_SELF, value: (p) => p.preferredName || p.firstName },
    { re: /\bfirst ?name\b|\bgiven ?name\b|\bforename\b/, ac: ['given-name'], max: 60, not: NOT_SELF, value: (p) => p.firstName },
    { re: /\blast ?name\b|\bsurname\b|\bfamily ?name\b/, ac: ['family-name'], max: 60, not: NOT_SELF, value: (p) => p.lastName },
    { re: /^(your |full |legal |candidate |applicant )?(full )?(legal )?name$|^first and last name$|^name \(first and last\)$/, ac: ['name'], max: 40, not: NOT_SELF, value: (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') },
    { re: /\be[ -]?mail\b/, ac: ['email'], type: 'email', max: 80, not: NOT_SELF, value: (p) => p.email },
    { re: /\b(phone|mobile|cell|telephone)\b/, ac: ['tel', 'tel-national'], type: 'tel', max: 60, not: NOT_PHONE, value: (p) => p.phone },
    { re: /\blinked ?in\b/, max: 100, url: true, value: (p) => p.linkedin },
    { re: /\bgit ?hub\b/, max: 100, url: true, value: (p) => p.github },
    { re: /\bportfolio\b|\bpersonal (web ?)?site\b|^(personal |your )?web ?site( url)?$|\bhomepage\b|^other (web ?site|url|link)s?$|^urls?$|\bblog\b/, max: 80, url: true, not: /\b(linked ?in|twitter|facebook|instagram|company|employer)\b/, value: (p) => p.portfolio || p.website },
    { re: /^(current |your |home )?location$|\bwhere are you (currently )?(located|based)\b|^city,? state\b|^current (city|location)\b|^location \(city\)$|^based in\b/, max: 60, value: loc },
    { re: /\bcity\b|\btown\b/, ac: ['address-level2'], max: 40, not: /\b(desired|prefer\w*|relocat\w*|birth)\b/, value: (p) => p.city },
    { re: /^(state|province|region|county)$|^state ?(\/|or) ?province$|^state of residence$/, hint: /\b(state|province|region)$/, ac: ['address-level1'], max: 40, value: (p) => p.state },
    { re: /\bzip\b|\bpostal\b|\bpost ?code\b/, ac: ['postal-code'], max: 40, value: (p) => p.postalCode },
    { re: /\bcountry\b/, ac: ['country', 'country-name'], max: 40, not: /\b(code|phone|dial|citizen\w*|authori\w*|visa|which countr\w*|other countr\w*)\b/, value: (p) => p.country },
    { re: /\bstreet\b|^address( line)? ?1$|^(home |mailing |street |current )?address$/, hint: /\baddress line ?1$|\bstreet( address)?$|^address$/, ac: ['address-line1', 'street-address'], max: 40, not: /\b(e[ -]?mail|ip|web|url|line ?2|address ?2|apartment|apt|suite|city|state|zip|postal|country)\b/, value: (p) => p.street },

    { re: /\b(current|present|most recent|latest) (company|employer|organi[sz]ation)\b|^org$/, max: 60, not: /\b(refer\w*|previous|former|desired|why)\b/, value: W0('company') },
    { re: /\b(current|present|most recent|latest) (job )?(title|position|role)\b/, max: 60, value: W0('title') },
    // Generic company/title fields take your jobs in order: the first one gets your most recent job, and so on.
    { key: 'work.company', re: /^(company|employer|organi[sz]ation)( name)?$/, hint: /\b(company|employer)( name)?$/, max: 40, idx: 'work', field: 'company' },
    { key: 'work.title', re: /^(job |position )?title$|^position( title)?$|^role$/, hint: /\b(job|position) title$/, max: 40, idx: 'work', field: 'title' },

    { key: 'edu.school', re: /\b(school|university|college|institution)( name)?\b/, max: 50, not: /\b(high school|secondary|year|date|degree|major|gpa|did you|have you|do you|are you|will you|return\w*|enrolled)\b/, idx: 'education', field: 'school' },
    { key: 'edu.degree', re: /\bdegree\b|\bqualification\b/, max: 40, not: /\b(field|subject|major|discipline|area|do you|have you|minimum|require\w*|year|date)\b/, idx: 'education', field: 'degree', degree: true },
    { key: 'edu.minor', re: /\bminor\b/, max: 40, not: /\b(under|age|18|are you|parent|guardian)\b/, idx: 'education', field: 'minor' },
    { key: 'edu.field', re: /\bmajor\b|\bfield of study\b|\bdiscipline\b|\barea of study\b|\bconcentration\b|\bcourse of study\b|^subject$/, max: 50, idx: 'education', field: 'field' },
    { key: 'edu.gpa', re: /\bgpa\b|\bgrade point\b/, max: 40, idx: 'education', field: 'gpa' },
    { re: /\bgraduation (date|year|month|term|semester)\b|\byear of graduation\b|\bgrad(uation)? (year|date)\b|\bexpected (grad|graduation)\b|\bwhen (do|will) you graduate\b|\bgraduating (year|class)\b|\bclass of\b/, max: 70, kinds: ['text', 'select'], value: (p, label) => gradValue(p.expectedGraduation || edu0(p).end, label) },

    // Student and internship questions
    { re: /\b(class|academic|student) (standing|level|year)\b|\b(current )?year (in|of) (school|study|college|university|program)\b|\bclassification\b|\bcurrent (school |academic )?year\b|\bschool year\b/, max: 80, kinds: YESNO_KINDS, value: (p) => p.classStanding },
    { re: /\b(are you|currently) (currently )?(enrolled|a (full[- ]time |part[- ]time )?student)\b|\benrolled (in|at)\b/, max: 250, yesno: true, kinds: YESNO_KINDS, value: (p) => yn(p.enrolled) },
    { re: /\breturn(ing)? to (school|your studies|university|college|campus)\b|\bcontinu(e|ing) (your |with your )?(education|studies|degree)\b/, max: 250, yesno: true, kinds: YESNO_KINDS, value: (p) => yn(p.returningToSchool) },
    { re: /\b(relevant )?course ?work\b|\brelevant (courses|classes)\b|\bcourses (you'?ve|you have) (taken|completed)\b/, max: 120, kinds: ['text', 'textarea'], value: (p) => p.relevantCoursework },
    { re: /\bwhich (term|season|semester|session|cohort)\b|\b(internship|co-?op) (term|season|session|period|cohort)\b|\bterm of interest\b|\b(term|season|semester) (are you |you are )?(applying|interested|available)\b|^term$/, max: 120, kinds: YESNO_KINDS, value: (p) => p.internshipTerm },
    { re: /\bavailable (until|through)\b|\b(internship|availability) end( date)?\b|\bend date of (your )?availability\b|\blatest (possible )?end date\b/, max: 100, kinds: ['text'], value: (p) => p.availableUntil },

    { re: /\byears of (\w+ )?experience\b|\bhow many years\b/, max: 70, not: /\b(with|using|in)\b/, value: (p) => p.yearsExperience },
    { re: /\bsponsor\w*/, max: 250, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: (p) => yn(p.needsSponsorship) },
    { re: /\b(authori[sz]ed|eligible|permitted|entitled|legally able|allowed) to work\b|\bwork authori[sz]ation\b|\bright to work\b/, max: 250, not: /\bsponsor\w*/, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: (p) => yn(p.workAuthorized) },
    { re: /\brelocat\w*/, max: 200, not: /\b(assistance|package|benefit\w*|support|cost\w*|expenses?)\b/, yesno: true, kinds: YESNO_KINDS, value: (p) => yn(p.willingToRelocate) },
    { re: /\bsalary\b|\bcompensation\b|\bpay (expectations?|range|requirements?)\b|\b(desired|expected) (pay|rate)\b|\brate expectations?\b|\bhourly rate\b/, max: 120, not: /\b(current|previous|prior|last)\b/, kinds: ['text', 'textarea', 'select'], value: (p) => p.salary },
    // Not a bare "start date": that label also appears in work-history rows.
    { re: /\bnotice period\b|\bearliest (possible )?start\b|\b(available|availability|desired|preferred|internship|anticipated) start( date)?\b|\bwhen (can|could) you (start|begin)\b|\bavailab\w* to (start|begin)\b|\bdate available\b/, max: 100, kinds: ['text', 'textarea'], value: (p) => p.availableFrom || p.startDate },
    { re: /^(professional |profile )?summary$|^bio$|^about (me|you)$/, max: 40, kinds: ['textarea'], value: (p) => p.summary },
    { re: /^(key |technical |relevant )?skills$/, max: 40, kinds: ['text', 'textarea'], value: (p) => p.skills },
  ];

  /* ---------- Matching helpers ---------- */

  const STATES = Object.fromEntries('AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'
    .split('|').map((s) => s.split(':')));
  const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([a, n]) => [n.toLowerCase(), a]));

  const COUNTRY_GROUPS = [
    ['united states', 'united states of america', 'usa', 'us', 'u.s.', 'u.s.a.', 'america'],
    ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england'],
    ['united arab emirates', 'uae'],
    ['south korea', 'korea, republic of', 'republic of korea', 'korea'],
    ['netherlands', 'the netherlands', 'holland'],
    ['czechia', 'czech republic'],
    ['vietnam', 'viet nam'],
    ['russia', 'russian federation'],
  ];
  // Countries a work-authorization question might name. Bare "us" is left out on purpose ("tell us...").
  const COUNTRY_WORDS = ['united states', 'u.s.', 'usa', 'america', 'canada', 'united kingdom', 'uk', 'u.k.', 'britain', 'england',
    'australia', 'new zealand', 'ireland', 'germany', 'france', 'netherlands', 'spain', 'italy', 'india', 'singapore', 'japan',
    'china', 'hong kong', 'mexico', 'brazil', 'israel', 'switzerland', 'sweden', 'poland', 'european union', 'eu', 'uae'];

  const norm = (s) => (s || '')
    .toLowerCase()
    .replace(/\((required|optional)\)/g, ' ')
    .replace(/[*✱:]/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\brequired$/, '');

  const hintNorm = (s) => (s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\[\].:\/]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function cleanText(node, skip) {
    if (!node) return '';
    let out = '';
    const walk = (n) => {
      if (out.length > 400 || (skip && skip.has(n))) return;
      if (n.nodeType === 3) { out += n.nodeValue + ' '; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'OPTION' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON' || tag === 'INPUT') return;
      for (const c of n.childNodes) walk(c);
    };
    walk(node);
    return out.replace(/\s+/g, ' ').trim();
  }

  function byId(el, id) {
    const root = el.getRootNode();
    return (root && root.getElementById && root.getElementById(id)) || document.getElementById(id);
  }

  function controlCount(node) {
    return node.querySelectorAll('input:not([type=hidden]), select, textarea').length;
  }

  // Text around a field that has no proper <label>: the closest wrapper holding only this field.
  function nearbyText(el) {
    let node = el;
    for (let i = 0; i < 4 && node.parentElement; i++) {
      node = node.parentElement;
      if (controlCount(node) > 1) break;
      const t = cleanText(node);
      if (t && t.length < 250) return t;
    }
    const prev = el.previousElementSibling;
    return prev ? cleanText(prev).slice(0, 200) : '';
  }

  function labelFor(el) {
    const parts = new Set();
    try { if (el.labels) for (const l of el.labels) parts.add(cleanText(l)); } catch (_) { /* some inputs throw */ }
    const aria = el.getAttribute('aria-label');
    if (aria) parts.add(aria.trim());
    const ids = el.getAttribute('aria-labelledby');
    if (ids) for (const id of ids.split(/\s+/)) { const n = byId(el, id); if (n) parts.add(cleanText(n)); }
    let label = norm([...parts].filter(Boolean).join(' '));
    if (!label) label = norm(nearbyText(el));
    if (!label && el.placeholder) label = norm(el.placeholder);
    return label.slice(0, 300);
  }

  function hintsFor(el) {
    return [el.getAttribute('name'), el.id, el.getAttribute('data-automation-id'), el.getAttribute('data-qa'), el.getAttribute('data-testid')]
      .map(hintNorm)
      .filter((h) => h && h.length < 80 && !/^\d+$/.test(h));
  }

  function acToken(el) {
    const a = (el.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).pop();
    return a === 'on' || a === 'off' ? '' : a;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    if (!el.getClientRects || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false; // parked off-screen
    return true;
  }

  function matches(rule, label, hints, el) {
    const texts = label ? [label, ...hints] : hints;
    if (rule.not && texts.some((t) => rule.not.test(t))) return false;
    const ac = acToken(el);
    if (rule.ac && ac && rule.ac.includes(ac)) return true;
    if (rule.type && el.type === rule.type) return true;
    if (label && (!rule.max || label.length <= rule.max) && rule.re.test(label)) return true;
    const hre = rule.hint || rule.re;
    return hints.some((h) => hre.test(h));
  }

  function variants(value, degree) {
    const v = norm(value);
    const out = new Set([v]);
    for (const g of COUNTRY_GROUPS) if (g.includes(v)) g.forEach((x) => out.add(x));
    const up = String(value).trim().toUpperCase();
    if (STATES[up]) out.add(STATES[up].toLowerCase());
    if (STATE_BY_NAME[v]) out.add(STATE_BY_NAME[v].toLowerCase());
    if (degree) {
      if (/bachelor|\bb\.?(s|a|sc|eng)\b\.?/.test(v)) out.add('bachelor');
      if (/master|\bm\.?(s|a|sc|eng)\b\.?|\bmba\b/.test(v)) out.add('master');
      if (/\bmba\b/.test(v)) out.add('mba');
      if (/ph\.?d|doctor/.test(v)) ['doctorate', 'phd', 'doctor'].forEach((x) => out.add(x));
      if (/associate/.test(v)) out.add('associate');
    }
    return [...out];
  }

  function countryOk(question, p) {
    const home = norm(p.authCountry || p.country || '');
    const mentioned = COUNTRY_WORDS.filter((w) => new RegExp(`(^|[^a-z])${esc(w)}([^a-z]|$)`).test(question));
    if (!mentioned.length || !home) return true;
    const homes = variants(home);
    return mentioned.some((w) => homes.some((h) => h === w || h.includes(w) || w.includes(h)));
  }

  const STOP = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'degree', '&', 'or']);
  function toks(s) {
    return new Set(norm(s).replace(/'s\b/g, '')
      .split(/[^a-z0-9.+#]+/)
      .map((t) => t.replace(/\.$/, ''))
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
      .filter((t) => t && !STOP.has(t)));
  }

  function sim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (b.startsWith(a) || a.startsWith(b))) return 0.85;
    const A = toks(a); const B = toks(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    if (!inter) return 0;
    return 0.5 * (inter / Math.min(A.size, B.size)) + 0.5 * (inter / (A.size + B.size - inter));
  }

  const isPlaceholderOpt = (text, val) => !String(text).trim() || val === '' || /^(select|choose|please select|--|—|none selected)/i.test(String(text).trim());

  // options: [{ text, val, ...anything }] → best option or null
  function pickOption(options, res) {
    const opts = options.filter((o) => !isPlaceholderOpt(o.text, o.val));
    if (res.yesno) {
      const want = res.yesno === 'yes' ? /^yes\b/ : /^no\b/;
      return opts.find((o) => want.test(norm(o.text))) || null;
    }
    const wants = variants(res.value, !res.rule || res.rule.degree);
    let best = null; let score = 0;
    for (const o of opts) {
      for (const w of wants) {
        const s = Math.max(sim(w, norm(o.text)), sim(w, norm(o.val)));
        if (s > score) { score = s; best = o; }
      }
    }
    return score >= 0.6 ? best : null;
  }

  function resolve(p, label, hints, el, kind, counters) {
    // 1. Your saved answers come first.
    for (const sa of p.savedAnswers || []) {
      const m = norm(sa.match);
      const ans = (sa.answer || '').trim();
      if (m && ans && label.includes(m)) return { value: ans, yesno: yn(ans.toLowerCase()), rule: null };
    }
    // 2. Built-in rules.
    for (const rule of RULES) {
      if (!(rule.kinds || DEFAULT_KINDS).includes(kind)) continue;
      if (!matches(rule, label, hints, el)) continue;
      let v;
      if (rule.idx) {
        const i = (counters[rule.key] = (counters[rule.key] ?? -1) + 1);
        v = p[rule.idx] && p[rule.idx][i] && p[rule.idx][i][rule.field];
      } else {
        v = rule.value(p, label);
      }
      if (v == null || String(v).trim() === '') return null; // recognized, but your profile has no answer
      if (rule.countryCheck && !countryOk(label, p)) return null; // asks about a different country: leave it
      return { value: String(v).trim(), yesno: rule.yesno ? yn(String(v)) : null, rule };
    }
    return null;
  }

  /* ---------- Writing values ---------- */

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.blur(); } catch (_) { /* ignore */ }
  }

  // "June 1, 2027" → 2027-06-01 for date inputs; "May 2028" → 2028-05 for month inputs.
  // A date input only gets a value that includes a day, so the day is never guessed.
  function toISODate(v, type) {
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    if (type === 'month' && /^\d{4}-\d{2}$/.test(v)) return v;
    if (type === 'date' && !/\d{1,2}(st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) return null;
    const t = Date.parse(String(v).replace(/(\d)(st|nd|rd|th)\b/, '$1'));
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    if (d.getFullYear() < 1990) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return type === 'month' ? `${d.getFullYear()}-${mm}` : `${d.getFullYear()}-${mm}-${dd}`;
  }

  function hasValue(el) {
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      return !!o && !isPlaceholderOpt(o.text, o.value);
    }
    return String(el.value || '').trim() !== '';
  }

  function apply(el, kind, res) {
    if (kind === 'select') {
      const pick = pickOption([...el.options].map((o) => ({ text: o.text, val: o.value })), res);
      if (!pick) return false;
      setValue(el, pick.val);
      return true;
    }
    if (kind === 'textarea') {
      if (res.yesno) return false;
      setValue(el, res.value);
      return true;
    }
    let v = res.yesno ? (res.yesno === 'yes' ? 'Yes' : 'No') : res.value;
    const t = (el.type || '').toLowerCase();
    if (t === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return false;
    if (t === 'date' || t === 'month') { v = toISODate(v, t); if (!v) return false; }
    if ((t === 'url' || (res.rule && res.rule.url)) && !/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    if (el.maxLength > 0 && v.length > el.maxLength) return false;
    setValue(el, v);
    return true;
  }

  /* ---------- Outlines ---------- */

  const listeners = new WeakMap();

  function mark(el, state) {
    if (!el || !el.style) return;
    if (!el.hasAttribute(MARK)) {
      el.setAttribute(PREV, JSON.stringify([
        el.style.getPropertyValue('outline'), el.style.getPropertyPriority('outline'),
        el.style.getPropertyValue('outline-offset'), el.style.getPropertyPriority('outline-offset'),
      ]));
    }
    el.setAttribute(MARK, state);
    el.style.setProperty('outline', state === 'filled' ? `2px solid ${GREEN}` : `2px dashed ${AMBER}`, 'important');
    el.style.setProperty('outline-offset', '2px', 'important');
    if (!listeners.has(el)) {
      // Only real typing or clicking clears the outline, not the events this script fires itself.
      const clear = (e) => { if (e.isTrusted) unmark(el); };
      el.addEventListener('input', clear);
      el.addEventListener('change', clear);
      listeners.set(el, clear);
    }
  }

  function unmark(el) {
    const clear = listeners.get(el);
    if (clear) {
      el.removeEventListener('input', clear);
      el.removeEventListener('change', clear);
      listeners.delete(el);
    }
    if (!el.hasAttribute(MARK)) return;
    let prev = ['', '', '', ''];
    try { prev = JSON.parse(el.getAttribute(PREV)) || prev; } catch (_) { /* ignore */ }
    if (prev[0]) el.style.setProperty('outline', prev[0], prev[1]); else el.style.removeProperty('outline');
    if (prev[2]) el.style.setProperty('outline-offset', prev[2], prev[3]); else el.style.removeProperty('outline-offset');
    el.removeAttribute(MARK);
    el.removeAttribute(PREV);
  }

  function visibleAncestor(el, minWidth = 2) {
    let n = el;
    for (let i = 0; n && i < 6; i++, n = n.parentElement) {
      if (isVisible(n) && n.getBoundingClientRect().width >= minWidth) return n;
    }
    return null;
  }

  /* ---------- Page walking ---------- */

  function deepQuery(root, sel, out = []) {
    out.push(...root.querySelectorAll(sel));
    for (const n of root.querySelectorAll('*')) if (n.shadowRoot) deepQuery(n.shadowRoot, sel, out);
    return out;
  }

  function clearMarks() {
    for (const el of deepQuery(document, `[${MARK}]`)) unmark(el);
  }

  /* ---------- Custom dropdowns ---------- */

  // Custom dropdowns (React-Select, Workday) can't be set reliably by a script.
  // If one still shows its placeholder, outline it amber so you or Claude pick an option.
  function handleCombo(el, stats) {
    if (String(el.value || '').trim()) return;
    const box = visibleAncestor(el.parentElement, 120); // the visible control, not the tiny inner input
    if (!box || box.hasAttribute(MARK)) return;
    const t = norm(cleanText(box)).slice(0, 200);
    if (!t || /^(select|choose|search|type|start typing)\b/.test(t) || /\b(select|choose)( one| an option)?\.{0,3}$/.test(t)) {
      mark(box, 'left');
      stats.left++;
    }
  }

  /* ---------- Radio buttons ---------- */

  const ids = new WeakMap(); let nextId = 0;
  const idOf = (o) => { if (!o) return 0; if (!ids.has(o)) ids.set(o, ++nextId); return ids.get(o); };

  function addToGroup(groups, r) {
    const key = r.name ? `${idOf(r.form || r.getRootNode())}|${r.name}` : `p${idOf(r.parentElement && r.parentElement.parentElement)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  function groupBox(radios) {
    const fs = radios[0].closest('fieldset, [role="radiogroup"]');
    if (fs && radios.every((r) => fs.contains(r))) return fs;
    let n = radios[0].parentElement;
    for (let i = 0; n && i < 8; i++, n = n.parentElement) if (radios.every((r) => n.contains(r))) return n;
    return radios[0].parentElement;
  }

  function optionLabel(r) {
    if (r.labels && r.labels.length) { const t = cleanText(r.labels[0]); if (t) return t; }
    const a = r.getAttribute('aria-label');
    if (a) return a.trim();
    const sib = r.nextSibling;
    if (sib) {
      const t = sib.nodeType === 3 ? sib.nodeValue.trim() : cleanText(sib);
      if (t) return t;
    }
    const el = r.nextElementSibling;
    if (el) { const t = cleanText(el); if (t && t.length < 60) return t; }
    return r.value || '';
  }

  function groupQuestion(radios, box) {
    if (box.tagName === 'FIELDSET') {
      const lg = box.querySelector('legend');
      if (lg) { const t = norm(cleanText(lg)); if (t) return t; }
    }
    const aria = box.getAttribute('aria-label');
    if (aria) return norm(aria);
    const lb = box.getAttribute('aria-labelledby');
    if (lb) {
      const t = norm(lb.split(/\s+/).map((id) => cleanText(byId(box, id))).join(' '));
      if (t) return t;
    }
    // Otherwise: the text around the group, minus the option labels themselves.
    const skip = new Set();
    for (const r of radios) {
      if (r.labels && r.labels.length) for (const l of r.labels) skip.add(l);
      else {
        if (r.nextSibling) skip.add(r.nextSibling);
        if (r.nextElementSibling) skip.add(r.nextElementSibling);
      }
    }
    let node = box;
    for (let i = 0; node && i < 3; i++, node = node.parentElement) {
      if (i > 0 && controlCount(node) > radios.length) break;
      const t = norm(cleanText(node, skip));
      if (t.length >= 3) return t.slice(0, 300);
    }
    return '';
  }

  function fillRadioGroup(radios, p, counters, stats) {
    const box = groupBox(radios);
    if (!box || (!isVisible(box) && !radios.some(isVisible))) return;
    if (radios.some((r) => r.checked)) return;
    const q = groupQuestion(radios, box);
    const blocked = !q || SENSITIVE.test(q) || DEMOGRAPHIC.test(q);
    const res = blocked ? null : resolve(p, q, [], radios[0], 'radio', counters);
    let chosen = null;
    if (res) {
      const pick = pickOption(radios.map((r) => ({ el: r, text: optionLabel(r), val: r.value })), res);
      chosen = pick && pick.el;
    }
    if (chosen) {
      chosen.click();
      if (!chosen.checked) { chosen.checked = true; chosen.dispatchEvent(new Event('change', { bubbles: true })); }
      mark(box, 'filled');
      stats.filled++;
    } else {
      mark(box, 'left');
      stats.left++;
    }
  }

  /* ---------- Resume upload ---------- */

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function acceptOk(accept, resume) {
    if (!accept) return true;
    const ext = ((resume.name.match(/\.[^.]+$/) || [''])[0]).toLowerCase();
    const type = (resume.type || '').toLowerCase();
    return accept.split(',').map((s) => s.trim().toLowerCase()).some((a) =>
      a === ext || a === type || a === '*' || a === '*/*' || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))));
  }

  function attachResume(el, resume, stats, state) {
    if (state.resumeDone || !resume || !resume.data || el.disabled) return;
    if (el.files && el.files.length) return;
    const text = [labelFor(el), ...hintsFor(el), norm(nearbyText(el))].join(' ');
    if (!/\b(resume|résumé|cv|curriculum vitae)\b/.test(text) || /\bcover\b/.test(text)) return;
    if (!acceptOk(el.getAttribute('accept'), resume)) return;
    try {
      const file = new File([b64ToBytes(resume.data)], resume.name, { type: resume.type || 'application/pdf', lastModified: Date.now() });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      state.resumeDone = true;
      stats.resume = resume.name;
      stats.filled++;
      const box = visibleAncestor(el, 40);
      if (box) mark(box, 'filled');
    } catch (_) { /* the site blocked it; leave it for you */ }
  }

  /* ---------- Main ---------- */

  async function fill() {
    let data = {};
    try { data = await chrome.storage.local.get(['profile', 'resume']); } catch (_) { /* fall through with empty profile */ }
    const p = data.profile || {};
    const resume = data.resume || null;

    clearMarks();
    const stats = { filled: 0, left: 0, resume: null };
    const counters = Object.create(null);
    const state = { resumeDone: false };
    const groups = new Map();

    for (const el of deepQuery(document, 'input, select, textarea')) {
      const tag = el.tagName;
      const type = tag === 'INPUT' ? (el.getAttribute('type') || '').toLowerCase() : '';
      if (type === 'radio') { if (!el.disabled) addToGroup(groups, el); continue; }
      if (type === 'file') { attachResume(el, resume, stats, state); continue; }
      if (tag === 'INPUT' && !FILLABLE_TYPES.has(type)) continue;
      if (el.readOnly || !isVisible(el)) continue;

      const label = labelFor(el);
      const hints = hintsFor(el);
      if (/\bsearch\b/.test(label) || hints.some((h) => /\bsearch\b/.test(h))) continue;

      const combo = tag === 'INPUT' && (el.getAttribute('role') === 'combobox'
        || el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-haspopup') === 'listbox');
      if (combo) { handleCombo(el, stats); continue; }

      const kind = tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textarea' : 'text';
      const blocked = SENSITIVE.test(label) || DEMOGRAPHIC.test(label);
      const res = blocked ? null : resolve(p, label, hints, el, kind, counters); // runs first so job/school order stays right
      if (hasValue(el)) continue; // never overwrite
      if (res && apply(el, kind, res)) { mark(el, 'filled'); stats.filled++; }
      else { mark(el, 'left'); stats.left++; }
    }

    for (const radios of groups.values()) fillRadioGroup(radios, p, counters, stats);
    return stats;
  }

  globalThis.__applyfile = { fill, clear: clearMarks };
})();
