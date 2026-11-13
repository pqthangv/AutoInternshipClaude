/* AutoInternship autofill
   Injected into the current tab only when you click "Fill this page", press the shortcut, or
   (if you turned it on) Claude asks through the bridge (bridge.js).
   It reads your profile from chrome.storage.local, fills the fields it recognizes, never
   overwrites anything that already has a value (except tidying work descriptions Workday copied
   badly from your resume, see tidyDescription), and outlines fields on the page:
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
  const DEMOGRAPHIC = /\b(gender|sex|pronouns?|races?|racial|ethnicity|ethnic|hispanic|latin[oax]|veteran|disability|disabled|sexual orientation|transgender|lgbt\w*|religion|religious|marital)\b/;
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
  // "May 2028" → "2028" for a year-only field, "May" for a month-only field. The month is spelled out
  // ("Jun 2029" → "June"), since month lists do (Oracle's graduation month list did) and "Jun" is too
  // short to match "June".
  const MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
  function gradValue(v, label) {
    if (!v) return v;
    const year = String(v).match(/\b(19|20)\d{2}\b/);
    const month = String(v).match(MONTH_RE);
    if (/\byear\b/.test(label) && !/\bmonth\b/.test(label)) return year ? year[0] : v;
    if (/\bmonth\b/.test(label) && !/\byear\b/.test(label)) return month ? MONTHS.find((m) => m.toLowerCase().startsWith(month[0].toLowerCase().slice(0, 3))) : null;
    return v;
  }

  // One part of a school's start or end date ("Sep 2026", "2026-09", "09/2026"): the year for a year box,
  // the full month name for a month box, since month lists spell it out ("September") and "Sep" alone is
  // too short to match.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function datePart(v, label) {
    const s = String(v || '');
    const year = s.match(/\b(19|20)\d{2}\b/);
    if (/\byear\b/.test(label)) return year ? year[0] : null;
    const name = s.match(MONTH_RE);
    if (name) return MONTHS.find((m) => m.toLowerCase().startsWith(name[0].toLowerCase().slice(0, 3))) || null;
    const num = s.match(/\b(19|20)\d{2}[-/](\d{1,2})\b/) || s.match(/\b(\d{1,2})[-/](19|20)\d{2}\b/);
    const n = num ? Number(num[0].startsWith('19') || num[0].startsWith('20') ? num[2] : num[1]) : 0;
    return n >= 1 && n <= 12 ? MONTHS[n - 1] : null;
  }

  // Graduation lists often stop short for a first-year student: the profile says Jun 2030, the form offers
  // up to 2029. Leaving the question blocked the form, so the user chose (2026-11-07) to pick the closest
  // date offered instead: the latest when all are earlier, the earliest when all are later, the nearest
  // month or season within a year. The report flags each one ("Check:"), so the record shows what the form
  // says. Only the graduation rule does this (nearestDate: true); other year questions keep exact matching.
  const SEASONS = { winter: 1, spring: 5, summer: 8, fall: 12, autumn: 12 };
  function whenOf(s) {
    const t = norm(s);
    const years = t.match(/\b(19|20)\d{2}\b/g);
    if (!years || years.length !== 1) return null; // no date, or a span like "2029-2030" that could mean either
    const m = t.match(MONTH_RE);
    const season = t.match(/\b(winter|spring|summer|fall|autumn)\b/);
    const month = m ? MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[0].toLowerCase().slice(0, 3))) + 1
      : season ? SEASONS[season[1]] : 0;
    return Number(years[0]) * 12 + (month || 6); // a bare year counts as mid-year
  }
  function nearestDate(opts, value) {
    const want = whenOf(value);
    if (want == null) return null;
    let best = null; let gap = Infinity;
    for (const o of opts) {
      const at = whenOf(o.text) ?? whenOf(o.val);
      if (at != null && Math.abs(at - want) < gap) { gap = Math.abs(at - want); best = o; }
    }
    return best;
  }
  // Greenhouse's education section, the only place its date boxes are a school's dates (see the rules).
  const EDU_SECTION = '[class*="education"]';

  // Two sponsorship answers, because many students need none for the internship itself (on CPT, for
  // example) but will need it for a full-time job later:
  //   a question that includes the future ("now or in the future")  → needsSponsorship
  //   a question only about this internship or role, or "now"       → needsSponsorshipForInternship
  //   a question that could mean either                             → only when the two answers agree
  // Anything else is left for you. A wrong answer here can get an offer withdrawn, so when unsure, leave it.
  const SPONSOR_LATER = /\bfuture\b|\bnow or later\b|\bat any (point|time)\b|\bever\b|\bupon graduation\b|\bafter (you )?graduat\w*|\bfull[- ]time\b|\bh-?1-?b\b/;
  const SPONSOR_THIS_ROLE = /\b(this|the) (internship|co-?op|role|position|job|opportunity)\b|\bduring (the|this|your) internship\b/;
  // "Do you require visa sponsorship now?" without the future is about the internship too.
  const SPONSOR_NOW = /\bnow\b/;
  // Examples in parentheses aren't the question. DoorDash asks "Will you now require immigration sponsorship
  // ... (e.g., H-1B, E-3, TN, O-1, STEM OPT, or any immigration work authorization ...)" and, separately,
  // "Will you in the future require ...". With the examples, the label was too long for the rule below to
  // match, and "H-1B" in them would have given the "now" question the future answer. So rules match the
  // label without them (see matches()), and so does the now-or-later test here.
  const EXAMPLES = /\(\s*(e\.?\s?g\b\.?|i\.?\s?e\b\.?|(such as|for example|for instance|including|like)\b)[^)]*(\)|$)/g;
  const noExamples = (s) => s.replace(EXAMPLES, ' ').replace(/\s+/g, ' ').trim();
  function sponsorAnswer(p, label) {
    label = noExamples(label);
    const later = yn(p.needsSponsorship);
    const now = yn(p.needsSponsorshipForInternship);
    if (SPONSOR_LATER.test(label)) return later;
    if (now && (now === later || SPONSOR_THIS_ROLE.test(label) || SPONSOR_NOW.test(label))) return now;
    // Never needing sponsorship covers this role too.
    return later === 'no' && now !== 'yes' ? 'no' : null;
  }
  // Some forms ask it the other way round: "Are you authorized to work in the US and will not require
  // sponsorship now or in the future?", "Can you work here without sponsorship?". Yes there means no
  // sponsorship, so the plain answer would say the opposite of the truth (an iCIMS form got Yes from a
  // profile that will need sponsorship). Yes only when you're authorized and won't need it; No when either
  // fails. Only the question itself counts (its last sentence ending in "?"), so a requirement in front of
  // it ("Applicants must be authorized to work without sponsorship. Will you require sponsorship?") keeps
  // the plain answer. The negation has to sit in the same clause as "require/need ... sponsorship".
  const NO_SPONSOR = /\bwithout\b(\s+[\w-]+){0,4}\s+sponsor\w*|\b(not|never|won't|don't|doesn't|wouldn't)\s+(\w+\s+){0,5}?(require|need)\w*(\s+[\w()-]+){0,4}\s+sponsor\w*/;
  // The usual question ("Will you now or in the future require sponsorship?"), not negated.
  const ASKS_SPONSOR = /\b(will|do|would|does) you\b(\s+(?!not\b|never\b)[\w-]+){0,6}\s+(require|need)\w*(\s+[\w()-]+){0,4}\s+sponsor\w*/;
  function sponsorQuestion(p, label) {
    const asks = noExamples(label).match(/[^.?!]*\?/g);
    const ask = asks ? asks[asks.length - 1] : noExamples(label);
    if (!NO_SPONSOR.test(ask)) return sponsorAnswer(p, label);
    // Both ways in one sentence: which way Yes points isn't clear, so leave it.
    if (ASKS_SPONSOR.test(ask)) return null;
    const need = sponsorAnswer(p, label);
    const authorized = yn(p.workAuthorized);
    if (authorized === 'no' || need === 'yes') return 'no';
    return authorized === 'yes' && need === 'no' ? 'yes' : null;
  }

  // "Are you currently authorized to work under OPT?" asks about one permit, not whether you may work: a student
  // on F-1 with CPT is authorized, but not under OPT, and the work-authorization answer gave it Yes. A question
  // that names a visa or permit is left ("opt in" and "opt out" aren't OPT).
  const NAMES_PERMIT = /\bopt\b(?![\s-]?(in|out)\b)|\b(optional|curricular) practical training\b|\bcpt\b|\bh-?1-?b\b|\b[fj]-?1\b|\bead\b|\bgreen card\b|\bvisas?\b/;

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

  // Boxes inside one of the entries on a work or education history: Workday's "workExperience-4--location",
  // a box labeled "Employer City" or "School Location". Your own address never belongs there, but Workday's
  // resume reader leaves a job's Location empty when it can't read it, and the plain "Location" label then
  // got your home city and state from the home-location rule (seen on more than a dozen applications).
  // home: true marks the rules for your own address, which skip these boxes; they're left for Claude.
  const ENTRY_HINT = /\b(work experience|work history|job history|experiences?|employers?|employment|education|schools?)\b/;
  const ENTRY_LABEL = /\b(employer|company|school|college|university|institution)('s)?\b/;
  const inEntry = (label, hints) => ENTRY_LABEL.test(label || '') || hints.some((h) => ENTRY_HINT.test(h));

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
    { re: /^(current |your |home )?location$|\bwhere are you (currently )?(located|based)\b|^city,? state\b|^current (city|location)\b|^location \(city\)$|^based in\b/, max: 60, home: true, value: loc },
    { re: /\bcity\b|\btown\b/, ac: ['address-level2'], max: 40, not: /\b(desired|prefer\w*|relocat\w*|birth)\b/, home: true, value: (p) => p.city },
    { re: /^(state|province|region)$|^state ?(\/|or) ?province$|^state of residence$/, hint: /\b(state|province|region)$/, ac: ['address-level1'], max: 40, home: true, value: (p) => p.state },
    { re: /\bzip\b|\bpostal\b|\bpost ?code\b/, ac: ['postal-code'], max: 40, home: true, value: (p) => p.postalCode },
    { re: /\bcountry\b/, ac: ['country', 'country-name'], max: 40, not: /\b(code|phone|dial|citizen\w*|authori\w*|visa|which countr\w*|other countr\w*)\b/, home: true, value: (p) => p.country },
    { re: /\bstreet\b|^address( line)? ?1$|^(home |mailing |street |current )?address$/, hint: /\baddress line ?1$|\bstreet( address)?$|^address$/, ac: ['address-line1', 'street-address'], max: 40, not: /\b(e[ -]?mail|ip|web|url|line ?2|address ?2|apartment|apt|suite|city|state|zip|postal|country)\b/, home: true, value: (p) => p.street },

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
    // Greenhouse asks for each school's dates in four boxes ("Start date month", "Start date year", "End date
    // month", "End date year"). Its work-history rows use the same labels, so these only apply inside the
    // education section. Claude used to fill all four by hand on every such form.
    { key: 'edu.startMonth', re: /^start (date )?month$/, max: 40, within: EDU_SECTION, idx: 'education', field: 'start', part: datePart },
    { key: 'edu.startYear', re: /^start (date )?year$/, max: 40, within: EDU_SECTION, idx: 'education', field: 'start', part: datePart },
    { key: 'edu.endMonth', re: /^end (date )?month$/, max: 40, within: EDU_SECTION, idx: 'education', field: 'end', part: datePart },
    { key: 'edu.endYear', re: /^end (date )?year$/, max: 40, within: EDU_SECTION, idx: 'education', field: 'end', part: datePart },
    { re: /\bgraduation (date|year|month|term|semester)\b|\byear of graduation\b|\bgrad(uation)? (year|date)\b|\bexpected (grad|graduation)\b|\bwhen (do|will) you graduate\b|\bgraduating (year|class)\b|\bclass of\b/, max: 70, kinds: ['text', 'select', 'radio'], nearestDate: true, value: (p, label) => gradValue(p.expectedGraduation || edu0(p).end, label) },

    // Student and internship questions
    { re: /\b(class|academic|student) (standing|level|year)\b|\b(current )?year (in|of) (school|study|college|university|program)\b|\bclassification\b|\bcurrent (school |academic )?year\b|\bschool year\b/, max: 80, kinds: YESNO_KINDS, value: (p) => p.classStanding },
    { re: /\b(are you|currently) (currently )?(enrolled|a (full[- ]time |part[- ]time )?student)\b|\benrolled (in|at)\b/, max: 250, yesno: true, kinds: YESNO_KINDS, value: (p) => yn(p.enrolled) },
    { re: /\breturn(ing)? to (school|your studies|university|college|campus)\b|\bcontinu(e|ing) (your |with your )?(education|studies|degree)\b/, max: 250, yesno: true, kinds: YESNO_KINDS, value: (p) => yn(p.returningToSchool) },
    { re: /\b(relevant )?course ?work\b|\brelevant (courses|classes)\b|\bcourses (you'?ve|you have) (taken|completed)\b/, max: 120, kinds: ['text', 'textarea'], value: (p) => p.relevantCoursework },
    { re: /\bwhich (term|season|semester|session|cohort)\b|\b(internship|co-?op) (term|season|session|period|cohort)\b|\bterm of interest\b|\b(term|season|semester) (are you |you are )?(applying|interested|available)\b|^term$/, max: 120, kinds: YESNO_KINDS, value: (p) => p.internshipTerm },
    { re: /\bavailable (until|through)\b|\b(internship|availability) end( date)?\b|\bend date of (your )?availability\b|\blatest (possible )?end date\b/, max: 100, kinds: ['text'], value: (p) => p.availableUntil },

    { re: /\byears of (\w+ )?experience\b|\bhow many years\b/, max: 70, not: /\b(with|using|in)\b/, value: (p) => p.yearsExperience },
    { re: /\bsponsor\w*/, max: 250, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: sponsorQuestion },
    { re: /\b(authori[sz]ed|eligible|permitted|entitled|legally able|allowed) to work\b|\bwork authori[sz]ation\b|\bright to work\b/, max: 250, not: /\bsponsor\w*/, yesno: true, countryCheck: true, kinds: YESNO_KINDS, value: (p, label) => (NAMES_PERMIT.test(noExamples(label)) ? null : yn(p.workAuthorized)) },
    { re: GOVERNMENT, max: 300, not: GOVERNMENT_NOT, yesno: true, kinds: YESNO_KINDS, value: governmentAnswer },
    // A text box gets Yes only for "will you relocate?": Oracle forms also have "Length of Willing to Relocate"
    // and "Relocation Reason" boxes, which got "Yes" typed into them. Lists and radio buttons offer Yes/No
    // themselves, so they keep the shorter exclusions ("Willing to relocate? If not, please explain").
    { re: /\brelocat\w*/, max: 200, not: /\b(assistance|package|benefit\w*|support|cost\w*|expenses?)\b/, yesno: true, kinds: ['select', 'radio'], value: (p) => yn(p.willingToRelocate) },
    { re: /\brelocat\w*/, max: 200, not: /\b(assistance|package|benefit\w*|support|cost\w*|expenses?|length|reasons?|why|which|how|explain|describe|preferred)\b/, yesno: true, kinds: ['text'], value: (p) => yn(p.willingToRelocate) },
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
    if (rule.within && !el.closest(rule.within)) return false;
    if (rule.home && inEntry(label, hints)) return false;
    const texts = label ? [label, ...hints] : hints;
    if (rule.not && texts.some((t) => rule.not.test(t))) return false;
    const ac = acToken(el);
    if (rule.ac && ac && rule.ac.includes(ac)) return true;
    if (rule.type && el.type === rule.type) return true;
    const q = label && noExamples(label); // `not` above still sees the whole label
    if (q && (!rule.max || q.length <= rule.max) && rule.re.test(q)) return true;
    const hre = rule.hint || rule.re;
    return hints.some((h) => hre.test(h));
  }

  const DEGREE_ABBR = [
    // Each way round: a profile saying "BS" picks "Bachelor of Science", not the first "Bachelor of ..." in the list.
    [/\bbachelor'?s? of science\b|^b\.?\s?sc?\.?$/, ['bs', 'b.s.', 'bsc', 'b.sc.', 'bachelor of science']],
    [/\bbachelor'?s? of arts\b|^b\.?\s?a\.?$/, ['ba', 'b.a.', 'bachelor of arts']],
    [/\bbachelor'?s? of engineering\b|^b\.?\s?eng\.?$/, ['beng', 'b.eng.', 'bachelor of engineering']],
    [/\bmaster'?s? of science\b|^m\.?\s?sc?\.?$/, ['ms', 'm.s.', 'msc', 'm.sc.', 'master of science']],
    [/\bmaster'?s? of arts\b|^m\.?\s?a\.?$/, ['ma', 'm.a.', 'master of arts']],
    [/\bmaster'?s? of engineering\b|^m\.?\s?eng\.?$/, ['meng', 'm.eng.', 'master of engineering']],
    [/\bdoctor of philosophy\b|\bph\.?\s?d\b/, ['phd', 'ph.d.', 'doctor of philosophy']],
  ];

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
      // Some lists offer only abbreviations (Salesforce's Workday Degree list: GED | HS | AA | BA | BS | MA | MS | MAS),
      // and "Bachelor of Science" shares no word with "BS"; Claude spent about ten calls picking it by hand.
      for (const [re, abbr] of DEGREE_ABBR) if (re.test(v)) abbr.forEach((x) => out.add(x));
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
    if (score >= 0.6) return best;
    // A saved answer like "Yes (can start before June 10, 2027)" matches no option of a Yes/No list; its first
    // word does. Only after the whole answer found nothing, so "No preference" still picks "No preference".
    if (res.lead) {
      const want = res.lead === 'yes' ? /^yes\b/ : /^no\b/;
      const o = opts.find((x) => want.test(norm(x.text)));
      if (o) return o;
    }
    // No option matches: the graduation rule takes the closest date offered (see nearestDate), marked so the
    // report can flag it.
    const near = res.rule && res.rule.nearestDate ? nearestDate(opts, res.value) : null;
    return near ? { ...near, nearest: true } : null;
  }

  // The questions in a label: its sentences ending in "?", or the whole label when none does. Sentences end at
  // ". ", "? " or "! ", not inside "U.S.", "e.g." or "3.0", and not at "..." (text left out).
  const ABBR_END = /(^|[\s(])([a-z]\.)+$|\b(etc|inc|ltd|co|corp|st|vs|no|jr|sr|dr|mr|mrs|ms|approx|dept)\.$/;
  function questionsOf(label) {
    const parts = [];
    let start = 0;
    for (let i = 0; i < label.length; i++) {
      const ch = label[i];
      if (ch !== '.' && ch !== '?' && ch !== '!') continue;
      if (i + 1 < label.length && !/\s/.test(label[i + 1])) continue;
      if (ch === '.' && (label[i - 1] === '.' || ABBR_END.test(label.slice(start, i + 1)))) continue;
      parts.push(label.slice(start, i + 1).trim());
      start = i + 1;
    }
    if (start < label.length) parts.push(label.slice(start).trim());
    const asks = parts.filter((s) => s.endsWith('?'));
    return asks.length ? asks : [label];
  }

  // A saved answer's phrase has to be in the question as whole words (a plural or -ing/-ed ending allowed):
  // plain substring matching put a "travel" answer into "Previously worked for Travelers?" and an "aws" answer
  // into "relatives or in-laws currently employed at ...?". A statement in front of the question doesn't count
  // (Addepar: "... relocation assistance is not provided. Are you able to work on-site?" got the
  // relocation-assistance answer, No), and neither does an ability question with the phrase after with/without
  // ("Can you perform these essential functions with reasonable accommodation?" got the accommodation answer).
  const ABILITY = /\b(can|could|are) you\b|\bable to\b/;
  function savedHit(m, label) {
    const re = new RegExp('(?<![a-z0-9])' + esc(m) + '(s|es|ing|ling|ed|led)?(?![a-z0-9])', 'g');
    for (const q of questionsOf(label)) {
      for (const hit of q.matchAll(re)) {
        const before = q.slice(0, hit.index);
        if (/\b(with|without)\s+(a\s+|any\s+)?$/.test(before) && ABILITY.test(before)) continue;
        return true;
      }
    }
    return false;
  }
  // When several match, the longest phrase wins: it's the most specific ("gpa 3.0 or higher" = Yes over
  // "cumulative gpa" = 4.0 for "Is your cumulative GPA 3.0 or higher?").
  function savedAnswer(p, label) {
    let best = null;
    let len = 0;
    for (const sa of p.savedAnswers || []) {
      const m = norm(sa.match);
      const ans = (sa.answer || '').trim();
      if (m && ans && m.length > len && savedHit(m, label)) { best = ans; len = m.length; }
    }
    return best;
  }

  // A sponsorship question about this internship only takes the internship answer even when a saved answer also
  // matches: Cyvl's "Would you need Cyvl to sponsor a visa for this internship?" got Yes from a saved answer to a
  // general sponsorship question, against the profile's No for the internship. The user chose the profile field.
  function internshipSponsorQuestion(p, label) {
    const q = noExamples(label);
    return /\bsponsor\w*/.test(q) && !!yn(p.needsSponsorshipForInternship) && !SPONSOR_LATER.test(q)
      && (SPONSOR_THIS_ROLE.test(q) || SPONSOR_NOW.test(q));
  }

  function resolve(p, label, hints, el, kind, counters) {
    // 1. Your saved answers come first, except on a sponsorship question about this internship only.
    const saved = internshipSponsorQuestion(p, label) ? null : savedAnswer(p, label);
    if (saved) {
      const lead = saved.toLowerCase().match(/^(yes|no)\b/);
      return { value: saved, yesno: yn(saved.toLowerCase()), lead: lead && lead[1], rule: null };
    }
    // 2. Built-in rules.
    for (const rule of RULES) {
      if (!(rule.kinds || DEFAULT_KINDS).includes(kind)) continue;
      if (!matches(rule, label, hints, el)) continue;
      let v;
      if (rule.idx) {
        const i = (counters[rule.key] = (counters[rule.key] ?? -1) + 1);
        v = p[rule.idx] && p[rule.idx][i] && p[rule.idx][i][rule.field];
        if (rule.part) v = rule.part(v, label);
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
  const RACES = {
    'american-indian': /\bamerican indian\b|\balaska\w* native\b|\bnative american\b|\bindigenous\b/,
    asian: /\basian\b/,
    black: /\bblack\b|\bafrican american\b/,
    'pacific-islander': /\bnative hawaiian\b|\bpacific islander\b/,
    white: /\bwhite\b|\bcaucasian\b/,
    'two-or-more': /\btwo or more\b|\b2 or more\b|\bmulti-?racial\b|\bmore than one\b|\bmixed\b/,
  };
  const ANY_RACE = new RegExp(Object.values(RACES).map((r) => r.source).join('|'));
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
    if (/\b(races?|racial|ethnicity|ethnic)\b/.test(q)) return 'race';
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
        // Not an option that names a race: a race list where each ends "(Not Hispanic or Latino)" isn't a No.
        if (p.hispanicLatino === 'no') return [has(/^no\b/), has(NOT_HISPANIC, DECLINE, ANY_RACE)];
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
        // An "Ethnicity" list with only Hispanic / Not Hispanic. Options that name a race don't count: Oracle's
        // "Select the races you identify with" ends every race with "(Not Hispanic or Latino)", and this used to
        // tick all of them.
        if (p.hispanicLatino === 'no') out.push(has(NOT_HISPANIC, DECLINE, ANY_RACE));
        if (p.race === 'decline') out.push(...DECLINED);
        return out;
      }
      case 'veteran':
        if (p.veteranStatus === 'decline') return DECLINED;
        // "I identify as a veteran, just not a protected veteran" also contains "not a protected veteran", so any
        // option that says you are a veteran is ruled out. The old test for "veteran but" missed it: norm() keeps
        // the comma, and Workday writes "just not". It was picked for non-veterans whenever it came first.
        // Assurant's Workday list also has "I am not a protected veteran (I served in the military but do not
        // fall into ...)" beside "I am not a Veteran (I did not serve ...)", and the first was picked.
        if (p.veteranStatus === 'no') return [has(/^no\b/, DECLINE), has(/\bnot a (protected )?veteran\b/, /\b(identify as|am|i'm) a veteran\b|\bi (have )?served\b/, DECLINE)];
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

  // True (and the box emptied again) when the box dropped the decimal point of a number typed into it.
  function lostDecimal(el, res) {
    const typed = String(res.value || '').trim();
    if (res.yesno || !/^\d+\.\d+$/.test(typed)) return false;
    const now = String(el.value || '').trim();
    if (now.includes('.') || now.replace(/\D/g, '') !== typed.replace('.', '')) return false;
    setValue(el, '');
    return true;
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
      res.nearest = !!pick.nearest; // the report flags it
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

  /* ---------- Work descriptions copied from the resume ---------- */

  // Workday's "Autofill with Resume" reads the uploaded PDF and copies each job's description into a box.
  // A PDF stores printed lines, not sentences, so a bullet that wraps on the page arrives as two lines
  // ("...cutting manual triage" / "time by 60%."), and the first bullet loses its "•". The copy also runs
  // from one job's dates to the next date it finds, so after the last job it takes the next section's
  // heading and the first line under it ("Projects" / "Northwind App | Python, React"). Claude never sees
  // this on its own: the report cuts long values short and page text leaves out what's in text boxes.
  // So this is the one place the fill changes a box that already has a value. It only deletes those
  // copied lines and joins the broken ones (plus the lost "•"), never adds words, and leaves the box
  // alone, listed for Claude, when something in it doesn't fit that pattern. Only Workday's boxes: on
  // other sites a description in a box is more likely one you typed.
  const ROLE_DESCRIPTION = /^workExperience-\d+--roleDescription$/;
  const BULLET = /^[•●▪◦‣·*–-]\s+/;
  // A line made only of these words is a resume section heading ("Projects", "Leadership & Entrepreneurship",
  // "TECHNICAL SKILLS"), which never belongs in a job's description.
  const HEADING_WORDS = new Set(['projects', 'project', 'experience', 'experiences', 'education', 'skills',
    'leadership', 'activities', 'extracurriculars', 'extracurricular', 'awards', 'honors', 'honours',
    'achievements', 'publications', 'certifications', 'certificates', 'volunteering', 'volunteer', 'languages',
    'interests', 'coursework', 'involvement', 'entrepreneurship', 'employment', 'research', 'summary',
    'objective', 'references', 'service', 'competitions', 'hackathons', 'scholarships', 'qualifications']);
  const HEADING_EXTRA = new Set(['and', 'selected', 'personal', 'academic', 'technical', 'relevant',
    'professional', 'work', 'key', 'other', 'additional', 'community', 'campus', 'student', 'side', 'software',
    'engineering', 'tools', 'technologies', 'information', 'profile']);

  function isHeading(line) {
    const t = line.trim().replace(/:$/, '');
    // A heading is short, has no digits or sentence marks, and starts each word with a capital ("and" aside),
    // so a broken line like "and leadership" isn't one.
    if (!t || t.length > 50 || /[^A-Za-z&/,\s-]/.test(t)) return false;
    const words = t.replace(/&/g, ' and ').split(/[\s/,-]+/).filter(Boolean);
    if (words.length > 5 || words.some((w) => w !== 'and' && !/^[A-Z]/.test(w))) return false;
    const low = words.map((w) => w.toLowerCase());
    return low.some((w) => HEADING_WORDS.has(w)) && low.every((w) => HEADING_WORDS.has(w) || HEADING_EXTRA.has(w));
  }

  const letters = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const finished = (s) => /[.!?]["')\]]?$/.test(s);

  // null: nothing to change. { left: why }: leave the box for Claude. { text, removed, joined }: the
  // tidied text, the lines cut off the end and how many broken lines were joined.
  // others: [{ company, location }] of the other work entries on the page. The copy sometimes ends with
  // the next job's own first line ("Northwind Labs Seattle, WA"), which is exactly that entry's Company
  // and Location boxes run together.
  function tidyDescription(value, others = []) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    if (isHeading(lines[0])) return { left: `starts with the heading "${lines[0]}", so it may be another part of the resume` };
    const nextJob = (l) => !finished(l) && others.some((o) => {
      const k = letters(l);
      const c = letters(o.company);
      return c.length >= 3 && k.startsWith(c) && (k === c || k.slice(c.length) === letters(o.location));
    });
    const pipe = (l) => /\s\|\s/.test(l);
    let end = lines.findIndex((l, i) => i > 0 && (isHeading(l) || (!BULLET.test(l) && nextJob(l))));
    if (end < 0) end = lines.length;
    // A job with one bullet comes without any "•" (the first one is the one lost).
    const bulleted = lines.slice(1, end).some((l) => BULLET.test(l));
    // A printed line that wraps onto the next one runs nearly the full width of the page.
    const wide = Math.max(...lines.slice(0, end).map((l) => l.replace(BULLET, '').length));
    const wraps = (l) => !finished(l) && l.replace(BULLET, '').length >= Math.max(40, 0.7 * wide);
    const left = (l) => ({ left: `may hold text from another part of the resume: "${l.slice(0, 80)}"` });
    const out = [lines[0]];
    let joined = 0;
    for (let i = 1; i < end; i++) {
      const l = lines[i];
      if (BULLET.test(l)) { out.push(l); continue; }
      if (pipe(l)) return left(l);
      // A line without a "•" is the rest of the bullet above only when the line above runs the full width
      // and stops mid-sentence, and the lines after it then finish the sentence. Anything else (text after
      // a finished sentence, a short line, bullets written without a final period) can't be told apart from
      // another entry's text: left for Claude when there are bullets, kept as it is in text without them.
      let j = i;
      while (j < end - 1 && !BULLET.test(lines[j + 1]) && !finished(lines[j]) && wraps(lines[j])) j++;
      const run = lines.slice(i, j + 1);
      if (wraps(lines[i - 1]) && finished(lines[j]) && !run.some(pipe)) {
        out[out.length - 1] = [out[out.length - 1], ...run].join(' ');
        joined += run.length;
        i = j;
        continue;
      }
      if (bulleted) return left(l);
      out.push(l);
    }
    const removed = lines.slice(end).join(' / ');
    if (!removed && !joined) return null;
    const dot = bulleted && out.slice(1).map((l) => l.match(BULLET)).find(Boolean);
    if (dot && !BULLET.test(out[0])) out[0] = dot[0] + out[0];
    return { text: out.join('\n'), removed, joined };
  }

  // "Location (Work Experience 4)" for a box in Workday's 4th work entry, so a box left for Claude says which
  // entry it belongs to (every entry's boxes have the same labels). n counts the entries on the page in order,
  // like the Role Description numbers below, since the ids' own numbers can skip.
  const ENTRY_ID = /^(workExperience|education)-\d+--/;
  function entryLabel(el, raw) {
    const m = ENTRY_ID.exec(el.id || '');
    if (!m) return raw;
    const kind = m[1];
    const own = m[0];
    const seen = [];
    for (const e of deepQuery(document, `[id^="${kind}-"]`)) {
      const k = (ENTRY_ID.exec(e.id) || [])[0];
      if (k && !seen.includes(k)) seen.push(k);
    }
    return `${raw} (${kind === 'education' ? 'Education' : 'Work Experience'} ${seen.indexOf(own) + 1})`;
  }

  // n: the box's place among the work entries ("Work Experience 3"). True when the box was reported here.
  function tidyRoleDescription(el, raw, n, stats) {
    const own = el.id.replace(/roleDescription$/, '');
    const others = deepQuery(document, 'input[id^="workExperience-"][id$="--companyName"]')
      .filter((c) => !c.id.startsWith(own))
      .map((c) => {
        const where = document.getElementById(c.id.replace(/companyName$/, 'location'));
        return { company: String(c.value || '').trim(), location: where ? String(where.value || '').trim() : '' };
      });
    const r = tidyDescription(el.value, others);
    if (!r) return false;
    const label = `${raw} (Work Experience ${n})`;
    if (r.left) { noteLeft(el, stats, label, 'textarea', { note: r.left }); return true; }
    setValue(el, r.text);
    if (String(el.value).replace(/\r\n?/g, '\n') !== r.text) {
      noteLeft(el, stats, label, 'textarea', { note: 'has lines copied badly from the resume, and the box kept them' });
      return true;
    }
    mark(el, 'filled');
    stats.tidied.push({ label: tidy(label), removed: r.removed.slice(0, 300), joined: r.joined });
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
  //   stats.fields:    [{ label, value, profile? }]             filled by AutoInternship just now; profile is
  //                                                             set when the closest option stood in for the
  //                                                             profile's date (see nearestDate)
  //   stats.prefilled: [{ label, value, profile? }]             already had a value (you, an earlier fill, or
  //                                                             the site itself, like Workday's resume parsing);
  //                                                             never changed, no outline
  //   stats.todo:      [{ label, kind, options?, required?, note? }]   left, with the choices if known;
  //                                                             note says why when the kind doesn't
  //   stats.tidied:    [{ label, removed, joined }]             a work description the site copied badly
  //                                                             from the resume, tidied (see tidyDescription)
  //
  // profile is set when a name box holds something other than your profile's name. Sites' resume parsers
  // often split a two-word first name ("Mei Ling Chen" → first "Mei", last "Ling Chen"), and the fill never
  // overwrites, so the report flags these for Claude rather than leaving it to compare every value. Only
  // names: other values (phone formats, school names) differ harmlessly too often.
  // "Nguyễn" and "NGUYEN" match "Nguyen". đ is its own letter, not d plus an accent, so it's swapped by hand.
  const fold = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  function notePrefilled(stats, label, value, expected) {
    const item = { label: tidy(label), value: String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
    if (expected && fold(item.value) !== fold(expected)) item.profile = String(expected).slice(0, 500);
    stats.prefilled.push(item);
  }

  function noteFilled(box, stats, label, value, profile) {
    mark(box, 'filled');
    stats.filled++;
    const item = { label: tidy(label), value: String(value ?? '').slice(0, 500) };
    if (profile) item.profile = String(profile).slice(0, 500);
    stats.fields.push(item);
  }

  function noteLeft(box, stats, label, kind, extra = {}) {
    mark(box, 'left');
    stats.left++;
    const item = { label: tidy(label), kind };
    if (extra.options && extra.options.length) item.options = extra.options.map((o) => tidy(o)).filter(Boolean).slice(0, 40);
    if (extra.required) item.required = true;
    if (extra.note) item.note = extra.note;
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
    // Oracle's dropdown input shows the chosen value itself; its wrapper holds only the label text
    // ("Country code"), which read as an answer already chosen.
    if (el.classList.contains('cx-select-input')) return isVisible(el) ? el : null;
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
  // Its Application Questions label the button only " Select One Required" and put the question in the <legend> of
  // the fieldset around it. Without the legend every one of them was reported as an unlabeled "(dropdown)" and left,
  // and Claude picked them by hand, a click and a screenshot each. The legend is read only when the button's own
  // label was nothing but those words, so buttons on other sites keep the label they had.
  function buttonLabel(el) {
    const own = rawLabel(el);
    let t = own;
    const shown = el.textContent.replace(/\s+/g, ' ').trim();
    if (shown) t = t.split(shown).join(' ');
    t = t.replace(/\bselect one\b/gi, ' ').replace(/\brequired\b/gi, ' ');
    if (!norm(t) && norm(own)) {
      const set = el.closest('fieldset');
      const legend = set && set.querySelector('legend');
      if (legend && controlCount(set) <= 1) t = cleanText(legend); // one question per fieldset (plus Workday's hidden text box)
    }
    return t;
  }

  // Workday's search lists: a "Search" box over a list of chosen items ("1 item selected"), used for How Did You Hear,
  // Field of Study, Skills and the phone country code. Typing into the box only searches, so these were reported as
  // Filled with nothing chosen, and the phone code (already chosen) as left. Report what is chosen, else leave it.
  function noteSearchList(el, stats) {
    const list = el.closest('[data-uxi-widget-type="multiselect"]') || el.parentElement;
    if (!isVisible(list)) return;
    const raw = rawLabel(el);
    const chosen = [...list.querySelectorAll('[data-automation-id="selectedItem"]')].map((n) => {
      const p = n.querySelector('[data-automation-label]');
      return (p && p.getAttribute('data-automation-label')) || cleanText(n);
    }).filter(Boolean);
    if (chosen.length) notePrefilled(stats, raw, chosen.join('; '));
    else noteLeft(list, stats, raw, 'search list', { required: isRequired(el, raw) });
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

  const shownLists = () => deepQuery(document, '[role="listbox"]').filter(isVisible);

  // The options of the list this dropdown opened: the listbox it points to (aria-controls / aria-owns),
  // or else a listbox that appeared after it was opened (Workday draws its list elsewhere in the page).
  // `before` holds the lists already showing beforehand. One left open by an earlier dropdown must not
  // count: on a live Greenhouse form, every question after the School dropdown was offered the school
  // list, found no "Yes" in it, and was left for Claude.
  // Oracle's list is a grid (role=grid, one gridcell per option) rather than a listbox; it's only taken
  // from the list the dropdown points to, so a table elsewhere on the page can't be read as options.
  function openOptions(el, before) {
    let lists = [];
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (id) { const n = byId(el, id); if (n) lists = [n]; }
    if (!lists.length) lists = shownLists().filter((l) => !(before && before.has(l)));
    const out = [];
    for (const l of lists) {
      for (const o of l.querySelectorAll(l.getAttribute('role') === 'grid' ? '[role="gridcell"]' : '[role="option"]')) {
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

  // Scrolls a dropdown to the middle of the window before opening it, and lets the scroll settle. Workday
  // closes an open list when the page scrolls. On long Application Questions pages (14 and 17 questions) the
  // first list didn't take and no list after it opened, while a 4-question page filled fine, and Claude's own
  // picks, which scroll to the button first, always worked. A button near the bottom edge counts too: its list
  // opens below the edge, takes focus, scrolls the page and closes. The top band is left alone because sticky
  // headers cover it.
  async function bringIntoView(el) {
    const r = el.getBoundingClientRect();
    if (r.top >= window.innerHeight * 0.15 && r.bottom <= window.innerHeight * 0.55) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch (_) { return; }
    await wait(300);
  }

  // Waits for the list to close, so the next dropdown starts with none open: openOptions() skips lists that
  // were already showing, so one left open would hide the next dropdown's options. If the dropdown's own
  // Escape didn't close it, Escape goes to the list and to whatever has focus.
  async function waitClosed(list) {
    if (!list) return;
    const gone = () => !list.isConnected || !isVisible(list);
    if (await waitFor(gone, 400)) return;
    key(list, 'Escape');
    const f = document.activeElement;
    if (f && f !== document.body && f !== list) key(f, 'Escape');
    await waitFor(gone, 300);
  }

  const listOf = (options) => (options && options[0] ? options[0].el.closest('[role="listbox"], [role="grid"]') : null);

  // d: { el (the input or button), box (the visible control), res (your answer) }
  // Returns { text } of the option chosen, or { options } (the choices seen) when it couldn't choose.
  // A list button gets a second try when no list was seen or the pick didn't take, as a person would click
  // again: a Workday list can close the moment it opens (see bringIntoView), for example at the foot of the
  // page, where the button can't be scrolled to the middle. A list with no matching option isn't tried again.
  async function fillDropdown(d) {
    let r = await tryDropdown(d);
    if (r.retry && d.el.tagName === 'BUTTON' && looksEmpty(shownText(d))) r = await tryDropdown(d);
    return r.text ? { text: r.text } : { options: r.options };
  }

  async function tryDropdown(d) {
    const { el, box, res } = d;
    await bringIntoView(box || el);
    const before = new Set(shownLists());
    if (el.tagName === 'BUTTON') {
      press(el);
    } else {
      press(box);
      // React-Select also opens on the down arrow, which works even when the browser window isn't focused.
      if (!openOptions(el, before)) key(el, 'ArrowDown');
    }
    let options = await waitFor(() => openOptions(el, before), 800);
    let pick = options && pickOption(options, res);

    // Long lists (countries, schools) may only show matches after you type, so search for the answer.
    if (!pick && el.tagName === 'INPUT' && !el.readOnly && !res.pick && !res.yesno) {
      typeInto(el, res.value);
      d.typed = true;
      pick = await waitFor(() => { const o = openOptions(el, before); if (o) options = o; return o && pickOption(o, res); }, 1500);
    }

    const list = listOf(options);
    if (!pick) { closeDropdown(d); await waitClosed(list); return { options: options ? optionTexts(options) : [], retry: !options }; }
    d.nearest = !!pick.nearest; // the report flags it
    press(pick.el);
    // Check it took: the box should now show the chosen option rather than its placeholder. Some show only
    // part of it: Greenhouse's phone country box shows "+1" once "United States +1" is chosen (as "+ 1",
    // since React writes the "+" and the "1" separately, hence the comparison without spaces).
    // Checked for up to a second, not once: a long form can take a while to redraw. A button redrawn as a
    // new element is found again by its id.
    const want = norm(pick.text);
    const bare = (s) => s.replace(/\s+/g, '');
    // A text box that shows its own value (Oracle's) still holds what was typed if the pick didn't take,
    // and that can read like the option, so there a pick counts only once the list has closed.
    const typedBox = d.typed && d.box === d.el && d.el.tagName === 'INPUT';
    const took = () => {
      if (d.box === d.el && !d.el.isConnected && d.el.id) { const n = byId(d.el, d.el.id); if (n) d.el = d.box = n; }
      if (typedBox && list && list.isConnected && isVisible(list)) return false;
      const shown = shownText(d);
      return !looksEmpty(shown) && (shown.includes(want.slice(0, 24)) || (bare(shown).length >= 2 && bare(want).includes(bare(shown))));
    };
    if (await waitFor(took, 1000)) {
      try { d.el.blur(); } catch (_) { /* ignore */ }
      await waitClosed(list);
      return { text: pick.text };
    }
    closeDropdown(d);
    await waitClosed(list);
    return { options: optionTexts(options), retry: true };
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

  // Radio buttons drawn as buttons ("pills"): Oracle asks Yes/No and multiple-choice questions as
  // <ul role="radiogroup" aria-label="the question"> with <button role="radio" aria-checked> choices,
  // sponsorship and work authorization among them. Answered like any radio group; a pick counts once
  // the page marks the button checked.
  async function fillPillGroup(group, p, counters, stats) {
    const pills = () => [...group.querySelectorAll('[role="radio"]')].filter((b) => b.tagName !== 'INPUT');
    const list = pills();
    if (!list.length || !isVisible(group) || group.hasAttribute(MARK)) return;
    const raw = groupQuestion(list, group);
    const options = list.map((b, i) => ({ el: b, i, text: (b.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), val: null }));
    const on = options.find((o) => o.el.getAttribute('aria-checked') === 'true');
    if (on) { notePrefilled(stats, raw, on.text); return; } // never overwrite
    const q = norm(raw);
    const res = q ? answerFor(p, groupAsk(q, options), [], list[0], 'radio', counters) : null;
    const pick = res && pickOption(options, res);
    if (pick) {
      press(pick.el);
      const took = await waitFor(() => { const b = pills()[pick.i]; return b && b.getAttribute('aria-checked') === 'true'; }, 1000);
      if (took) { noteFilled(group, stats, raw, pick.text); return; }
    }
    noteLeft(group, stats, raw, 'radio', { options: optionTexts(options), required: isRequired(list[0], raw) });
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
    // saved: how many saved answers the extension has. Claude adds new ones to profile.json, which reaches the
    // extension only when you restore it from that backup; the count in the report shows when that was missed.
    const stats = { filled: 0, left: 0, resume: null, fields: [], prefilled: [], todo: [], tidied: [], saved: (p.savedAnswers || []).length };
    const counters = Object.create(null);
    let roles = 0; // Workday work descriptions seen so far, for "Work Experience N" in the report
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
      // React-Select adds a hidden copy of each required dropdown (aria-hidden, opacity 0) so the browser's
      // own "required" check works. Nobody fills it, but counting it listed every Greenhouse dropdown twice
      // in the report, once as an unlabeled "Select..." text box.
      // Oracle puts a hidden copy beside each text area (aria-hidden, to size it); same treatment.
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.getAttribute('aria-hidden') === 'true') continue;
      if (tag === 'INPUT' && el.getAttribute('data-uxi-widget-type') === 'selectinput') { noteSearchList(el, stats); continue; }

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
      // so what has to be visible is the box around it. Oracle's street box is a combobox that only
      // suggests addresses and takes any text, so it's typed into like a text box.
      const combo = tag === 'INPUT' && !el.classList.contains('cx-select-input--auto-suggest') && (el.getAttribute('role') === 'combobox'
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
      const role = kind === 'textarea' && ROLE_DESCRIPTION.test(el.id) ? ++roles : 0;
      if (role && hasValue(el) && tidyRoleDescription(el, raw, role, stats)) continue;
      if (hasValue(el)) { // never overwrite (Workday's copied work descriptions aside, just above)
        notePrefilled(stats, raw, kind === 'select' ? el.options[el.selectedIndex].text : el.value, res && res.rule && res.rule.name ? res.value : null);
        continue;
      }
      // hasValue: some boxes throw away what they don't accept (Workday's compensation box kept nothing of
      // "Flexible"), and those were reported as Filled with an empty value.
      // A box that changes the number is undone and left: a digits-only GPA box turned "4.0" into "40" (Bass Pro).
      if (res && apply(el, kind, res) && hasValue(el) && !lostDecimal(el, res)) {
        noteFilled(el, stats, raw, kind === 'select' ? el.options[el.selectedIndex].text : el.value, res.nearest ? res.value : null);
      } else {
        const options = kind === 'select' ? optionTexts([...el.options].map((o) => ({ text: o.text, val: o.value }))) : null;
        noteLeft(el, stats, entryLabel(el, raw), kind === 'select' ? 'dropdown' : kind, { options, required: isRequired(el, raw) });
      }
    }

    for (const radios of groups.values()) fillRadioGroup(radios, p, counters, stats);
    for (const boxes of checkGroups.values()) fillCheckboxGroup(boxes, p, counters, stats);
    for (const g of deepQuery(document, '[role="radiogroup"]')) await fillPillGroup(g, p, counters, stats);

    // Second pass: custom dropdowns, one at a time. Ones with no answer in your profile aren't even opened.
    for (const d of dropdowns) {
      const required = isRequired(d.el, d.raw);
      // The site may have filled it since the first pass: Oracle fills City, County and State from the
      // ZIP code chosen just before. Never overwritten, like any other answer already there.
      const now = d.el.tagName === 'INPUT' ? String(d.el.value || '').trim() : '';
      if (now || !looksEmpty(shownText(d))) { notePrefilled(stats, d.raw, now || shownRaw(d)); continue; }
      if (!d.res) { noteLeft(d.box, stats, d.raw, 'custom dropdown', { required }); continue; }
      let r;
      try { r = await fillDropdown(d); } catch (_) { r = { options: [] }; }
      if (r.text) noteFilled(d.box, stats, d.raw, r.text, d.nearest ? d.res.value : null);
      else noteLeft(d.box, stats, d.raw, 'custom dropdown', { options: r.options, required });
    }
    return stats;
  }

  globalThis.__autointernship = { fill, clear: clearMarks };
})();
