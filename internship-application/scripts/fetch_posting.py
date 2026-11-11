#!/usr/bin/env python3
"""Fetch internship postings from the application sites' public job data, without opening a browser.

Usage:
  python fetch_posting.py URL [URL ...] --out-dir DIR [--tracker tracker.xlsx] [--profile profile.json]
  python fetch_posting.py --jobs jobs.txt --out-dir DIR [--limit N] [--tracker tracker.xlsx] [--profile profile.json [--move-skips]]

Supported: Greenhouse (job boards, embedded forms, and company career pages with ?gh_jid=), Ashby, Lever,
Workday (myworkdayjobs.com and myworkdaysite.com), SmartRecruiters, Rippling and Oracle (oraclecloud.com). On
2026-10-30 the first six hosted 68% of the open SimplifyJobs internship listings; Oracle had 5.8% on 2026-11-07.
Added 2026-11-08, when a third of the queue was on other sites: iCIMS, Atlassian's own job list (its iCIMS links
often answer 410), Amazon, TikTok and ByteDance pages, and any page with a schema.org JobPosting (Meta, Jibe,
Eightfold, Paylocity). Anything else, or a lookup that fails, is reported so that posting can be opened in the
browser as before. LinkedIn is never read.

--profile screens each posting against the user's status, degree and availableFrom before anyone tailors for it:
"skip" when it plainly rules the user out (excludes F-1 students or temporary visas, no CPT or OPT, permanent work
authorization, citizenship, U.S. person status or a clearance the user can't have, a graduate-only role for an
undergraduate, a set start date before availableFrom), "check" for
wording a person should judge, else "ok", with the sentences behind it. Sponsorship alone never skips: below
senior year it doesn't stop an application (SKILL.md step 2). --move-skips (with --jobs) moves skipped lines
below "# done" with the reason, so no batch picks them again. Batch 2026-11-08 spent $2.41 of $17.76 on four
tailoring agents for postings that were then skipped.

For each posting it writes "DIR/NN Company - Role.md" in the job-posting.md format: URL, deadline, location,
pay and posted date, then the description. Where the site publishes its form (Greenhouse, Ashby) it adds the
application questions, leaving out the contact and resume fields the AutoInternship extension fills. Knowing
the questions early means written answers can be drafted, and shown at the checkpoint, before the form opens.

Each posting also gets a "Cover letter:" line and a "cover_letter" value, so the tailoring agent knows whether
to write one before the form is open: required or optional (a form field), asked (the description asks for
one), not wanted (the description says not to send one), none (the published form has no field for one; also
Workday, whose forms usually have none) or unknown (the site doesn't publish its form). The user wants a letter
wherever there's a place for one, optional fields included. Until 2026-11-10 the cover-letter field was dropped
here as a standard field, so no agent knew a form had one, and almost no letters were written.

--tracker adds the tracker rows for the same company (and flags the same posting link), so the duplicate check
needs no separate call. --jobs reads the links above the "# done" line, ignoring the notes after "#".

Why: opening a posting in the browser and reading the page costs several tool calls and a page of menus and
scripts each time. This is one call for the whole queue, and the result is plain text.

Prints one JSON object with a short summary per posting. Exit codes: 0 all fetched, 2 some need the browser
(see each one's "error"), 1 bad input.
"""
import argparse
import datetime as dt
import html
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


class Failed(Exception):
    """A posting this script can't fetch; the message says why and what to do instead."""


class Blocked(Failed):
    """This computer's network refused the site. Cowork's sandbox reaches only the sites it's allowed, and its
    proxy answers the rest with "Tunnel connection failed: 403 Forbidden"; until 2026-11-04 that read as a plain
    connection error, so every posting silently went through the browser instead."""

    def __init__(self, host):
        self.host = host
        super().__init__(f"this computer's network doesn't allow {host}. Open it in the browser.")


# What to allow so every supported site works (see the "hint" in the output). Workday adds one host per company.
ALLOW = ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards-api.greenhouse.io', 'jobs.ashbyhq.com', 'api.ashbyhq.com',
         'api.lever.co', 'api.smartrecruiters.com', 'ats.rippling.com', '*.myworkdayjobs.com', '*.myworkdaysite.com', '*.oraclecloud.com',
         '*.icims.com', 'www.atlassian.com', 'www.amazon.jobs', 'lifeattiktok.com', 'jobs.bytedance.com', 'www.metacareers.com']


# Being a polite client is what keeps these lookups from being blocked: say what we are, never send more than
# one request a second to a site, and when a site says "too many requests", wait once and then give up (the
# posting falls back to the browser) instead of retrying in a loop.
USER_AGENT = 'Mozilla/5.0 (compatible; AutoInternship job-search script; reads public job postings)'
GAP_SECONDS = 1.0
_last_request = {}  # site -> when we last asked it


def get(url, data=None, headers=None, raw=False):
    host = urllib.parse.urlparse(url).netloc
    req = urllib.request.Request(url, data=data, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json',
                                                          **(headers or {})})
    for attempt in (1, 2):
        wait = _last_request.get(host, -GAP_SECONDS) + GAP_SECONDS - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request[host] = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                try:
                    data = r.read()
                except http.client.IncompleteRead as e:  # lifeattiktok.com sometimes closes after sending the whole page
                    data = e.partial
                body = data.decode('utf-8', 'replace')
                return (r.geturl(), body) if raw else json.loads(body)
        except http.client.HTTPException as e:
            raise Failed(f"the site's answer broke off ({type(e).__name__}). Open it in the browser.")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt == 1:
                after = e.headers.get('Retry-After', '')
                time.sleep(min(int(after) if after.isdigit() else 5, 10))
                continue
            if e.code in (404, 410):
                raise Failed('not found: the posting may have closed. Open it in the browser to check.')
            if e.code in (429, 503):
                raise Failed('the site is limiting requests right now. Open it in the browser, or try again later.')
            if e.code in (401, 403):
                raise Failed('the site refused the lookup (some sites block scripts). Open it in the browser.')
            raise Failed(f'the site answered {e.code}. Open it in the browser.')
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            reason = getattr(e, 'reason', e)
            if 'tunnel connection failed' in str(reason).lower():
                raise Blocked(host)
            raise Failed(f"couldn't connect ({reason}). Open it in the browser.")
        except json.JSONDecodeError:
            raise Failed("the site's job data wasn't readable. Open it in the browser.")


def md(fragment):
    """Job-description HTML as plain markdown: headings, bullets and paragraphs, nothing else."""
    if not fragment:
        return ''
    s = fragment
    if '&lt;' in s and '<' not in s:  # Greenhouse sends its HTML escaped
        s = html.unescape(s)
    s = re.sub(r'(?is)<(script|style)\b.*?</\1>', '', s)
    s = re.sub(r'(?i)</?(span|font|u|em|i|a)\b[^>]*>', '', s)
    s = re.sub(r'(?is)(<li[^>]*>)\s*<p[^>]*>(.*?)</p>', r'\1\2', s)
    s = re.sub(r'(?is)<h[1-6][^>]*>(.*?)</h[1-6]>', lambda m: '\n### ' + m.group(1) + '\n', s)
    # In most postings a paragraph that is only bold text is a section heading.
    s = re.sub(r'(?is)<(p|div)[^>]*>\s*<(strong|b)\b[^>]*>([^<]*)</\2>\s*(?:<br\s*/?>)?\s*</\1>',
               lambda m: '\n### ' + m.group(3) + '\n', s)
    s = re.sub(r'(?i)<li[^>]*>', '\n- ', s)
    s = re.sub(r'(?i)<br\s*/?>|</?(p|div|ul|ol|li|tr|table|section|body|blockquote|h[1-6])\b[^>]*>', '\n', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s)).replace('\xa0', ' ')
    out = []
    for line in s.split('\n'):
        line = re.sub(r'[ \t]+', ' ', line).strip()
        if re.fullmatch(r'#+:?|###\s*', line):
            continue
        if out and out[-1] == '-' and line:  # "- " followed by the bullet's text on the next line
            out[-1] = '- ' + line
            continue
        if line.startswith('- ') and len(out) >= 2 and out[-1] == '' and out[-2].startswith('- '):
            out.pop()  # no blank line between bullets of the same list
        if line or (out and out[-1]):
            out.append(line)
    return '\n'.join(out).strip()


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def day(value):
    """A date as YYYY-MM-DD from an ISO string or epoch milliseconds."""
    if value in (None, ''):
        return ''
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).strftime('%Y-%m-%d')
    return str(value)[:10]


def money(n, currency='USD'):
    n = round(float(n), 2)
    text = f'{n:,.0f}' if n == int(n) else f'{n:,.2f}'
    return f'${text}' if currency == 'USD' else f'{text} {currency}'


# Fields every application has. The extension fills these, so listing them would only add reading. The cover
# letter isn't one of them: the extension never attaches it, and Claude writes one for it (cover_letter() below).
STANDARD = re.compile(r'^((preferred |legal |full )?(first |last )?name|e ?mail( address)?|phone( number)?|mobile( phone)?|'
                      r'resume|cv|resume cv|(linkedin|github|portfolio|personal website|website|websites|'
                      r'other website)( profile| url| link)?|(other |additional )?links?|location( city)?|city|current location)$')


def question(label, required, kind, options=None):
    if not label or STANDARD.match(norm(label)):
        return None
    return {'label': ' '.join(str(label).split()), 'required': bool(required), 'kind': kind, 'options': options or []}


# ---- one function per site, each returning the same dict ----

