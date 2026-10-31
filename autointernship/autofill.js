/* AutoInternship autofill
   Injected into the current tab only when you click "Fill this page", press the shortcut, or
   (if you turned it on) Claude asks through the bridge (bridge.js).
   It reads your profile from chrome.storage.local, fills the fields it recognizes, never
   overwrites anything that already has a value, and outlines fields on the page:
     solid green  = filled from your profile
     dashed amber = still empty, for you or Claude
   fill() also returns a report for Claude: each field it filled with the value now on the page,
   and each field it left with its kind and choices. Nothing is sent anywhere. */
(() => {
  if (globalThis.__autointernship) return;

  const GREEN = '#1E9E5A';
  const AMBER = '#E0A020';
  const MARK = 'data-autointernship';
  const PREV = 'data-autointernship-prev';

  const FILLABLE_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'date', 'month']);
  const DEFAULT_KINDS = ['text', 'select'];
  const YESNO_KINDS = ['text', 'select', 'radio'];

  // Never auto-filled. These get an amber outline so you (or Claude, with your OK) handle them.
  const SENSITIVE = /\b(ssn|social security|social insurance|national insurance|tax id|passport|driver'?s? licen[cs]e|date of birth|birth ?date|dob|bank|routing|account number|credit card|card number|cvv|password)\b/;
  const DEMOGRAPHIC = /\b(gender|sex|pronouns?|race|racial|ethnicity|ethnic|hispanic|latin[oax]|veteran|disability|disabled|sexual orientation|transgender|lgbt\w*|religion|religious|marital)\b/;
  // Demographic questions are never filled from RULES or saved answers. The voluntary self-identification
  // questions (gender, pronouns, Hispanic or Latino, race, veteran status, disability, LGBTQ+, transgender
  // identity, sexual orientation) are filled only from the answers you chose on the profile page; see
  // "Voluntary self-identification" below. These other ones are always left for you.
  const NOT_SELF_ID = /\b(religion|religious|marital)\b/;
  // "Decline to self-identify", "I don't wish to answer", "Prefer not to say", Workday's "Not Declared"...
  const DECLINE = /\b(decline|prefer not|rather not|choose not|(do not|don't) (wish|want) to|not (wish|want) to|no answer|not disclosed?|undisclosed|not declared|undeclared)\b/;
  // A lone checkbox like "I agree to the privacy policy" or "I certify this is accurate" is an agreement
  // made in your name, so it is always left for you to tick.
  const CONSENT = /\b(agree|consent|certify|acknowledge|attest|accept|i have read|i understand|confirm)\b/;
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

  // Two sponsorship answers, because many students need none for the internship itself (on CPT, for
  // example) but will need it for a full-time job later:
  //   a question that includes the future ("now or in the future")  → needsSponsorship
  //   a question only about this internship or role                 → needsSponsorshipForInternship
  //   a question that could mean either                             → only when the two answers agree
  // Anything else is left for you. A wrong answer here can get an offer withdrawn, so when unsure, leave it.
  const SPONSOR_LATER = /\bfuture\b|\bnow or later\b|\bat any (point|time)\b|\bever\b|\bupon graduation\b|\bafter (you )?graduat\w*|\bfull[- ]time\b|\bh-?1-?b\b/;
  const SPONSOR_THIS_ROLE = /\b(this|the) (internship|co-?op|role|position|job|opportunity)\b|\bduring (the|this|your) internship\b/;
  function sponsorAnswer(p, label) {
    const later = yn(p.needsSponsorship);
    const now = yn(p.needsSponsorshipForInternship);
    if (SPONSOR_LATER.test(label)) return later;
    if (now && (now === later || SPONSOR_THIS_ROLE.test(label))) return now;
    // Never needing sponsorship covers this role too.
    return later === 'no' && now !== 'yes' ? 'no' : null;
  }

  // Government ties, asked on many finance, consulting and defense applications for anti-bribery checks:
  // "Are you, or have you been, a government official or employee?", "Is a close relative a public official?".
  // Questions that only mention government for another reason (a security clearance, a government-issued ID,
  // government contractors, clients or projects, sponsorship) are left alone.
  const GOVERNMENT = /\bgovernment (official|employee|officer|agency|entity|body|department|position|role|job)s?\b|\b(employ\w*|work\w*|served|serve|employee|official|position|held|hold)\b[^?]{0,60}\bgovernment\b|\b(public|foreign) officials?\b|\bpolitically exposed\b|\bstate[- ]owned\b|\bcivil servants?\b/;
  const GOVERNMENT_NOT = /\b(clearance|issued|identification|contractors?|clients?|customers?|projects?|experience|interested|sponsor\w*|authori[sz]\w*)\b|\bid\b/;
  const FAMILY = /\b(relatives?|family|household|spouse|domestic partner|related to|close (personal )?(friends?|associates?))\b/;
  // A question about your family gets governmentRelative, one about you gets governmentEmployee, and
  // "Are you or a family member..." is Yes if either is Yes, and No only if both are No.
  function governmentAnswer(p, label) {
    const aboutFamily = FAMILY.test(label);
    const aboutYou = !aboutFamily || /\b(you|yourself)\b,? (or|and)\b/.test(label);
    const parts = [];
    if (aboutYou) parts.push(yn(p.governmentEmployee));
    if (aboutFamily) parts.push(yn(p.governmentRelative));
    if (parts.includes('yes')) return 'yes';
    return parts.every((a) => a === 'no') ? 'no' : null;
  }

  // One box for your whole name: "First and Last Name", "First & Last Name", "Name (First, Last)", "Preferred
  // First & Last Name". It comes first because the rules below would match the "last name" (or "preferred
  // first name") inside these labels and type only part of your name. It needs both "first" and "last"
  // joined by "and", "&", "/"..., so a first-name box with an id like "legalName.firstName" isn't caught.
  const BOTH_NAMES = /\bfirst( name)? ?(and|&|\/|\+|,) ?last ?names?\b|\bname \(first,? ?(and |& |\/ ?)?last\)|\bprefer\w* full name\b/;
  const bothNames = (p, label) => [/\bprefer/.test(label) ? p.preferredName || p.firstName : p.firstName, p.lastName].filter(Boolean).join(' ');

  // Order matters: the first rule that matches a field wins.
  // name: true marks your own name, which the report checks against what the site already put there.
  const RULES = [
    { re: BOTH_NAMES, max: 60, not: NOT_SELF, name: true, value: bothNames },
    { re: /\bprefer\w* (first )?name\b|\bnick ?name\b|\bgoes by\b|\bknown as\b/, max: 60, not: NOT_SELF, name: true, value: (p) => p.preferredName || p.firstName },
    { re: /\bfirst ?name\b|\bgiven ?name\b|\bforename\b/, ac: ['given-name'], max: 60, not: NOT_SELF, name: true, value: (p) => p.firstName },
    { re: /\blast ?name\b|\bsurname\b|\bfamily ?name\b/, ac: ['family-name'], max: 60, not: NOT_SELF, name: true, value: (p) => p.lastName },
    { re: /^(your |full |legal |candidate |applicant )?(full )?(legal )?name$/, ac: ['name'], max: 40, not: NOT_SELF, name: true, value: (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') },
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
    { re: /\bsponsor\w*/, max: 250, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: sponsorAnswer },
    { re: /\b(authori[sz]ed|eligible|permitted|entitled|legally able|allowed) to work\b|\bwork authori[sz]ation\b|\bright to work\b/, max: 250, not: /\bsponsor\w*/, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: (p) => yn(p.workAuthorized) },
    { re: GOVERNMENT, max: 300, not: GOVERNMENT_NOT, yesno: true, kinds: YESNO_KINDS, value: governmentAnswer },
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

  // The field's label as written on the form. labelFor() is the lowercased version used for matching;
  // this one goes into the report so Claude can record each field by its real label.
  function rawLabel(el) {
    const parts = [];
    // Adds a piece of label text unless another piece already says it (Workday repeats the <label> text
    // in aria-label, which would read "Degree Degree"). Of two overlapping pieces, the longer one stays.
    const words = (s) => ` ${s.replace(/[^a-z0-9]+/g, ' ').trim()} `; // whole words, so "State" isn't inside "United States"
    const add = (t) => {
      const n = norm(t);
      if (!n) return;
      const i = parts.findIndex((x) => words(norm(x)).includes(words(n)) || words(n).includes(words(norm(x))));
      if (i < 0) parts.push(t.trim());
      else if (n.length > norm(parts[i]).length) parts[i] = t.trim();
    };
    try { if (el.labels) for (const l of el.labels) add(cleanText(l)); } catch (_) { /* some inputs throw */ }
    const aria = el.getAttribute('aria-label');
    if (aria) add(aria);
    const ids = el.getAttribute('aria-labelledby');
    if (ids) for (const id of ids.split(/\s+/)) { const n = byId(el, id); if (n) add(cleanText(n)); }
    let label = parts.join(' ');
    if (!norm(label)) label = nearbyText(el);
    if (!norm(label) && el.placeholder) label = el.placeholder;
    return label;
  }

  function labelFor(el) {
    return norm(rawLabel(el)).slice(0, 300);
  }

  // A label tidied for the report: no required-markers, no extra spaces, not too long.
  const tidy = (s) => String(s || '').replace(/[*✱]/g, ' ').replace(/\((required|optional)\)/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const isRequired = (el, raw) => !!(el && (el.required || el.getAttribute('aria-required') === 'true')) || /[*✱]|\(required\)/i.test(raw || '');

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
    if (res.pick) return res.pick(options); // self-identification answers bring their own matching
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

  // Your answer for any question, whatever kind of field it is in:
  //   sensitive (ID numbers, bank details...)   → nothing, always left for you
  //   demographic                               → your self-identification answers, or nothing
  //   everything else                           → saved answers, then RULES
  function answerFor(p, label, hints, el, kind, counters) {
    if (!label && !hints.length) return null;
    if (SENSITIVE.test(label)) return null;
    if (DEMOGRAPHIC.test(label)) return selfId(p, label);
    return resolve(p, label, hints, el, kind, counters);
  }

  /* ---------- Voluntary self-identification ---------- */

  // Forms word these choices in many ways ("Female" or "Woman"; "I am not a protected veteran";
  // "White (Not Hispanic or Latino) (United States of America)" on Workday), so instead of the fuzzy
  // matching used for other answers, each answer lists the wordings that mean it, best first.
  // Each wording is a test on the option's normalized text.
  const has = (re, ...nots) => (t) => re.test(t) && !nots.some((n) => n && n.test(t));
  const NOT_HISPANIC = /\bnot hispanic\b|\bnon-?hispanic\b/;
  const HISPANIC_YES = has(/\bhispanic\b|\blatin[oax]\b/, NOT_HISPANIC, DECLINE);
  const HISPANIC_NO = has(NOT_HISPANIC, DECLINE);
  const RACES = {
    'american-indian': /\bamerican indian\b|\balaska\w* native\b|\bnative american\b|\bindigenous\b/,
    asian: /\basian\b/,
    black: /\bblack\b|\bafrican american\b/,
    'pacific-islander': /\bnative hawaiian\b|\bpacific islander\b/,
    white: /\bwhite\b|\bcaucasian\b/,
    'two-or-more': /\btwo or more\b|\b2 or more\b|\bmulti-?racial\b|\bmore than one\b|\bmixed\b/,
  };
  const GENDERS = {
    female: has(/\b(female|woman|women)\b/, /\btrans/, DECLINE),
    male: has(/\b(male|man|men)\b/, /\btrans/, DECLINE),
    nonbinary: has(/\bnon ?-?binary\b|\bgenderqueer\b|\bgender ?(fluid|non-?conforming)\b/, DECLINE),
  };
  const DECLINED = [has(DECLINE)];
  // "She/Her", "she/her/hers", "He / Him"... Only an option with just your pronouns counts, so a she/her
  // answer never picks a mixed option like "She/They".
  const PRONOUNS = { she: /\bshe\b|\bhers?\b/, he: /\bhe\b|\bhim\b|\bhis\b/, they: /\bthey\b|\bthem\b|\btheirs?\b/ };
  // What to type when the question is a plain text box (the one self-ID answer that's ever typed).
  const PRONOUN_TEXT = { she: 'she/her', he: 'he/him', they: 'they/them' };
  // A combined option like "Gay or lesbian" counts for both, since that's the group the form means.
  const ORIENTATIONS = {
    straight: /\bstraight\b|\bheterosexual\b/,
    gay: /\bgay\b|\bhomosexual\b/,
    lesbian: /\blesbian\b|\bhomosexual\b/,
    bisexual: /\bbi-?sexual\b/,
    pansexual: /\bpan-?sexual\b/,
    asexual: /\ba-?sexual\b|\bace\b/,
    queer: /\bqueer\b/,
  };

  // Which self-identification question a label asks, or null for anything else.
  function selfIdTopic(q) {
    // Checked first because the question often spells LGBTQ+ out ("lesbian, gay, bisexual, transgender...").
    if (/\blgbt\w*|\bqueer\b/.test(q)) return 'lgbtq';
    if (/\bpronouns?\b/.test(q)) return 'pronouns';
    if (/\btransgender\b|\btrans\b/.test(q)) return 'transgender';
    if (/\bsexual orientation\b|\borientation\b|\bsexuality\b/.test(q)) return 'orientation';
    if (NOT_SELF_ID.test(q)) return null;
    if (/\b(race|racial|ethnicity|ethnic)\b/.test(q)) return 'race';
    if (/\bhispanic\b|\blatin[oax]\b/.test(q)) return 'hispanic';
    if (/\bveteran\b/.test(q)) return 'veteran';
    if (/\bdisab/.test(q)) return 'disability';
    if (/\b(gender|sex)\b/.test(q)) return 'gender';
    return null;
  }

  // The wordings that match your answer to this question, best first. Empty when you chose nothing,
  // which leaves the question for you.
  function selfIdWants(topic, p) {
    switch (topic) {
      case 'gender':
        if (p.gender === 'decline') return DECLINED;
        return GENDERS[p.gender] ? [GENDERS[p.gender]] : [];
      case 'hispanic':
        if (p.hispanicLatino === 'decline') return DECLINED;
        if (p.hispanicLatino === 'yes') return [has(/^yes\b/), HISPANIC_YES];
        if (p.hispanicLatino === 'no') return [has(/^no\b/), HISPANIC_NO];
        return [];
      case 'race': {
        // Some forms ask race and Hispanic or Latino in one list (Workday's "Ethnicity", for example).
        // There a Hispanic or Latino answer comes first, as in the federal EEO-1 categories.
        const out = [];
        if (p.hispanicLatino === 'yes') out.push(HISPANIC_YES);
        const race = RACES[p.race];
        // A single race never matches "Two or more races", and "White (Not Hispanic or Latino)" is only
        // picked if you answered No to Hispanic or Latino.
        if (race) out.push(has(race, DECLINE, p.race === 'two-or-more' ? null : RACES['two-or-more'], p.hispanicLatino === 'no' ? null : NOT_HISPANIC));
        if (p.hispanicLatino === 'no') out.push(HISPANIC_NO); // an "Ethnicity" list with only Hispanic / Not Hispanic
        if (p.race === 'decline') out.push(...DECLINED);
        return out;
      }
      case 'veteran':
        if (p.veteranStatus === 'decline') return DECLINED;
        if (p.veteranStatus === 'no') return [has(/^no\b/, DECLINE), has(/\bnot a (protected )?veteran\b/, /\bveteran but\b/, DECLINE)];
        if (p.veteranStatus === 'protected') return [has(/^yes\b/, DECLINE), has(/\bidentify as (one or more|a protected)\b|\bprotected veteran\b/, /\bnot\b/, DECLINE)];
        return [];
      case 'disability':
        if (p.disabilityStatus === 'decline') return DECLINED;
        if (p.disabilityStatus === 'yes') return [has(/^yes\b/, DECLINE), has(/\b(i have|have had) a disability\b/, /\bnot\b|\bdon't\b/)];
        if (p.disabilityStatus === 'no') return [has(/^no\b/, DECLINE), has(/\b(do not|don't) have a disability\b/)];
        return [];
      case 'pronouns': {
        if (p.pronouns === 'decline') return DECLINED;
        const mine = PRONOUNS[p.pronouns];
        if (!mine) return [];
        const others = Object.entries(PRONOUNS).filter(([k]) => k !== p.pronouns).map(([, re]) => re);
        return [has(mine, DECLINE, ...others)];
      }
      case 'transgender':
        if (p.transgender === 'decline') return DECLINED;
        if (p.transgender === 'yes') return [has(/^yes\b/, DECLINE)];
        if (p.transgender === 'no') return [has(/^no\b/, DECLINE)];
        return [];
      case 'orientation':
        if (p.sexualOrientation === 'decline') return DECLINED;
        return ORIENTATIONS[p.sexualOrientation] ? [has(ORIENTATIONS[p.sexualOrientation], DECLINE)] : [];
      case 'lgbtq':
        if (p.lgbtq === 'decline') return DECLINED;
        if (p.lgbtq === 'yes') return [has(/^yes\b/, DECLINE)];
        if (p.lgbtq === 'no') return [has(/^no\b/, DECLINE)];
        return [];
      default:
        return [];
    }
  }

  // An answer object like resolve()'s, but it picks options itself:
  //   pick(options)    → the one best option (dropdowns, radio buttons)
  //   pickAll(options) → every option that applies ("check all that apply" lists, e.g. Hispanic and a race)
  //   text             → what to type in a plain text box: only pronouns have one; other answers are never typed
  function selfId(p, label) {
    const topic = selfIdTopic(label);
    const wants = selfIdWants(topic, p);
    if (!wants.length) return null;
    const usable = (options) => options.filter((o) => !isPlaceholderOpt(o.text, o.val));
    return {
      selfId: true,
      text: topic === 'pronouns' ? PRONOUN_TEXT[p.pronouns] || null : null,
      pick: (options) => {
        const opts = usable(options);
        for (const w of wants) { const o = opts.find((x) => w(norm(x.text))); if (o) return o; }
        return null;
      },
      pickAll: (options) => {
        const hits = usable(options).filter((o) => wants.some((w) => w(norm(o.text))));
        // Never tick a real answer and "Decline" together.
        const real = hits.filter((o) => !DECLINE.test(norm(o.text)));
        return real.length ? real : hits;
      },
    };
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
    if (res.pick && kind !== 'select') {
      // Self-identification answers only go into choices, never typed, except pronouns in a one-line text box.
      if (!res.text || kind !== 'text' || (el.maxLength > 0 && res.text.length > el.maxLength)) return false;
      setValue(el, res.text);
      return true;
    }
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

  /* ---------- Report ---------- */

  // Every field gets one of these calls: the outline on the page, the count in the popup, and a line in
  // the report Claude reads (so it can write application-record.md without reading the page back).
  //   stats.fields:    [{ label, value }]                       filled by AutoInternship just now
  //   stats.prefilled: [{ label, value, profile? }]             already had a value (you, an earlier fill, or
  //                                                             the site itself, like Workday's resume parsing);
  //                                                             never changed, no outline
  //   stats.todo:      [{ label, kind, options?, required? }]   left, with the choices if known
  //
  // profile is set when a name box holds something other than your profile's name. Sites' resume parsers
  // often split a two-word first name ("Mei Ling Chen" → first "Mei", last "Ling Chen"), and the fill never
  // overwrites, so the report flags these for Claude rather than leaving it to compare every value. Only
  // names: other values (phone formats, school names) differ harmlessly too often.
  // "Phùng" and "PHUNG" match "Phung". đ is its own letter, not d plus an accent, so it's swapped by hand.
  const fold = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  function notePrefilled(stats, label, value, expected) {
    const item = { label: tidy(label), value: String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
    if (expected && fold(item.value) !== fold(expected)) item.profile = String(expected).slice(0, 500);
    stats.prefilled.push(item);
  }

  function noteFilled(box, stats, label, value) {
    mark(box, 'filled');
    stats.filled++;
    stats.fields.push({ label: tidy(label), value: String(value ?? '').slice(0, 500) });
  }

  function noteLeft(box, stats, label, kind, extra = {}) {
    mark(box, 'left');
    stats.left++;
    const item = { label: tidy(label), kind };
    if (extra.options && extra.options.length) item.options = extra.options.map((o) => tidy(o)).filter(Boolean).slice(0, 40);
    if (extra.required) item.required = true;
    stats.todo.push(item);
  }

  const optionTexts = (options) => options.filter((o) => !isPlaceholderOpt(o.text, o.val)).map((o) => o.text);

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

  // Custom dropdowns are built from divs and buttons instead of a real <select>: React-Select on Greenhouse,
  // listbox buttons on Workday, and similar widgets elsewhere. A script can't set their value directly, so
  // AutoInternship works them the way a person would: open the list, wait for the options, click the one that
  // matches your answer, then check the box now shows it. If any step fails, the dropdown is closed again
  // and outlined amber for you or Claude. They're done one at a time, after the other fields, because only
  // one list can be open at once.

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, ms) {
    for (let t = 0; t <= ms; t += 50) {
      const v = fn();
      if (v) return v;
      await wait(50);
    }
    return null;
  }

  // The text a dropdown shows while nothing is chosen: "Select...", "Select One", "Choose an option", or nothing.
  const looksEmpty = (t) => !t || /^(select|choose|search|type|start typing)\b/.test(t) || /\b(select|choose)( one| an option)?\.{0,3}$/.test(t);

  // What the dropdown shows right now (its chosen value or placeholder), as written and lowercased.
  const shownRaw = (d) => String(d.el.tagName === 'BUTTON' ? d.el.textContent : d.box === d.el ? d.el.value : cleanText(d.box)).replace(/\s+/g, ' ').trim();
  const shownText = (d) => norm(shownRaw(d)).slice(0, 200);

  // The visible box of a combobox input: the nearest wrapper that shows its placeholder or chosen value.
  // The real input can be tiny or hidden, and React-Select keeps the shown text beside the input's own
  // wrapper rather than inside it, so the first wide-enough wrapper isn't enough: an answer already chosen
  // would look empty and get overwritten. Stops at the wrapper of the whole question (one with a label or
  // other fields in it).
  function comboBox(el) {
    let fallback = null;
    for (let n = el.parentElement, i = 0; n && i < 6; i++, n = n.parentElement) {
      if (controlCount(n) > 1 || n.querySelector('label')) break;
      if (!isVisible(n) || n.getBoundingClientRect().width < 120) continue;
      fallback = fallback || n;
      if (norm(cleanText(n))) return n;
    }
    // A plain autocomplete text box right next to its label is its own box.
    return fallback || (isVisible(el) && el.getBoundingClientRect().width >= 120 ? el : null);
  }

  // Workday puts the current choice and "Required" into the button's aria-label ("Country Select One Required",
  // "Country United States of America Required"), so both come out of the label.
  function buttonLabel(el) {
    let t = rawLabel(el);
    const shown = el.textContent.replace(/\s+/g, ' ').trim();
    if (shown) t = t.split(shown).join(' ');
    return t.replace(/\bselect one\b/gi, ' ').replace(/\brequired\b/gi, ' ');
  }

  // A full mouse click, for widgets that open or choose on mousedown (React-Select) or on click (Workday).
  function press(el) {
    const o = { bubbles: true, cancelable: true, composed: true, button: 0, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  function key(el, k) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true, composed: true }));
  }

  // Types into a searchable dropdown to filter its options. Unlike setValue() it doesn't blur the field,
  // since that would close the list.
  function typeInto(el, text) {
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // The options of the list this dropdown opened: the listbox it points to (aria-controls / aria-owns),
  // or else whatever listbox is showing on the page (Workday draws its list elsewhere in the page).
  function openOptions(el) {
    let lists = [];
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (id) { const n = byId(el, id); if (n) lists = [n]; }
    if (!lists.length) lists = deepQuery(document, '[role="listbox"]').filter(isVisible);
    const out = [];
    for (const l of lists) {
      for (const o of l.querySelectorAll('[role="option"]')) {
        if (o.getAttribute('aria-disabled') === 'true') continue;
        // val stays null when there's none: an empty value means "placeholder" to isPlaceholderOpt().
        out.push({ el: o, text: o.textContent.replace(/\s+/g, ' ').trim(), val: o.getAttribute('data-value') });
      }
    }
    return out.length ? out : null;
  }

  function closeDropdown(d) {
    if (d.typed) typeInto(d.el, '');
    key(d.el, 'Escape');
    try { d.el.blur(); } catch (_) { /* ignore */ }
  }

  // d: { el (the input or button), box (the visible control), res (your answer) }
  // Returns { text } of the option chosen, or { options } (the choices seen) when it couldn't choose.
  async function fillDropdown(d) {
    const { el, box, res } = d;
    if (el.tagName === 'BUTTON') {
      press(el);
    } else {
      press(box);
      // React-Select also opens on the down arrow, which works even when the browser window isn't focused.
      if (!openOptions(el)) key(el, 'ArrowDown');
    }
    let options = await waitFor(() => openOptions(el), 800);
    let pick = options && pickOption(options, res);

    // Long lists (countries, schools) may only show matches after you type, so search for the answer.
    if (!pick && el.tagName === 'INPUT' && !el.readOnly && !res.pick && !res.yesno) {
      typeInto(el, res.value);
      d.typed = true;
      pick = await waitFor(() => { const o = openOptions(el); if (o) options = o; return o && pickOption(o, res); }, 1500);
    }

    if (!pick) { closeDropdown(d); return { options: options ? optionTexts(options) : [] }; }
    press(pick.el);
    await wait(150);
    // Check it took: the box should now show the chosen option rather than its placeholder.
    const shown = shownText(d);
    const want = norm(pick.text).slice(0, 24);
    if (!looksEmpty(shown) && shown.includes(want)) { try { el.blur(); } catch (_) { /* ignore */ } return { text: pick.text }; }
    closeDropdown(d);
    return { options: optionTexts(options) };
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

  // The question a group of radio buttons or checkboxes answers, as written on the form
  // (callers lowercase it with norm() for matching).
  function groupQuestion(radios, box) {
    if (box.tagName === 'FIELDSET') {
      const lg = box.querySelector('legend');
      if (lg) { const t = cleanText(lg); if (norm(t)) return t; }
    }
    const aria = box.getAttribute('aria-label');
    if (aria && norm(aria)) return aria.trim();
    const lb = box.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => cleanText(byId(box, id))).join(' ');
      if (norm(t)) return t;
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
      const t = cleanText(node, skip);
      if (norm(t).length >= 3) return t.slice(0, 300);
    }
    return '';
  }

  // Ticks a radio button or checkbox so the page's own scripts notice.
  function tick(el) {
    el.click();
    if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // The text to match a group's answer against. Usually the question, but Workday's disability form asks
  // only "Please check one of the boxes below"; then the choices ("Yes, I have a disability...") say what
  // it's about, so they're added when they mention a demographic topic and the question doesn't.
  function groupAsk(q, options) {
    const choices = norm(options.map((o) => o.text).join(' '));
    return !DEMOGRAPHIC.test(q) && DEMOGRAPHIC.test(choices) ? `${q} ${choices}` : q;
  }

  function fillRadioGroup(radios, p, counters, stats) {
    const box = groupBox(radios);
    if (!box || (!isVisible(box) && !radios.some(isVisible))) return;
    const raw = groupQuestion(radios, box);
    const options = radios.map((r) => ({ el: r, text: optionLabel(r), val: r.value }));
    const checked = options.find((o) => o.el.checked);
    if (checked) { notePrefilled(stats, raw, checked.text); return; } // never overwrite
    const q = norm(raw);
    const res = q ? answerFor(p, groupAsk(q, options), [], radios[0], 'radio', counters) : null;
    const pick = res && pickOption(options, res);
    if (pick) {
      tick(pick.el);
      noteFilled(box, stats, raw, pick.text);
    } else {
      noteLeft(box, stats, raw, 'radio', { options: optionTexts(options), required: radios.some((r) => isRequired(r, raw)) });
    }
  }

  /* ---------- Checkboxes ---------- */

  // A list of checkboxes for one question ("Select all that apply") gets your saved answer or a matching
  // RULES answer (one box), or your self-identification answers (every box that applies). A lone checkbox
  // is left alone, except consent and certification boxes, which are outlined amber so you see them:
  // ticking one is an agreement in your name, so only you do that.
  function fillCheckboxGroup(boxes, p, counters, stats) {
    const box = groupBox(boxes);
    if (!box || (!isVisible(box) && !boxes.some(isVisible))) return;

    if (boxes.length === 1) {
      if (boxes[0].checked) return;
      const raw = rawLabel(boxes[0]) || optionLabel(boxes[0]);
      if (CONSENT.test(norm(raw))) noteLeft(visibleAncestor(boxes[0], 40) || box, stats, raw, 'checkbox', { required: isRequired(boxes[0], raw) });
      return;
    }

    const raw = groupQuestion(boxes, box);
    const options = boxes.map((b) => ({ el: b, text: optionLabel(b), val: b.value }));
    const ticked = options.filter((o) => o.el.checked);
    if (ticked.length) { notePrefilled(stats, raw, ticked.map((o) => o.text).join('; ')); return; } // never overwrite
    const q = norm(raw);
    const res = q ? answerFor(p, groupAsk(q, options), [], boxes[0], 'radio', counters) : null;
    let chosen = [];
    if (res) chosen = res.pickAll ? res.pickAll(options) : [pickOption(options, res)].filter(Boolean);
    if (chosen.length) {
      chosen.forEach((o) => tick(o.el));
      noteFilled(box, stats, raw, chosen.map((o) => o.text).join('; '));
    } else {
      noteLeft(box, stats, raw, 'checkboxes', { options: optionTexts(options), required: boxes.some((b) => isRequired(b, raw)) });
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

  // Attaches your stored resume to the first resume upload on the page. When there's no stored resume,
  // or Claude asked (it attaches a resume tailored to the job instead), or the site blocks scripted uploads,
  // the upload is outlined amber and reported, so you can see where the file goes.
  function attachResume(el, resume, stats, state) {
    if (state.resumeDone || el.disabled) return;
    if (el.files && el.files.length) return;
    const text = [labelFor(el), ...hintsFor(el), norm(nearbyText(el))].join(' ');
    if (!/\b(resume|résumé|cv|curriculum vitae)\b/.test(text) || /\bcover\b/.test(text)) return;
    state.resumeDone = true; // one resume per page, attached or not
    const box = visibleAncestor(el, 40) || el;
    const raw = rawLabel(el) || 'Resume';
    if (resume && resume.data && acceptOk(el.getAttribute('accept'), resume)) {
      try {
        const file = new File([b64ToBytes(resume.data)], resume.name, { type: resume.type || 'application/pdf', lastModified: Date.now() });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        stats.resume = resume.name;
        noteFilled(box, stats, raw, resume.name);
        return;
      } catch (_) { /* the site blocked it; leave it for you */ }
    }
    noteLeft(box, stats, raw, 'file', { required: isRequired(el, raw) });
  }

  /* ---------- Main ---------- */

  // opts.skipResume: don't attach the stored resume (set when Claude asks through the bridge).
  // Returns { filled, left, resume, fields, prefilled, todo }; see "Report" above.
  // It fills only what's on the page now. On multi-step forms (Workday's "Save and Continue" pages) run it
  // again on each step; it never clicks Continue or Submit itself.
  async function fill(opts = {}) {
    let data = {};
    // The Fill button never attaches the stored resume, so don't load it: it's a base64 PDF that can run to
    // megabytes, read out of storage on every page and Workday step.
    const keys = opts.skipResume ? ['profile'] : ['profile', 'resume'];
    try { data = await chrome.storage.local.get(keys); } catch (_) { /* fall through with empty profile */ }
    const p = data.profile || {};
    const resume = opts.skipResume ? null : data.resume || null;

    clearMarks();
    const stats = { filled: 0, left: 0, resume: null, fields: [], prefilled: [], todo: [] };
    const counters = Object.create(null);
    const state = { resumeDone: false };
    const groups = new Map();
    const checkGroups = new Map();
    const dropdowns = [];

    // First pass: plain fields are filled right away; custom dropdowns are queued for the second pass.
    for (const el of deepQuery(document, 'input, select, textarea, button[aria-haspopup="listbox"]')) {
      const tag = el.tagName;
      const type = tag === 'INPUT' ? (el.getAttribute('type') || '').toLowerCase() : '';
      if (type === 'radio') { if (!el.disabled) addToGroup(groups, el); continue; }
      if (type === 'checkbox') { if (!el.disabled) addToGroup(checkGroups, el); continue; }
      if (type === 'file') { attachResume(el, resume, stats, state); continue; }
      if (tag === 'INPUT' && !FILLABLE_TYPES.has(type)) continue;
      if (el.disabled) continue;

      // Workday-style dropdown: a button that opens a list, showing the current choice as its text.
      if (tag === 'BUTTON') {
        if (!isVisible(el)) continue;
        const raw = buttonLabel(el);
        const res = answerFor(p, norm(raw), hintsFor(el), el, 'select', counters);
        const d = { el, box: el, res, raw };
        // Only buttons showing a placeholder ("Select One"): one with a choice is never overwritten, and
        // one with no text at all is an icon menu, not a form field.
        const shown = shownText(d);
        if (shown && looksEmpty(shown)) dropdowns.push(d);
        else if (shown && norm(raw)) notePrefilled(stats, raw, shownRaw(d));
        continue;
      }

      // Combobox inputs (React-Select and similar). Their real input can be tiny, hidden or read-only,
      // so what has to be visible is the box around it.
      const combo = tag === 'INPUT' && (el.getAttribute('role') === 'combobox'
        || el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-haspopup') === 'listbox');
      if (!combo && (el.readOnly || !isVisible(el))) continue;

      const raw = rawLabel(el);
      const label = labelFor(el);
      const hints = hintsFor(el);
      if (/\bsearch\b/.test(label) || hints.some((h) => /\bsearch\b/.test(h))) continue;

      if (combo) {
        const box = comboBox(el);
        if (!box || box.hasAttribute(MARK)) continue;
        const res = answerFor(p, label, hints, el, 'select', counters); // before the value check, like below
        const d = { el, box, res, raw };
        if (!String(el.value || '').trim() && looksEmpty(shownText(d))) dropdowns.push(d);
        else notePrefilled(stats, raw, String(el.value || '').trim() || shownRaw(d));
        continue;
      }

      const kind = tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textarea' : 'text';
      const res = answerFor(p, label, hints, el, kind, counters); // runs first so job/school order stays right
      if (hasValue(el)) { // never overwrite
        notePrefilled(stats, raw, kind === 'select' ? el.options[el.selectedIndex].text : el.value, res && res.rule && res.rule.name ? res.value : null);
        continue;
      }
      if (res && apply(el, kind, res)) {
        noteFilled(el, stats, raw, kind === 'select' ? el.options[el.selectedIndex].text : el.value);
      } else {
        const options = kind === 'select' ? optionTexts([...el.options].map((o) => ({ text: o.text, val: o.value }))) : null;
        noteLeft(el, stats, raw, kind === 'select' ? 'dropdown' : kind, { options, required: isRequired(el, raw) });
      }
    }

    for (const radios of groups.values()) fillRadioGroup(radios, p, counters, stats);
    for (const boxes of checkGroups.values()) fillCheckboxGroup(boxes, p, counters, stats);

    // Second pass: custom dropdowns, one at a time. Ones with no answer in your profile aren't even opened.
    for (const d of dropdowns) {
      const required = isRequired(d.el, d.raw);
      if (!d.res) { noteLeft(d.box, stats, d.raw, 'custom dropdown', { required }); continue; }
      let r;
      try { r = await fillDropdown(d); } catch (_) { r = { options: [] }; }
      if (r.text) noteFilled(d.box, stats, d.raw, r.text);
      else noteLeft(d.box, stats, d.raw, 'custom dropdown', { options: r.options, required });
    }
    return stats;
  }

  globalThis.__autointernship = { fill, clear: clearMarks };
})();
