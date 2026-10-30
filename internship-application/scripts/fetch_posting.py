#!/usr/bin/env python3
"""Fetch internship postings from the application sites' public job data, without opening a browser.

Usage:
  python fetch_posting.py URL [URL ...] --out-dir DIR [--tracker tracker.xlsx]
  python fetch_posting.py --jobs jobs.txt --out-dir DIR [--limit N] [--tracker tracker.xlsx]

Supported: Greenhouse (job boards, embedded forms, and company career pages with ?gh_jid=), Ashby, Lever,
Workday (myworkdayjobs.com and myworkdaysite.com), SmartRecruiters and Rippling. On 2026-10-30 they hosted
68% of the open SimplifyJobs internship listings. Anything else, or a lookup that fails, is reported so that
posting can be opened in the browser as before.

For each posting it writes "DIR/NN Company - Role.md" in the job-posting.md format: URL, deadline, location,
pay and posted date, then the description. Where the site publishes its form (Greenhouse, Ashby) it adds the
application questions, leaving out the contact and resume fields the AutoInternship extension fills. Knowing
the questions early means written answers can be drafted, and shown at the checkpoint, before the form opens.

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
                body = r.read().decode('utf-8', 'replace')
                return (r.geturl(), body) if raw else json.loads(body)
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
            raise Failed(f"couldn't connect ({getattr(e, 'reason', e)}). Open it in the browser.")
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


# Fields every application has. The extension fills these, so listing them would only add reading.
STANDARD = re.compile(r'^((preferred |legal |full )?(first |last )?name|e ?mail( address)?|phone( number)?|mobile( phone)?|'
                      r'resume|cv|resume cv|cover letter|(linkedin|github|portfolio|personal website|website|websites|'
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
            'consent': consent, 'form_note': ''}


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
    company, questions, from_url = org.replace('-', ' ').title(), [], True
    try:
        name = (ashby_gql(ASHBY_NAME, {'org': org}).get('organization') or {}).get('name')
        if name:
            company, from_url = name, False
        g = ashby_gql(ASHBY_FORM, {'org': org, 'id': jid})
        for s in ((g.get('jobPosting') or {}).get('applicationForm') or {}).get('sections') or []:
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
            'questions': [q for q in questions if q], 'self_id': [], 'consent': [], 'form_note': ''}


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
    return None, None


SITES = {'greenhouse': greenhouse, 'ashby': ashby, 'lever': lever, 'workday': workday,
         'smartrecruiters': smartrecruiters, 'rippling': rippling}


def as_markdown(url, site, p):
    lines = [f"# {p['role']} — {p['company']}", f'- URL: {url}', f"- Deadline: {p['deadline'] or 'none listed'}",
             f"- Location: {p['location'] or 'not listed'}", f"- Pay: {p['pay'] or 'not listed in the job data (check the description)'}",
             f"- Posted: {p['posted'] or 'not listed'}",
             f"- Fetched {dt.date.today().isoformat()} from {site.title()}'s public job data"
             + (' (company name from the link: check it against the description)' if p.get('company_from_url') else ''),
             '', '## Description', '', p['description'] or '(empty: open the posting in the browser)']
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
    a = ap.parse_args()

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
            path = os.path.join(a.out_dir, file_name(n, p))
            with open(path, 'w', encoding='utf-8') as f:
                f.write(as_markdown(url, site, p))
            item.update({'ok': True, 'company': p['company'], 'role': p['role'], 'location': p['location'], 'deadline': p['deadline'],
                         'pay': p['pay'], 'posted': p['posted'], 'file': path, 'questions': len(p['questions']),
                         'written': [q['label'][:120] for q in p['questions'] if q['kind'] == 'text box']})
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
        results.append(item)

    failed = sum(1 for r in results if not r['ok'])
    out = {'ok': not failed, 'fetched': len(results) - failed, 'need_browser': failed, 'postings': results}
    if tracker_note:
        out['tracker_note'] = tracker_note
    print(json.dumps(out, indent=1, ensure_ascii=False, default=str))
    return 2 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