def greenhouse(p):
    board = p['board']
    if not board:
        # Embedded and company-site links carry only the job's id. Greenhouse's own embed page redirects to a
        # link that names the board ("...?for=coinbase&token=...").
        try:
            final, page = get(f"https://boards.greenhouse.io/embed/job_app?token={p['id']}", raw=True, headers={'Accept': 'text/html'})
        except Blocked:
            raise
        except Failed:
            raise Failed("this company's Greenhouse board isn't public, so the posting can't be looked up from this link. "
                         'Open it in the browser.')
        board = (urllib.parse.parse_qs(urllib.parse.urlparse(final).query).get('for') or [None])[0]
        if not board:
            m = re.search(r'urlToken":"([^"]+)"', page)
            board = m and m.group(1)
        if not board:
            raise Failed("couldn't tell which company's Greenhouse board this is. Open it in the browser.")
    d = get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{p['id']}?questions=true&pay_transparency=true")
    pay, blurbs = [], []
    for r in d.get('pay_input_ranges') or []:
        lo, hi = r.get('min_cents'), r.get('max_cents')
        if lo is not None:
            amount = money(lo / 100, r.get('currency_type', 'USD')) + ('' if hi in (None, lo) else ' to ' + money(hi / 100, r.get('currency_type', 'USD')))
            title = (r.get('title') or '').strip().rstrip(':')
            pay.append(amount + (f' ({title})' if title and len(title) <= 30 else ''))  # some titles are whole sentences
        if r.get('blurb'):
            blurbs.append(md(r['blurb']))
    questions = []
    for q in (d.get('questions') or []) + (d.get('location_questions') or []):
        fields = q.get('fields') or []
        types = [f.get('type') for f in fields]
        if not types or all(t == 'input_hidden' for t in types):
            continue
        options = [v.get('label') for f in fields for v in f.get('values') or []]
        kind = ('choose any' if 'multi_value_multi_select' in types else 'choice' if 'multi_value_single_select' in types
                else 'file' if 'input_file' in types else 'text box' if 'textarea' in types else 'text')
        questions.append(question(q.get('label'), q.get('required'), kind, options))
    self_id = [q.get('label') for c in d.get('compliance') or [] for q in c.get('questions') or []]
    demo = d.get('demographic_questions') or {}
    self_id += [q.get('label') for q in (demo.get('questions') if isinstance(demo, dict) else demo) or [] if isinstance(q, dict)]
    consent = [c.get('type', '').upper() for c in d.get('data_compliance') or []
               if c.get('requires_consent') or c.get('requires_processing_consent')]
    description = md(d.get('content')) + ''.join('\n\n### Pay\n' + b for b in blurbs[:1])
    return {'company': d.get('company_name') or board, 'role': d.get('title'), 'location': (d.get('location') or {}).get('name'),
            'deadline': day(d.get('application_deadline')), 'pay': '; '.join(pay), 'posted': day(d.get('first_published') or d.get('updated_at')),
            'description': description, 'questions': [q for q in questions if q], 'self_id': [s for s in self_id if s],
            'consent': consent, 'form_note': '', 'form_read': True}


_ashby_boards = {}  # one board download per company per run, however many of its postings are queued

# Ashby allows one top-level field per request, so the name and the form are two requests.
ASHBY_NAME = '''query Q($org: String!) {
  organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $org) { name } }'''
ASHBY_FORM = '''query Q($org: String!, $id: String!) {
  jobPosting(organizationHostedJobsPageName: $org, jobPostingId: $id) {
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { isRequired field } } } } } }'''


def ashby_gql(query, variables):
    return get('https://jobs.ashbyhq.com/api/non-user-graphql?op=Q', headers={'Content-Type': 'application/json'},
               data=json.dumps({'operationName': 'Q', 'variables': variables, 'query': query}).encode())['data']
ASHBY_KIND = {'String': 'text', 'LongText': 'text box', 'Email': 'text', 'Phone': 'text', 'File': 'file', 'Boolean': 'yes/no',
              'ValueSelect': 'choice', 'MultiValueSelect': 'choose any', 'Date': 'date', 'Number': 'number', 'Location': 'location'}


def ashby(p):
    org, jid = p['org'], p['id']
    if org.lower() not in _ashby_boards:
        _ashby_boards[org.lower()] = get(f'https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true').get('jobs', [])
    j = next((x for x in _ashby_boards[org.lower()] if x.get('id') == jid), None)
    if not j:
        raise Failed('not on the company\'s public job board: the posting may have closed. Open it in the browser to check.')
    # The documented posting API has no company name or form. Ashby's own job pages get both from this endpoint;
    # if it ever changes, the posting still comes through, with the name taken from the link.
    company, questions, from_url, form_read = org.replace('-', ' ').title(), [], True, False
    try:
        name = (ashby_gql(ASHBY_NAME, {'org': org}).get('organization') or {}).get('name')
        if name:
            company, from_url = name, False
        g = ashby_gql(ASHBY_FORM, {'org': org, 'id': jid})
        sections = ((g.get('jobPosting') or {}).get('applicationForm') or {}).get('sections') or []
        form_read = bool(sections)  # a failed or empty form lookup must not read as "no cover-letter field"
        for s in sections:
            for e in s.get('fieldEntries') or []:
                f = e.get('field') or {}
                options = [v.get('label') for v in f.get('selectableValues') or []]
                questions.append(question(f.get('title'), e.get('isRequired'), ASHBY_KIND.get(f.get('type'), str(f.get('type', '')).lower()), options))
    except (Failed, KeyError, TypeError, AttributeError):
        pass
    comp = j.get('compensation') or {}
    locations = [j.get('location')] + [x.get('location') for x in j.get('secondaryLocations') or []]
    return {'company': company, 'company_from_url': from_url, 'role': j.get('title'),
            'location': '; '.join(l for l in locations if l) + (f" ({j['workplaceType']})" if j.get('workplaceType') else ''),
            'deadline': '', 'pay': comp.get('compensationTierSummary') or comp.get('scrapeableCompensationSalarySummary') or '',
            'posted': day(j.get('publishedAt')), 'description': md(j.get('descriptionHtml')) or j.get('descriptionPlain', ''),
            'questions': [q for q in questions if q], 'self_id': [], 'consent': [], 'form_note': '', 'form_read': form_read}


def lever(p):
    d = get(f"https://{p['api']}/v0/postings/{p['company']}/{p['id']}")
    cats = d.get('categories') or {}
    s = d.get('salaryRange') or {}
    pay = ''
    if s.get('min') is not None:
        pay = money(s['min'], s.get('currency', 'USD')) + ('' if s.get('max') in (None, s['min']) else ' to ' + money(s['max'], s.get('currency', 'USD')))
        pay += f" {s.get('interval', '').replace('-', ' ')}".rstrip()
    parts = [md(d.get('description'))] + [f"### {l.get('text', '')}\n{md(l.get('content'))}" for l in d.get('lists') or []] + [md(d.get('additional'))]
    return {'company': p['company'].replace('-', ' ').title(), 'company_from_url': True, 'role': d.get('text'),
            'location': ' / '.join(cats.get('allLocations') or [cats.get('location') or '']) + (f" ({d['workplaceType']})" if d.get('workplaceType') else ''),
            'deadline': '', 'pay': pay, 'posted': day(d.get('createdAt')), 'description': '\n\n'.join(x for x in parts if x),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


CORP_SUFFIX = r',?\s+(inc|incorporated|llc|ltd|limited|corp|corporation|plc|lp|llp|gmbh|ag|sa|nv|bv)\.?$'


def tidy_company(name):
    """Workday's company names often carry an internal code ("0101 The Huntington National Bank", "DQQ Cohesity Inc.")."""
    words = (name or '').split()
    while len(words) >= 3 and re.fullmatch(r'\d+|[A-Z]{2,4}', words[0]):
        words.pop(0)
    return re.sub(CORP_SUFFIX, '', ' '.join(words), flags=re.I).strip(' ,')


def workday(p):
    d = get(f"https://{p['host']}/wday/cxs/{p['tenant']}/{p['site']}/job/{p['rest']}")
    i = d.get('jobPostingInfo') or {}
    if not i:
        raise Failed('not found: the posting may have closed. Open it in the browser to check.')
    locations = [i.get('location')] + list(i.get('additionalLocations') or [])
    note = 'Workday shows its application questions only after sign-in, so none are listed here.'
    if i.get('canApply') is False:
        note += ' The site says it is not taking applications for this posting.'
    tenant = p['tenant'].upper() if len(p['tenant']) <= 3 else p['tenant'].title()  # "hp" is HP
    return {'company': tidy_company((d.get('hiringOrganization') or {}).get('name')) or tenant, 'company_from_url': True,
            'role': i.get('title'), 'location': '; '.join(l for l in locations if l) + (f" ({i['timeType']})" if i.get('timeType') else ''),
            'deadline': f"{i['endDate']} (when the posting closes)" if i.get('endDate') else '', 'pay': '',
            'posted': day(i.get('startDate')), 'description': md(i.get('jobDescription')),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': note}


_oracle_sites = {}  # (host, site) -> company name, so a queue with many postings from one site asks once


def oracle_company(p):
    """Oracle's job data has no company name. The career site's page title has it, padded with words like
    "Candidate Experience Site" ("DTCC Candidate Experience Site", "Cummins Talent Acquisition", "Macy\\'s")."""
    key = (p['host'], p['site'])
    if key not in _oracle_sites:
        name = ''
        try:
            _, page = get(f"https://{p['host']}/hcmUI/CandidateExperience/{p['lang']}/sites/{p['site']}/", raw=True, headers={'Accept': 'text/html'})
            m = re.search(r'<title>([^<]*)', page)
            name = html.unescape(m.group(1)).replace("\\'", "'") if m else ''
        except Failed:
            pass
        name = re.sub(r'(?i)^(careers?|jobs?) (at|with) ', '', name.strip())  # "Careers at Northwind"
        name = re.sub(r'(?i)\s*[-|:]?\s*\b(candidate experience( site| page)?|talent acquisition|career site|careers?( site| page)?|jobs?( search| site)?|'
                      r'external|opportunities|join us)\b.*$', '', name).strip(' -|:')
        name = re.sub(r'(?i)\s+(united states|usa|us|global)$', '', name)
        # Not tidy_company(): its Workday code rule would drop the "GM" of "GM Financial".
        _oracle_sites[key] = re.sub(CORP_SUFFIX, '', name, flags=re.I).strip(' ,')
    return _oracle_sites[key]


def oracle(p):
    d = get(f"https://{p['host']}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true"
            f"&finder=ById;Id=%22{p['id']}%22,siteNumber={p['site']}")
    items = d.get('items') or []
    if not items:
        raise Failed('not found: the posting may have closed. Open it in the browser to check.')
    i = items[0]
    locations = [i.get('PrimaryLocation')] + [l.get('Name') for l in i.get('secondaryLocations') or [] if isinstance(l, dict)]
    how = '; '.join(x for x in (i.get('WorkplaceType'), i.get('JobSchedule')) if x)
    parts = [md(i.get('ExternalDescriptionStr'))]
    parts += [f'### {title}\n{md(i.get(key))}' for key, title in (('ExternalResponsibilitiesStr', 'Responsibilities'), ('ExternalQualificationsStr', 'Qualifications'),
                                                                 ('CorporateDescriptionStr', 'About the company')) if i.get(key)]
    return {'company': oracle_company(p) or p['host'].split('.')[0], 'company_from_url': True, 'role': i.get('Title'),
            'location': '; '.join(l for l in locations if l) + (f' ({how})' if how else ''),
            'deadline': f"{day(i['ExternalPostedEndDate'])} (when the posting closes)" if i.get('ExternalPostedEndDate') else '', 'pay': '',
            'posted': day(i.get('ExternalPostedStartDate')), 'description': '\n\n'.join(x for x in parts if x),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': 'Oracle shows its application questions only in the form, so none are listed here.'}


def smartrecruiters(p):
    d = get(f"https://api.smartrecruiters.com/v1/companies/{p['company']}/postings/{p['id']}")
    loc = d.get('location') or {}
    where = loc.get('fullLocation') or ', '.join(x for x in (loc.get('city'), loc.get('region')) if x)
    where += ' (remote)' if loc.get('remote') else ' (hybrid)' if loc.get('hybrid') else ''
    sections = ((d.get('jobAd') or {}).get('sections') or {})
    parts = [f"### {sec.get('title') or key}\n{md(sec.get('text'))}" for key in ('companyDescription', 'jobDescription', 'qualifications', 'additionalInformation')
             for sec in [sections.get(key) or {}] if sec.get('text')]
    return {'company': (d.get('company') or {}).get('name') or p['company'], 'role': d.get('name'), 'location': where,
            'deadline': '', 'pay': '', 'posted': day(d.get('releasedDate')), 'description': '\n\n'.join(parts),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def rippling(p):
    # Rippling has no public job API, but each posting page carries its data as JSON for the page's own script.
    final, page = get(p['url'], raw=True, headers={'Accept': 'text/html'})
    if 'job_not_found' in final:  # a closed posting redirects to the company's job list
        raise Failed('not found: the posting may have closed. Open it in the browser to check.')
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    try:
        j = json.loads(m.group(1))['props']['pageProps']['apiData']['jobPost']
    except (AttributeError, KeyError, TypeError, json.JSONDecodeError):
        raise Failed("couldn't read this Rippling page's job data. Open it in the browser.")
    pay = []
    for r in j.get('payRangeDetails') or []:
        if r.get('rangeStart') is None:
            continue
        amount = money(r['rangeStart'], r.get('currency', 'USD')) + ('' if r.get('rangeEnd') in (None, r['rangeStart']) else ' to ' + money(r['rangeEnd'], r.get('currency', 'USD')))
        amount += f" per {r['frequency'].lower()}" if r.get('frequency') else ''
        if amount not in pay:
            pay.append(amount)
    desc = j.get('description')
    description = '\n\n'.join(md(v) for v in desc.values() if isinstance(v, str)) if isinstance(desc, dict) else md(desc)
    return {'company': j.get('companyName') or p['board'], 'role': j.get('name'), 'location': '; '.join(j.get('workLocations') or []),
            'deadline': '', 'pay': '; '.join(pay), 'posted': day(j.get('createdOn')), 'description': description,
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def page(url):
    final, body = get(url, raw=True, headers={'Accept': 'text/html'})
    return final, body


def json_ld_posting(body):
    """The schema.org JobPosting that many career sites put in their pages for search engines (Meta, iCIMS, Jibe,
    Eightfold, Paylocity on 2026-11-08), or None."""
    for m in re.finditer(r'(?is)<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', body):
        raw = m.group(1).strip()
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            try:
                d = json.loads(html.unescape(raw))
            except json.JSONDecodeError:
                continue
        stack = [d]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                kind = x.get('@type')
                if kind == 'JobPosting' or (isinstance(kind, list) and 'JobPosting' in kind):
                    return x
                if x.get('@graph'):
                    stack.append(x['@graph'])
    return None


def ld_text(v):
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return '\n'.join(ld_text(x) for x in v)
    if isinstance(v, dict):
        return ld_text(v.get('description') or v.get('name') or '')
    return ''


def ld_place(loc):
    if isinstance(loc, str):
        return loc
    a = ((loc or {}).get('address') or {}) if isinstance(loc, dict) else {}
    if isinstance(a, str):
        return a
    country = a.get('addressCountry')
    country = country.get('name') if isinstance(country, dict) else country
    return ', '.join(str(x) for x in (a.get('addressLocality'), a.get('addressRegion'), country) if x)


def from_json_ld(j, url):
    org = j.get('hiringOrganization')
    company = re.sub(CORP_SUFFIX, '', html.unescape(str((org.get('name') if isinstance(org, dict) else org) or '')).strip(), flags=re.I).strip(' ,')
    locs = j.get('jobLocation') or []
    places = [ld_place(l) for l in (locs if isinstance(locs, list) else [locs])]
    if 'TELECOMMUTE' in str(j.get('jobLocationType', '')).upper():
        places.append('Remote')
    pay = ''
    s = j.get('baseSalary') or {}
    v = s.get('value') if isinstance(s, dict) else None
    if isinstance(v, dict) and (v.get('minValue') or v.get('value')):
        lo = v.get('minValue') or v.get('value')
        hi = v.get('maxValue')
        try:
            pay = money(lo, s.get('currency', 'USD')) + ('' if hi in (None, lo) else ' to ' + money(hi, s.get('currency', 'USD')))
            pay += f" per {str(v['unitText']).lower()}" if v.get('unitText') else ''
        except (TypeError, ValueError):
            pay = ''
    parts = [html.unescape(md(ld_text(j.get('description'))))]  # some pages escape their job data twice ("&#xa;")
    for key, title in (('responsibilities', 'Responsibilities'), ('qualifications', 'Qualifications'),
                       ('educationRequirements', 'Education'), ('experienceRequirements', 'Experience')):
        text = html.unescape(md(ld_text(j.get(key))))
        if text and text not in parts[0]:
            parts.append(f'### {title}\n{text}')
    host = urllib.parse.urlparse(url).netloc.lower().removeprefix('www.')
    return {'company': company or host.split('.')[0].title(), 'company_from_url': not company, 'role': html.unescape(str(j.get('title') or '')),
            'location': '; '.join(dict.fromkeys(p for p in places if p)), 'deadline': f"{day(j['validThrough'])} (when the posting closes)" if j.get('validThrough') else '',
            'pay': pay, 'posted': day(j.get('datePosted')), 'description': '\n\n'.join(x for x in parts if x),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def other(p):
    """A site without a reader of its own: its page's JobPosting data, if it has one."""
    final, body = page(p['url'])
    j = json_ld_posting(body)
    if not j:
        raise Failed('not a site with public job data here. Open it in the browser.')
    return from_json_ld(j, final)


_atlassian = []  # Atlassian's whole job list, downloaded once per run


def atlassian(p):
    # Atlassian's iCIMS links often answer 410 Gone, while its own careers site lists the same job by the same id.
    if not _atlassian:
        _atlassian.extend(get('https://www.atlassian.com/endpoint/careers/listings'))
    j = next((x for x in _atlassian if str(x.get('id')) == p['id']), None)
    if not j:
        raise Failed("not on Atlassian's job list: the posting may have closed. Open it in the browser to check.")
    places = [', '.join(re.split(r'\s+-\s+', l.strip())[:2]) for l in j.get('locations') or []]
    parts = [md(j.get('overview'))] + [f'### {t}\n{md(j.get(k))}' for k, t in (('responsibilities', 'Responsibilities'), ('qualifications', 'Qualifications')) if j.get(k)]
    return {'company': 'Atlassian', 'role': j.get('title'), 'location': '; '.join(places), 'deadline': '', 'pay': '',
            'posted': day((j.get('portalJobPost') or {}).get('updatedDate')), 'description': '\n\n'.join(x for x in parts if x),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def icims(p):
    # The job page with in_iframe=1 is the posting without the company's site around it, with its JobPosting data.
    final, body = page(f"https://{p['host']}/jobs/{p['id']}/job?in_iframe=1")
    j = json_ld_posting(body)
    if not j:
        raise Failed("couldn't read this iCIMS page's job data (the posting may have closed). Open it in the browser.")
    return from_json_ld(j, final)


def section_text(chunk):
    return md(re.sub(r'(?i)<br\s*/?>', '\n', chunk))


def amazon(p):
    _, body = page(f"https://www.amazon.jobs/en/jobs/{p['id']}")
    title = re.search(r'(?is)<h1[^>]*>(.*?)</h1>', body)
    if not title:
        raise Failed("couldn't read this Amazon page. Open it in the browser.")
    heads = list(re.finditer(r'(?is)<h2[^>]*>(.*?)</h2>', body))
    parts = []
    for i, h in enumerate(heads):
        name = html.unescape(re.sub(r'<[^>]+>', '', h.group(1))).strip()
        if name.lower() in ('job details', 'share this job'):
            continue
        end = heads[i + 1].start() if i + 1 < len(heads) else len(body)
        parts.append(f'### {name}\n{section_text(body[h.end():end])}')
    loc = re.search(r'(?is)location-icon.*?<ul class="association-content">(.*?)</ul>', body)
    places = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'(?is)<li>(.*?)</li>', loc.group(1))] if loc else []
    return {'company': 'Amazon', 'role': html.unescape(re.sub(r'<[^>]+>', '', title.group(1))).strip(), 'location': '; '.join(places),
            'deadline': '', 'pay': '', 'posted': '', 'description': '\n\n'.join(parts),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def bytedance(p):
    """TikTok's and ByteDance's career sites (one system): the page is rendered with its sections."""
    _, body = page(p['url'])
    title = re.search(r'(?is)<title>(.*?)</title>', body)
    sections = re.findall(r'(?is)<p class="text-\[3\dpx\][^"]*"[^>]*>(.*?)</p>\s*<p[^>]*>(.*?)</p>', body)
    if not title or not sections:
        raise Failed("couldn't read this careers page. Open it in the browser.")
    text = re.sub(r'(\s*\|\s*)+', ' | ', html.unescape(re.sub(r'<[^>]+>', ' | ', re.sub(r'(?is)<(script|style)\b.*?</\1>', '', body))))
    loc = re.search(r'\|\s*Location\s*\|\s*:\s*\|\s*([^|]+)', text)
    pay = re.search(r'(The (hourly|annual|monthly)[^|]{0,80}?range for this position[^|]*?\$[\d,.]+\s*-\s*\$[\d,.]+)', text)
    parts = [f"### {html.unescape(re.sub(r'<[^>]+>', '', h)).strip()}\n{section_text(c)}" for h, c in sections
             if 'job information' not in h.lower()]
    return {'company': p['company'], 'role': html.unescape(title.group(1)).strip(), 'location': loc.group(1).strip() if loc else '',
            'deadline': '', 'pay': pay.group(1) if pay else '', 'posted': '', 'description': '\n\n'.join(parts),
            'questions': [], 'self_id': [], 'consent': [], 'form_note': ''}


def parse(url):
    """Which site a link is on, and the ids its public data needs. (None, None) when it isn't supported."""
    u = urllib.parse.urlparse(url.strip())
    host, path = u.netloc.lower(), u.path
    q = urllib.parse.parse_qs(u.query)
    if host.endswith('greenhouse.io') or 'gh_jid' in q:
        if '.eu.' in host:
            return 'greenhouse', None  # EU boards have no public job API
        m = re.match(r'/([^/]+)/jobs/(\d+)', path)
        if host.endswith('greenhouse.io') and m and m.group(1) != 'embed':
            return 'greenhouse', {'board': m.group(1), 'id': m.group(2)}
        jid = (q.get('token') or q.get('gh_jid') or [None])[0]
        if jid and jid.isdigit():
            return 'greenhouse', {'board': (q.get('for') or [None])[0], 'id': jid}
        return 'greenhouse', None
    uuid = r'([0-9a-fA-F-]{36})'
    if host == 'jobs.ashbyhq.com':
        m = re.match(r'/([^/]+)/' + uuid, path)
        return 'ashby', m and {'org': urllib.parse.unquote(m.group(1)), 'id': m.group(2).lower()}
    if host in ('jobs.lever.co', 'jobs.eu.lever.co'):
        m = re.match(r'/([^/]+)/' + uuid, path)
        return 'lever', m and {'company': m.group(1), 'id': m.group(2), 'api': 'api.eu.lever.co' if '.eu.' in host else 'api.lever.co'}
    if host.endswith('.myworkdayjobs.com') or host.endswith('.myworkdaysite.com'):
        if host.endswith('.myworkdaysite.com'):
            m = re.match(r'/(?:[a-z]{2}-[A-Z]{2}/)?recruiting/([^/]+)/([^/]+)/job/(.+?)/?(?:/apply.*)?$', path)
            ids = m and {'host': host, 'tenant': m.group(1), 'site': m.group(2), 'rest': m.group(3)}
        else:
            m = re.match(r'/(?:[a-z]{2}-[A-Z]{2}/)?([^/]+)/job/(.+?)/?(?:/apply.*)?$', path)
            ids = m and {'host': host, 'tenant': host.split('.')[0], 'site': m.group(1), 'rest': m.group(2)}
        return 'workday', ids
    if host in ('jobs.smartrecruiters.com', 'careers.smartrecruiters.com'):
        m = re.match(r'/([^/]+)/(\d+)', path)
        return 'smartrecruiters', m and {'company': m.group(1), 'id': m.group(2)}
    if host == 'ats.rippling.com':
        m = re.match(r'/(?:[a-z]{2}-[A-Z]{2}/)?([^/]+)/jobs/' + uuid, path)
        return 'rippling', m and {'board': m.group(1), 'url': url.strip()}
    if host.endswith('.oraclecloud.com'):
        m = re.match(r'/hcmUI/CandidateExperience/([^/]+)/sites/([^/]+)/(?:job|requisitions/preview)/(\d+)', path)
        return 'oracle', m and {'host': host, 'lang': m.group(1), 'site': m.group(2), 'id': m.group(3)}
    bare = host.removeprefix('www.')
    if bare == 'atlassian.com' or (host.endswith('.icims.com') and (host in ATLASSIAN_ICIMS or 'atlassian' in host)):
        m = re.search(r'/(?:jobs|careers/details)/(\d+)', path)
        return 'atlassian', m and {'id': m.group(1)}
    if host.endswith('.icims.com'):
        m = re.match(r'/jobs/(\d+)', path)
        return 'icims', m and {'host': host, 'id': m.group(1)}
    if bare == 'amazon.jobs':
        m = re.match(r'/(?:[a-z]{2}(?:-[a-z]{2})?/)?jobs/(\d+)', path)
        return 'amazon', m and {'id': m.group(1)}
    if bare in ('lifeattiktok.com', 'careers.tiktok.com', 'jobs.bytedance.com', 'joinbytedance.com'):
        return 'bytedance', {'url': url.strip(), 'company': 'ByteDance' if 'bytedance' in bare else 'TikTok'}
    if 'linkedin.com' in host:
        return None, None  # never read LinkedIn (SKILL.md)
    return 'other', {'url': url.strip()}


# Atlassian's iCIMS sites, from the portal links in its own job list (2026-11-08)
ATLASSIAN_ICIMS = {'careers-americas.icims.com', 'campus-americas.icims.com'}

SITES = {'greenhouse': greenhouse, 'ashby': ashby, 'lever': lever, 'workday': workday,
         'smartrecruiters': smartrecruiters, 'rippling': rippling, 'oracle': oracle, 'atlassian': atlassian,
         'icims': icims, 'amazon': amazon, 'bytedance': bytedance, 'other': other}


# ---- eligibility screen: the posting's own words against the profile, before anyone tailors for it ----

# The patterns below run on a sentence in lower case with the dots of abbreviations dropped ("U.S." is "us",
# "Ph.D." is "ph.d", "B.S." is "bs"), so a window like [^.]{0,40} isn't cut short by "U.S.".
REQUIRE = re.compile(r'\b(must|required?|requires|requirement|mandatory|only|need(s|ed)? to|necessary|condition of|eligible|eligibility)\b')
NOT_REQUIRED = re.compile(r'\b(not|no)\b (be )?(required|necessary|needed|a requirement)\b')
# EEO statements list citizenship among the traits an employer ignores; those sentences rule no one out.
EEO = re.compile(r'\b(without regard|regardless of|discriminat\w*|equal (employment )?opportunity|race|religion|protected (veteran|class|status)|affirmative action|'
                 r'citizenship and immigration services|e-verify)\b')
# "Must be a U.S. citizen, permanent resident, or authorized to work in the U.S." lets in anyone allowed to work.
OR_AUTHORIZED = re.compile(r'\bor\b[^.]{0,40}\b(authori[sz]ed|eligible) to work\b|\bor (have|possess|hold) (valid |current )?(us )?work authori[sz]ation\b'
                           r'|\btemporary residents?\b')  # "hires U.S. citizens, permanent residents, refugees, and temporary residents"
CITIZEN = re.compile(r'\b(us|united states|american) citizen(ship|s)?\b')
PERMANENT = re.compile(r'\b(permanent residen\w*|green card|lawful permanent|lpr)\b')
US_PERSON = re.compile(r'\bus persons?\b|\bitar\b')
CLEARANCE = re.compile(r'\b(security|secret|top secret|ts\s?/\s?sci|dod|government|federal|public trust)\b[^.]{0,30}\bclearance\b'
                       r'|\bclearance\b[^.]{0,30}\b(polygraph|ts\s?/\s?sci|secret|top secret|public trust)\b')
NO_CLEARANCE = re.compile(r'\bclearance\b[^.]{0,40}:\s*none\b|\bnone required\b')
MAYBE = re.compile(r'\b(prefer\w*|a plus|desir\w*|nice to have|bonus|ideal\w*)\b')
VISA = re.compile(r'\b(f-?1|j-?1)\b')
# F-1 and J-1 are temporary (nonimmigrant) visas: "Individuals with temporary visas or who need sponsorship now or
# in the future are not eligible for hire" (DriveTime) turns away an F-1 student without naming F-1.
TEMP_VISA = re.compile(r'\b(temporary|nonimmigrant|non-immigrant) (work )?visas?\b')
VISA_BAR = [
    re.compile(r'\b(not|in)\s?eligible\b[^.]{0,60}\b(f-?1|j-?1|student visas?|international students?|visa holders?|(temporary|nonimmigrant|non-immigrant) visas?)\b'),
    re.compile(r'\b(f-?1|j-?1)\b[^.]{0,160}\b(not eligible|ineligible|are not|cannot|will not|won\'t|not be considered)\b'),
    re.compile(r'\b(temporary|nonimmigrant|non-immigrant) (work )?visas?\b[^.]{0,160}\b(not eligible|ineligible|not be considered)\b'),
    re.compile(r'\bnot (open|available)\b[^.]{0,40}\b(f-?1|j-?1|student visas?|international students?|visa holders?|(temporary|nonimmigrant|non-immigrant) visas?)\b'),
    re.compile(r'\b(not|cannot|unable to|won\'t|will not)\b[^.]{0,20}\b(hire|interview|employ|consider|accept)\b[^.]{0,80}\b(f-?1|j-?1|(temporary|nonimmigrant|non-immigrant) visas?)\b'),
]
# "F-1 visa holders with OPT who will require H-1B status ... will not be considered" is about OPT, after graduation.
OPT_HOLDERS = re.compile(r'\b(with|on|using)\s+(optional practical training|opt)\b')
# "...without sponsorship for employment visa status (e.g., H1B, TN, CPT, OPT)" counts CPT as sponsorship it won't support.
NO_SUPPORT = re.compile(r'\b(without|not require|no|not|unable to|cannot|won\'t|will not|does not)\b[^.]{0,80}\b(sponsor\w*|visa support|immigration support)\b')
# "This includes, but is not limited to: F1-OPT, F1-CPT, H-1B" continues the sentence before it.
FUTURE_WORDS = re.compile(r'\b(future|would need|will need|later|within (a|the next) (few )?years?|eventually|continued)\b')
INCLUDES = re.compile(r'^(this|these|that|which) (includes?|applies to)\b|^(includes?|including)\b|\bbut (is )?not limited to\b')
LABELLED = re.compile(r'^(work authori[sz]ation|citizenship|security clearance|clearance)[^:]{0,20}:')
# "Must be a U.S. person ... or otherwise eligible for an export license", "an offer may depend on an export license"
LICENSED = re.compile(r'\bor\b[^.]{0,60}\blicen[cs]e|\b(subject to|depend\w* on|contingent (on|upon)|obtain\w*|require\w*|need\w*) (an? )?(us )?(export|government)?\s*(control )?licen[cs]e')
EXPORT_ACCESS = re.compile(r'\baccess\b[^.]{0,80}\bexport.?control|\bexport.?controlled\b[^.]{0,40}\baccess\b')
# These two keep the case: "OPT" and "CPT" in capitals, so "opt in" doesn't count.
# Only CPT counts: an intern works on CPT, and OPT (STEM OPT, Form I-983) comes after graduation, like sponsorship.
NO_TRAINING = re.compile(r'\b([Nn]ot|[Uu]nable to|[Cc]annot|[Cc]an ?not|[Ww]on\'?t|[Ww]ill not|[Dd]oes not|[Dd]o not|[Dd]oesn\'?t|[Dd]on\'?t)\b[^.]{0,50}'
                         r'\b(support|accept|sponsor|sign|consider|provide|offer|allow|execute)\w*\b[^.]{0,160}(\bCPT\b|[Cc]urricular [Pp]ractical [Tt]raining)')
TRAINING_NO = re.compile(r'(\bCPT\b|[Cc]urricular [Pp]ractical [Tt]raining)[^.]{0,40}\b(not (be )?(accepted|supported|eligible|available|considered)|ineligible)\b')
# "We don't sponsor, but OPT and CPT students are welcome" is the opposite.
TRAINING_OK = re.compile(r'\b(welcome|encouraged|eligible to apply|can apply|may apply|are accepted|is accepted|we (do )?support|will consider|consider applicants)\b'
                         r'|\b(cpt|opt|f-?1)\b[^.]{0,40}\b(are|is) eligible\b')
# The sentence before "This includes ... F1-CPT": "Wellmark is not considering applicants ... that require any type of
# immigration sponsorship", "Work visa sponsorship is not available for this role."
NO_SPONSOR_BEFORE = re.compile(r'\b(not|unable to|cannot|won\'?t|will not|does not|do not)\b[^.]{0,90}\bsponsor'
                               r'|\bsponsor\w*[^.]{0,30}\bnot (be )?(available|offered|provided|possible|supported)\b|without sponsorship|not eligible')
# "Other than verification of employment" is the one document CPT needs, so whether it rules the user out is a judgment.
TRAINING_MAYBE = re.compile(r'\bother than\b|\bexcept\b')
# "Requiring future sponsorship (for example, following F-1 OPT/CPT) are not eligible" is about sponsorship.
FUTURE_SPONSOR = re.compile(r'\bsponsor\w*[^.]{0,80}\b(future|continued|following|extend\w*)\b|\b(future|continued)\b[^.]{0,40}\bsponsor')
SHORT_HEADING = re.compile(r'^[^.]{0,60}:$|^\S+(\s+\S+){0,2}$')
PERMANENT_AUTH = re.compile(r'\bpermanent\b[^.]{0,30}\b(work|employment)\s+authori[sz]ation\b|\bauthori[sz]ed to work permanently\b|\bpermanently authori[sz]ed\b')
PREFERRED_HEAD = re.compile(r'\b(prefer\w*|nice to have|bonus|pluses|desired|ideal\w*)\b', re.I)
HEADING_WORDS = re.compile(r'\b(qualifications?|requirements?|skills|about|what you|who you|you will|you\'ll|we\'re looking|we are looking|'
                           r'responsibilit\w*|benefits|nice to have|bonus|preferred|minimum|basic|required|desired|eligibility|education)\b', re.I)
UNRESTRICTED = re.compile(r'\b(unrestricted|without (any )?restrictions?)\b[^.]{0,40}\b(right to work|work authori[sz]ation)\b')
NO_SPONSOR = re.compile(r'\b(not|unable to|cannot|won\'?t|will not|does not|do not)\b[^.]{0,40}\bsponsor')
GRAD_ONLY = re.compile(r'\b(ph\.?\s?d|doctoral|doctorate|master[\'’]?s|mba|graduate (degree|program|student)s?)\b')
UNDERGRAD = re.compile(r'\b(bachelor\w*|undergrad\w*|bs|ba|bsc|beng|bachelors|baccalaureate|freshm[ae]n|sophomores?|juniors?|seniors?)\b'
                       r'|\b(college|university)\b[^.]{0,20}\bor (an? )?(master|ph\.?d|graduate|doctoral)')
ENROLLED = re.compile(r'\b(enrolled|pursuing|in the process of obtaining|working towards?|candidates?|students?)\b')
# Kept whole when splitting sentences: "U.S.", "e.g.", "Ph.D.", "Inc."
ABBREV = re.compile(r'(?:\b[A-Za-z]\.){2,}|\b(?:e\.g|i\.e|etc|inc|ltd|vs|incl|approx|ph\.d|no)\.', re.I)


def undotted(s):
    return re.sub(r'\b([A-Za-z])\.', r'\1', s)


def user_status(prof):
    """What the screen needs from profile.json: citizen (True/False/None), permanent resident, visa, degree, below senior."""
    sys.path.insert(0, HERE)
    from find_internships import below_senior, degree_level  # same readings as the queue search
    # profile.json has no citizenship field of its own (autointernship/shared.js defaults()); a visa in workAuthDetails,
    # or needing sponsorship, means not a citizen or permanent resident, as find_internships.py reads it too.
    cz, auth = norm(prof.get('citizenship')), norm(prof.get('workAuthDetails'))
    visa = re.search(r'\b(f ?1|j ?1|h ?1 ?b|opt|cpt|tn|visa)\b', auth)
    if cz:
        citizen = cz in ('united states', 'usa', 'us', 'united states of america', 'american')
    elif visa or prof.get('needsSponsorship') == 'yes':
        citizen = False
    else:
        citizen = True if re.search(r'\bu ?s citizen', auth) else None
    degree = prof.get('degree') or ((prof.get('education') or [{}])[0] or {}).get('degree', '')
    term = re.search(r'(summer|fall|winter|spring)\s+(20\d{2})', str(prof.get('internshipTerm', '')), re.I)
    year = int(term.group(2)) if term else dt.date.today().year
    avail = str(prof.get('availableFrom') or '').strip()
    days = dates_in(avail, year)
    return {'citizen': citizen, 'permanent': bool(re.search(r'green card|permanent resident|\blpr\b', auth)),
            'visa': visa.group(0).upper().replace(' ', '-') if visa else '', 'degree': degree_level(degree),
            'below_senior': below_senior(prof, term.group(0) if term else 'Summer 2027'), 'sponsor': prof.get('needsSponsorship') == 'yes',
            # the earliest day the user can start: a month alone ("June 2027") means its first day
            'available_from': days[0][2] if days else None, 'available_text': avail, 'year': days[0][2].year if days else year,
            'season': term.group(1).lower() if term else None}


MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
# "May 17", "May 17, 2027", "June 2027", "in May"; "6/1/2027" only with a year ("24/7", "3/5 days" aren't dates).
# A month name without a day or year counts only after a word that puts a date there, since "may" is also a verb.
DATE_WORDS = re.compile(r'\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|'
                        r'nov(?:ember)?|dec(?:ember)?)\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?\b)?(?:,?\s+(20\d{2}))?\b'
                        r'|\b(\d{1,2})/(\d{1,2})/(20\d{2})\b', re.I)
MONTH_ONLY_AFTER = re.compile(r'\b(in|on|of|from|by|early|mid|late|beginning|end|starting|beginning in|through|until)\s*-?\s*$')
# "May/June", "May or June", "June and July": a month right after another date in a list
MONTH_LISTED = re.compile(r'(\/|\b(or|and|to|through)\s+((early|mid|late)\s*-?\s*)?)$')


def dates_in(text, year):
    """(start, end, first day, last day) of each date in the text. A month alone spans the whole month."""
    import calendar
    out = []
    for m in DATE_WORDS.finditer(text):
        if m.group(4):
            mo, day, yr = int(m.group(4)), int(m.group(5)), int(m.group(6))
        else:
            mo = MONTH_ABBR.index(m.group(1)[:3].lower()) + 1
            day, yr = (int(m.group(2)) if m.group(2) else None), (int(m.group(3)) if m.group(3) else year)
            before = text[:m.start()]
            listed = out and m.start() - out[-1][1] <= 14 and MONTH_LISTED.search(before)
            if day is None and not m.group(3) and not MONTH_ONLY_AFTER.search(before) and not listed:
                continue
            if not m.group(3):
                # "May/June 2027": the year after the list belongs to every month in it
                later = re.match(r'\s*(\/|or|and|to|through|-|–)\s*[a-z]+\.?(\s+\d{1,2}\w*)?,?\s+(20\d{2})', text[m.end():])
                yr = int(later.group(3)) if later else yr
        if not 1 <= mo <= 12:
            continue
        last = calendar.monthrange(yr, mo)[1]
        if day is not None and not 1 <= day <= last:
            continue
        out.append((m.start(), m.end(), dt.date(yr, mo, day or 1), dt.date(yr, mo, day or last)))
    return out


# A start date the posting sets: "must be available to start on May 17", "the program runs from May 26 to August 14",
# "Internship program begins Monday, May 24, 2027". Not dates about applying, interviews, graduation or offers.
START_WORDS = re.compile(r'\b(start(s|ing)?|begin(s|ning)?|commenc(e|es|ing)|kicks? off|first day|report(ing)? date|runs from|'
                         r'(program|internship|cohort) (runs|dates?|period|will run|takes place)|available (from|beginning))\b')
NOT_START = re.compile(r'\b(appl(y|ied|ying|ications?)|deadline|posted|interview\w*|clos(e|es|ing)|review(ed|ing)?|graduat\w*|offers?|'
                       r'decisions?|notif\w*|submi\w*|recruit\w*|career fair|info(rmation)? sessions?|webinars?|events?|salary|pay)\b')
# "Interns may start as early as May 18" or "June 1 or later" sets no limit on a later start.
START_ANY_LATER = re.compile(r'\b(as early as|or later|or after|no earlier than|at the earliest)\b')
START_HEDGE = re.compile(r'\b(typically|usually|generally|normally|tentative\w*|approximately|approx|around|roughly|flexib\w*|prefer\w*|'
                         r'ideally|may|might|expected|estimated|anticipated|tbd|subject to change|or later|later start|var(y|ies)|depending|negotiable)\b')


def early_start(low, st):
    """'skip' or 'check' when the sentence sets a start date before the user's availableFrom, else None. Every start
    date it offers has to be too early ("June 1 or June 15" with June 10 is fine); in a range, only the first counts."""
    first = st.get('available_from')
    if not first or NOT_START.search(low) or START_ANY_LATER.search(low):
        return None
    # A line about another term in a posting that lists several ("Winter (Starts January/February 2027)")
    seasons = set(re.findall(r'\b(winter|spring|summer|fall|autumn)\b', low))
    if seasons and st.get('season') and st['season'] not in seasons:
        return None
    word = START_WORDS.search(low)
    if not word:
        return None
    found = [d for d in dates_in(low, st['year']) if d[0] >= word.start()]
    if not found:
        return None
    # Other start dates offered: "May 24th and June 14th", "May or June", "May/June"; not the end of a range.
    options = [found[0]] + [d for d in found[1:] if re.search(r'(\/|\b(or|and)\s+((early|mid|late)\s*-?\s*|the (beginning|end) of\s+)?)$', low[:d[0]])]
    # "beginning in May-June", "Mid May- Mid June": a short range is a window to start in, not the program's dates
    if len(found) > 1 and re.search(r'(-|–|\bto|\bthrough|\buntil)\s*((early|mid|late)\s*-?\s*)?$', low[:found[1][0]]) \
            and (found[1][2] - found[0][2]).days <= 45:
        options.append(found[1])
    if any(last >= first for _, _, _, last in options):
        return None
    plain = low
    for s, e, _, _ in reversed(dates_in(low, st['year'])):  # "in May" isn't the hedge "may"
        plain = plain[:s] + ' ' + plain[e:]
    return 'check' if START_HEDGE.search(plain) else 'skip'


REQUIRED_HEAD = re.compile(r'\b(required|requirements|minimum|basic|must have|what you need|you must|eligibility)\b', re.I)


def sentences(text):
    """(sentence, under a "Preferred" heading, under a "Required" heading) triples. A heading is a "###" line or a
    short line with no full stop ("Preferred Qualifications", "Minimum Qualifications:"). Lines under a required
    heading are requirements even without "must" ("- U.S. Citizen or Permanent Residency")."""
    out, preferred, required = [], False, False
    for raw in str(text or '').split('\n'):
        line = raw.strip()
        if not line:
            continue
        lead = re.match(r'^(#+\s*)?((?:minimum|basic|required|preferred|desired|additional|bonus)?\s*(?:qualifications|requirements|skills)[^:.]{0,40}:|nice to have:?|preferred:)', line, re.I)
        heading = line.startswith('#') or (not line.startswith(('-', '*')) and len(line) <= 70 and not re.search(r'[.!?]$', line)
                                           and HEADING_WORDS.search(line))
        if lead or heading:
            head = lead.group(0) if lead else line
            preferred = bool(PREFERRED_HEAD.search(head))
            required = not preferred and bool(REQUIRED_HEAD.search(head))
        elif len(line) > 100 and not line.startswith(('-', '*')):
            preferred = required = False  # a paragraph after the list ends it (Amca's ITAR paragraph under "Preferred Skills")
        # The heading line itself isn't one of the requirements under it ("Security Clearance & Other Requirements:").
        under = required and not ((lead and len(line) == len(lead.group(0))) or (heading and not lead))
        line = ABBREV.sub(lambda m: m.group(0).replace('.', '\x00'), re.sub(r'^[\s#*-]+', '', line).strip())
        out += [(s.replace('\x00', '.').strip(), preferred, under) for s in re.split(r'(?<=[.!?;])\s+', line) if s.strip()]
    return out


def screen(p, st):
    """skip, check or ok, with the sentences behind it. skip only for clear cases: the posting excludes the
    user's status, needs a citizenship the user doesn't have, or is a graduate-only role for an undergraduate."""
    hits = []
    not_citizen = st['citizen'] is False
    not_pr = not_citizen and not st['permanent']
    on_visa = bool(st['visa']) and not_pr
    undergrad = st['degree'] in ("Bachelor's", "Associate's")

    title = undotted(p['role'] or '').lower()
    if undergrad and GRAD_ONLY.search(title) and not UNDERGRAD.search(title):
        hits.append(('skip', 'graduate-only role', p['role']))

    prev = ''
    for s, preferred, required in sentences(html.unescape(p['description'] or '')):  # some job data is escaped twice ("&#xa;")
        cased = undotted(s)
        low = cased.lower()
        last, prev = prev, low
        if EEO.search(low):
            continue
        before = len(hits)
        maybe = MAYBE.search(low)
        needed = (REQUIRE.search(low) or required or LABELLED.search(low)) and not NOT_REQUIRED.search(low)
        may = re.search(r'\bmay\b', low)
        if SHORT_HEADING.search(low.strip()) and not (REQUIRE.search(low) or required):
            continue  # a bare heading ("Security Clearance") says nothing yet; the lines under it do
        cpt = re.search(r'\bCPT\b', cased) or 'curricular practical training' in low
        support = NO_SUPPORT.search(low)
        follows = INCLUDES.search(low) and (cpt or VISA.search(low)) and NO_SPONSOR_BEFORE.search(last)
        training = (NO_TRAINING.search(cased) or TRAINING_NO.search(cased) or follows
                    or (cpt and support and support.end() < (cased.find('CPT') if 'CPT' in cased else low.find('curricular'))))
        visa_bar = any(r.search(low) for r in VISA_BAR) and not (OPT_HOLDERS.search(low) and not cpt)
        perm = PERMANENT_AUTH.search(low)
        if on_visa and not maybe and (visa_bar or training) and not TRAINING_OK.search(low):
            # Unsure when the visa is only an example of needing sponsorship later ("requiring future sponsorship
            # (for example, following F-1 OPT/CPT)"), not a status turned away ("temporary visas such as F-1 ... are not eligible").
            first_visa = min([m.start() for m in (VISA.search(low), TEMP_VISA.search(low), re.search(r'\bcpt\b', low)) if m] or [len(low)])
            later = ((FUTURE_SPONSOR.search(low) and -1 < low.find('sponsor') < first_visa)
                     or re.search(r'\b(f-?1|j-?1)( \(student\))?( visas?)?( holders?)? who (will )?(require|need)\b[^.]{0,30}\bsponsor', low)  # "F-1 (student) visa holders who require employer sponsorship in the future"
                     or (follows and FUTURE_WORDS.search(low)))  # "This includes ... CPT ... but would need H-1B sponsorship within a few years"
            hits.append(('check' if TRAINING_MAYBE.search(low) or later else 'skip', f"excludes {st['visa']} students", s))
        elif (on_visa and perm and not NOT_REQUIRED.search(low) and not maybe
              and not re.search(r'sponsor\w*[^.]{0,60}$', low[:perm.start()])):  # "...sponsorship (... or permanent work authorization)"
            hits.append(('skip', 'needs permanent work authorization', s))
        elif CITIZEN.search(low) and needed and not maybe and not OR_AUTHORIZED.search(low):
            either = PERMANENT.search(low) or US_PERSON.search(low)
            if (not_pr if either else not_citizen):
                some = re.search(r'\b(some|certain) (positions|roles|jobs)\b', low)  # "Some positions will require U.S. citizenship"
                hits.append(('check' if may or some else 'skip',
                             'U.S. citizenship or permanent residence required' if either else 'U.S. citizenship required', s))
            elif st['citizen'] is None:
                hits.append(('check', 'citizenship', s))
        elif not_pr and (US_PERSON.search(low) or EXPORT_ACCESS.search(low)):
            # "May involve export-controlled information" or "an offer may depend on an export license" rules no one out;
            # a U.S. person rule with a license as the other way in, or plain export-controlled access, is a judgment.
            person = re.search(r'\bus persons?\b', low)
            if may:
                if person and needed:
                    hits.append(('check', 'export control (U.S. person)', s))
            elif person and needed and not LICENSED.search(low):
                hits.append(('skip', 'U.S. person status required', s))
            elif needed or re.search(r'\b(requires?|will have) access\b', low):
                hits.append(('check', 'export control', s))
        elif CLEARANCE.search(low) and not_citizen and not NOT_REQUIRED.search(low) and not NO_CLEARANCE.search(low):
            soft = maybe or may or 'public trust' in low
            hits.append(('check' if soft else 'skip', 'security clearance', s))
        elif on_visa and UNRESTRICTED.search(low):
            hits.append(('check', 'unrestricted work authorization', s))
        elif (undergrad and ENROLLED.search(low) and GRAD_ONLY.search(low) and not UNDERGRAD.search(low) and not maybe
              and not preferred and not may and not re.search(r'\balso\b', low) and (needed or 'currently' in low)):
            hits.append(('check', 'degree level', s))
        elif st['below_senior'] is False and st['sponsor'] and NO_SPONSOR.search(low):
            hits.append(('check', 'sponsorship', s))
        early = early_start(low, st)
        if early:
            hits.append((early, f"starts before {st['available_text']}", s))
        # Under a "Preferred" heading only a degree line is plainly a preference; an export-control or citizenship
        # paragraph at the end of a posting often has no heading of its own, so it becomes a check, not a skip.
        if preferred and len(hits) > before and hits[-1][0] == 'skip':
            hits[-1] = ('check',) + hits[-1][1:]
    if not hits:
        return 'ok', []
    verdict = 'skip' if any(v == 'skip' for v, _, _ in hits) else 'check'
    why = []
    for v, rule, s in sorted(hits, key=lambda h: h[0] != 'skip'):
        line = f'{rule}: "{s[:200]}"'
        if line not in why:
            why.append(line)
    return verdict, why[:3]


def move_skips(path, skipped):
    """Move queued lines whose posting the screen ruled out to just below '# done', with the reason in the note."""
    lines = open(path, encoding='utf-8-sig').read().splitlines()
    done_at = next((i for i, l in enumerate(lines) if l.strip().lower() == '# done'), len(lines))
    keep, moved = [], []
    for line in lines[:done_at]:
        m = re.match(r'\s*(https?://\S+)', line)
        if m and m.group(1) in skipped:
            moved.append(line.rstrip() + (' | ' if '#' in line[m.end():] else '  # ') + f'skipped: {skipped[m.group(1)]}')
        else:
            keep.append(line)
    if moved:
        while keep and not keep[-1].strip():
            keep.pop()
        with open(path, 'w', encoding='utf-8') as f:  # rewrites jobs.txt in place; nothing is deleted
            f.write('\n'.join(keep + ['', '# done'] + moved + lines[done_at + 1:]) + '\n')
    return len(moved)


COVER = re.compile(r'\bcover ?letters?\b', re.I)
VIDEO_COVER = re.compile(r'\bvideo cover ?letters?\b', re.I)  # a recording, which only the user can make
# "No cover letter required", "cover letters are optional", "feel free to include a cover letter": not required.
COVER_OPTIONAL = re.compile(
    r'\bcover ?letters?\b[^.]{0,30}\b(not|isn\'?t|aren\'?t)\b[^.]{0,12}\b(required|needed|necessary|mandatory)\b'
    r'|\bno cover ?letters?\b[^.]{0,15}\b(required|needed|necessary)\b'
    r'|\b(optional|optionally|may|can|feel free to|welcome to|if you (would like|wish|want|choose))\b[^.]{0,40}\bcover ?letters?\b'
    r'|\bcover ?letters?\b[^.]{0,25}\b(optional|welcome|encouraged)\b', re.I)
# "Please do not send cover letters", "We don't read cover letters", "No cover letters, please."
COVER_UNWANTED = re.compile(
    r'\b(do not|don\'?t|please do not|we do not|we don\'?t|will not|won\'?t|never)\b[^.]{0,30}'
    r'\b(send|submit|include|attach|upload|accept|read|review|consider)\w*\b[^.]{0,25}\bcover ?letters?\b'
    r'|\bcover ?letters?\b[^.]{0,30}\b(will not|won\'?t|are not|aren\'?t|is not|isn\'?t)\b[^.]{0,10}\b(be )?(read|reviewed|considered|accepted)\b'
    r'|\b(in lieu of|instead of|rather than|in place of) (a |an |your )?cover ?letters?\b'
    r'|^no cover ?letters?(,? please)?[.!]?$', re.I)
# Checked first, so "we will not consider applications without a cover letter" and "applications that do not
# include a cover letter will not be considered" aren't read as "don't send one".
COVER_NEEDED = re.compile(
    r'\bwithout (a |an |your )?cover ?letters?\b|\b(do not|don\'?t) forget\b|\bincomplete\b'
    r'|\b(applications?|applicants?|submissions?|candidates?)\b[^.]{0,80}\b(will not|won\'?t|cannot|can\'?t|not) be '
    r'(considered|reviewed|accepted|processed)\b', re.I)
# A field for the letter itself is a short label ("Cover Letter", "Add a file (cover letter, portfolio, etc.)"). A
# question that mentions one ("While we don't require any cover letter ... is there anything else you'd like to
# share?", "In lieu of a cover letter, tell us why") is an ordinary written question.
COVER_NOT_FIELD = re.compile(r'\?|\b(in lieu of|instead of|rather than|in place of)\b|\b(do not|don\'?t|not) require', re.I)


def cover_field(q):
    label = q['label']
    return bool(COVER.search(label)) and not VIDEO_COVER.search(label) and len(label) <= 60 and not COVER_NOT_FIELD.search(label)
# Privacy notices list the cover letter among the data they keep; that isn't a request for one.
COVER_PRIVACY = re.compile(r'\b(we collect|collected|personal (information|data)|privacy|retain\w*|retention|categories of)\b', re.I)


def cover_letter(site, p):
    """(value, the job-posting.md line). A letter can be asked for in a form field, which only the sites that
    publish their forms show (form_read), or in a sentence of the description ("Please identify the role you are
    applying for in your cover letter"), which the letter then has to answer, so that sentence is quoted."""
    field = next((q for q in p['questions'] if cover_field(q)), None)
    said = {'unwanted': [], 'optional': [], 'asked': []}
    for s, _, _ in sentences(p['description']):
        if COVER.search(s) and not VIDEO_COVER.search(s) and not COVER_PRIVACY.search(s):
            kind = ('asked' if COVER_NEEDED.search(s) else 'unwanted' if COVER_UNWANTED.search(s)
                    else 'optional' if COVER_OPTIONAL.search(s) else 'asked')
            said[kind].append(s if len(s) <= 300 else s[:299].rstrip() + '…')
    quote = lambda kind: ' '.join(f'"{s}"' for s in said[kind][:2])
    where = f' (form field "{field["label"]}", {field["kind"]})' if field else ''
    asks = said['asked'] or said['optional']
    also = f"; the posting says: {quote('asked' if said['asked'] else 'optional')}" if asks else ''
    if field and field['required']:
        return 'required', f'required{where}{also}'
    if said['unwanted']:  # the posting's own words win over a field left on the company's standard form
        return 'not wanted', f"not wanted: {quote('unwanted')}"
    if field:
        return 'optional', f'optional{where}{also}'
    if said['asked']:
        return 'asked', f"asked for in the posting: {quote('asked')}"
    if said['optional']:
        return 'optional', f"optional in the posting: {quote('optional')}"
    if site == 'workday':
        return 'none', 'none (Workday forms usually have no field for one)'
    if p.get('form_read'):
        return 'none', "none (the site's form data has no field for one)"
    return 'unknown', "unknown (the site doesn't publish its form)"


SOURCE = {'other': 'the posting page', 'icims': 'the iCIMS posting page', 'amazon': 'the Amazon posting page',
          'bytedance': 'the posting page', 'atlassian': "Atlassian's public job list"}


def as_markdown(url, site, p):
    lines = [f"# {p['role']} — {p['company']}", f'- URL: {url}', f"- Deadline: {p['deadline'] or 'none listed'}",
             f"- Location: {p['location'] or 'not listed'}", f"- Pay: {p['pay'] or 'not listed in the job data (check the description)'}",
             f"- Posted: {p['posted'] or 'not listed'}",
             f"- Fetched {dt.date.today().isoformat()} from {SOURCE.get(site, site.title() + chr(39) + 's public job data')}"
             + (' (company name from the link: check it against the description)' if p.get('company_from_url') else '')]
    if p.get('screen_why'):
        lines.append(f"- Eligibility screen: {p['screen']}: " + '; '.join(p['screen_why']))
    if p.get('cover_line'):
        lines.append(f"- Cover letter: {p['cover_line']}")
    lines += ['', '## Description', '', p['description'] or '(empty: open the posting in the browser)']
    if p['questions'] or p['self_id'] or p['consent'] or p['form_note']:
        lines += ['', '## Application questions', '']
        if p['questions'] or p['self_id'] or p['consent']:
            lines.append("From the site's form data. Contact and resume fields are left out; `*` = required. "
                         'The form may show more questions, or ask some only after earlier answers.')
            lines.append('')
        for q in p['questions']:
            opts = q['options']
            shown = ' | '.join(o for o in opts[:8] if o) + (f' | +{len(opts) - 8} more' if len(opts) > 8 else '')
            lines.append(f"- {q['label']}{'*' if q['required'] else ''} ({q['kind']}{': ' + shown if shown else ''})")
        if p['self_id']:
            lines.append('- Voluntary self-identification: ' + ', '.join(dict.fromkeys(p['self_id'])) + ' (answers come only from the profile)')
        if p['consent']:
            lines.append('- Consent: the form asks for consent to process the application data (' + ', '.join(p['consent']) + ')')
        if p['form_note']:
            lines.append(p['form_note'])
    return '\n'.join(lines) + '\n'


def file_name(n, p):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', f"{n:02d} {p['company']} - {p['role']}")
    return re.sub(r'\s+', ' ', name).strip()[:90].rstrip(' .') + '.md'


def url_key(url):
    """A link reduced to what identifies the posting, so the same posting matches however it was copied."""
    u = urllib.parse.urlparse(str(url or '').strip())
    q = urllib.parse.parse_qs(u.query)
    jid = (q.get('gh_jid') or q.get('token') or [''])[0]
    return (u.netloc.lower().removeprefix('www.') + u.path.rstrip('/').removesuffix('/application').removesuffix('/apply')).lower() + jid


def tracker_rows(path):
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tracker.py'), 'find', path], capture_output=True,
                       encoding='utf-8', errors='replace', env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return None, "couldn't read the tracker; check duplicates with tracker.py find"
    return (d['rows'], None) if d.get('ok') else (None, d.get('error'))


def queue(path):
    urls = []
    for line in open(path, encoding='utf-8-sig'):
        s = line.strip()
        if s.lower() == '# done':
            break
        m = re.match(r'(https?://\S+)', s)
        if m:
            urls.append(m.group(1))
    return urls


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('urls', nargs='*')
    ap.add_argument('--jobs', help='jobs.txt: fetch the links above its "# done" line')
    ap.add_argument('--limit', type=int, help='with --jobs, only the first N links')
    ap.add_argument('--out-dir', required=True, help='where the posting files go (scratch space)')
    ap.add_argument('--tracker', help='tracker.xlsx, to list rows already there for the same company')
    ap.add_argument('--profile', help="profile.json, to screen each posting against the user's status and degree")
    ap.add_argument('--move-skips', action='store_true', help='with --jobs and --profile: move the lines the screen skips below "# done"')
    a = ap.parse_args()
    status = None
    if a.profile:
        try:
            status = user_status(json.load(open(a.profile, encoding='utf-8-sig')))
        except (OSError, ValueError) as e:
            print(json.dumps({'ok': False, 'error': f"couldn't read the profile: {e}"}))
            return 1

    urls = list(a.urls)
    if a.jobs:
        if not os.path.isfile(a.jobs):
            print(json.dumps({'ok': False, 'error': f'not found: {a.jobs}'}))
            return 1
        urls += queue(a.jobs)[:a.limit] if a.limit else queue(a.jobs)
    if not urls:
        print(json.dumps({'ok': False, 'error': 'no links given (pass URLs or --jobs jobs.txt)'}))
        return 1
    os.makedirs(a.out_dir, exist_ok=True)

    rows, tracker_note = (None, None)
    if a.tracker and os.path.isfile(a.tracker):  # never let a lookup create the tracker
        rows, tracker_note = tracker_rows(a.tracker)

    results = []
    blocked = set()
    for n, url in enumerate(urls, 1):
        site, ids = parse(url)
        item = {'url': url, 'site': site or 'other'}
        try:
            if not site:
                raise Failed('not a site with public job data here. Open it in the browser.')
            if not ids:
                raise Failed(f"couldn't read the posting's id from this {site.title()} link. Open it in the browser.")
            p = SITES[site](ids)
            p['company'], p['role'] = ' '.join(str(p['company'] or '').split()), ' '.join(str(p['role'] or '').split())
            if site == 'other' and (not p['role'] or not p['description']):
                raise Failed("the page's job data has no title or description. Open it in the browser.")
            if status:
                p['screen'], p['screen_why'] = screen(p, status)
            p['cover_letter'], p['cover_line'] = cover_letter(site, p)
            path = os.path.join(a.out_dir, file_name(n, p))
            with open(path, 'w', encoding='utf-8') as f:
                f.write(as_markdown(url, site, p))
            item.update({'ok': True, 'company': p['company'], 'role': p['role'], 'location': p['location'], 'deadline': p['deadline'],
                         'pay': p['pay'], 'posted': p['posted'], 'file': path, 'questions': len(p['questions']),
                         'written': [q['label'][:120] for q in p['questions'] if q['kind'] == 'text box' and not cover_field(q)],
                         'cover_letter': p['cover_letter']})
            if status:
                item['screen'] = p['screen']
                if p['screen_why']:
                    item['screen_why'] = p['screen_why']
            if p.get('company_from_url'):
                item['check_company'] = True
            if rows is not None:
                same = [r for r in rows if norm(p['company']) and (norm(p['company']) in norm(r.get('company'))
                                                                   or norm(r.get('company')) in norm(p['company']))]
                key = url_key(url)
                hits = [r for r in rows if url_key(r.get('posting_url')) == key] if key else []
                if same or hits:
                    item['in_tracker'] = [{k: r.get(k) for k in ('id', 'role', 'status', 'date_added')} for r in {r['id']: r for r in same + hits}.values()]
                    item['same_posting_in_tracker'] = bool(hits)
        except Failed as e:
            item.update({'ok': False, 'error': str(e)})
            if isinstance(e, Blocked):
                blocked.add(e.host)
        results.append(item)

    failed = sum(1 for r in results if not r['ok'])
    out = {'ok': not failed, 'fetched': len(results) - failed, 'need_browser': failed}
    if status:
        out['screen'] = {v: sum(1 for r in results if r.get('screen') == v) for v in ('ok', 'check', 'skip')}
        if a.move_skips and a.jobs:
            skipped = {r['url']: r['screen_why'][0].split(':')[0] for r in results if r.get('screen') == 'skip'}
            out['moved_below_done'] = move_skips(a.jobs, skipped) if skipped else 0
    out['postings'] = results
    if blocked:
        # Said once, so the user can fix it in a minute instead of every posting costing a browser read.
        extra = sorted(h for h in blocked if h not in ALLOW and not h.endswith(('.myworkdayjobs.com', '.myworkdaysite.com', '.oraclecloud.com', '.icims.com')))
        out['network_blocked'] = sorted(blocked)
        out['hint'] = ("This computer's network blocks the job sites, so these postings need the browser. To fetch them "
                       "without it, allow these domains in the Claude app's settings for code execution (network access): "
                       + ', '.join(ALLOW + extra) + '. If wildcards (*) aren\'t accepted, add each Workday host instead, '
                       'such as ' + (next((h for h in sorted(blocked) if 'myworkday' in h), 'nvidia.wd5.myworkdayjobs.com')) + '.')
    if tracker_note:
        out['tracker_note'] = tracker_note
    print(json.dumps(out, indent=1, ensure_ascii=False, default=str))
    return 2 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
