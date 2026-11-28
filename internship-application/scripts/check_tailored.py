#!/usr/bin/env python3
"""Run every check on a tailored resume in one go and print only what needs attention.

Usage:
  python check_tailored.py TAILORED --master MASTER --name "Full Name" [--posting job-posting.md] [--profile profile.json]
         (--out NAME.pdf for a .tex copy | --pdf CONVERTED.pdf for a .docx copy) [--expect TEXT ...] [--check-template]

TAILORED is the tailored source in scratch space (.tex or .docx). In order, it runs:
  1. build_resume.py (a .tex copy only): one page, readable text, empty lines at the bottom. If the page runs
     over, it stops here and reports only how much to cut, because every other result changes after trimming.
  2. compare_bullets.py: how many bullets are still word for word, any with no source in the master, and entries
     left with one bullet (under "fix").
  3. check_resume.py --resume: numbers and terms that aren't in the master or profile, lost contact details.
  4. ats_check.py: parse problems and the posting's keywords.
  5. Renders page 1 to a PNG beside the PDF, to look at once before saving.
  --check-template also builds a copy of the master with no page limit (in the system temp folder) and checks
  its template for ATS problems. Do it the first time in a session.

Why one command: running the four scripts one by one took five tool calls per try, and each printed every bullet
and keyword again, though only the problems change what to do next. The full before -> after pairs go into
changes.md itself (NAME-changes.md beside the PDF), in its final format with <...> slots for the parts only Claude
can write, so they're never retyped. The posting's keyword lists are printed under "keywords" for those slots.

Prints one JSON object: "fix" (change before saving), "review" (change each one, or say why not in changes.md),
short numbers per check, and the paths of the PDF, the page image and the changes file. The four scripts still work on
their own. Exit codes: 0 nothing to fix or review, 2 something under fix or review, or the page is too long,
1 bad input or compile error, 3 no LaTeX here (the source checks still ran; compile in Overleaf).
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_resume import page_count  # a .docx copy's PDF isn't built here, so count its pages directly


def run_script(name, *args):
    """Run one of the scripts beside this one and return (exit code, its JSON result)."""
    env = dict(os.environ, PYTHONIOENCODING='utf-8')  # they print non-ASCII (→, ligatures); keep it readable
    r = subprocess.run([sys.executable, os.path.join(HERE, name), *args], capture_output=True,
                       encoding='utf-8', errors='replace', env=env)
    try:
        return r.returncode, json.loads(r.stdout)
    except json.JSONDecodeError:
        return 1, {'ok': False, 'error': f'{name} gave no result: {(r.stderr or r.stdout).strip()[-400:]}'}


def render_page1(pdf):
    """Page 1 as a PNG beside the PDF. 80 dpi is enough to judge the layout and keeps the image small to view."""
    base = os.path.splitext(pdf)[0] + '-page1'
    if shutil.which('pdftoppm'):
        subprocess.run(['pdftoppm', '-png', '-r', '80', '-f', '1', '-l', '1', '-singlefile', pdf, base], capture_output=True)
        made = sorted(glob.glob(glob.escape(base) + '*.png'))  # builds without -singlefile add a page number
        if made:
            return made[0]
    try:
        import pdfplumber
        with pdfplumber.open(pdf) as doc:
            doc.pages[0].to_image(resolution=80).save(base + '.png')
        return base + '.png'
    except Exception:
        return None


def short(s, n=90):
    s = ' '.join(str(s).split())
    return s if len(s) <= n else s[:n - 1].rstrip() + '…'


def listing(items, n=15):
    shown = ', '.join(items[:n])
    return shown + (f' (+{len(items) - n} more)' if len(items) > n else '')


def posting_title(posting):
    """'Role at Company' from job-posting.md, whose first line fetch_posting.py writes as '# Role — Company'."""
    try:
        with open(posting, encoding='utf-8') as f:
            m = re.match(r'#\s+(.+?)\s+—\s+(.+?)\s*$', f.readline())
        if m:
            return f'{m.group(1)} at {m.group(2)}'
    except (OSError, TypeError):
        pass
    return '<Role> at <Company>'


def write_changes(path, bullets, page, posting):
    """changes.md with everything a script can fill in, and <...> slots for what only Claude can write.

    Claude used to read a draft of the pairs and keywords and retype all of it into changes.md (2-3k output tokens
    per resume, the priciest kind). Now it copies this file into the job folder and edits only the slots: Angle,
    What changed, Requirements covered, ATS keywords, Gaps, and the reason on the Page line when lines are left free.
    """
    free = (page or {}).get('free_lines')
    if free is None:
        page_line = '- Page: <filled to the bottom, or N lines free because nothing else in the master fits this posting>.'
    elif free < 2:  # the build's own threshold for "space at the bottom"
        page_line = '- Page: filled to the bottom.'
    else:
        page_line = f'- Page: {free} lines free, because <nothing else in the master fits this posting>.'
    lines = [f'# Tailoring notes: {posting_title(posting)}', '',
             '## Angle', '<the three to five things this posting judges on, in its own words>', '',
             '## What changed',
             '- Coursework: led with <courses> (posting asks for <requirement>).',
             '- Projects: moved <project> to the top; dropped <project> for space.',
             '- Experience: kept <entries>; cut <entry> to <N> bullets (or dropped it), because <reason>.',
             '- Skills: put <tools> first.',
             page_line, '', '## Reworded']
    pairs = []
    for b in bullets or []:
        if b['verdict'] == 'reworded':
            pairs.append(f"- {b['closest_master']} → {b['tailored']}")
        elif b['verdict'] == 'merged':
            pairs.append(f"- {b['closest_master']} + {b['also_from']} → {b['tailored']}")
    lines += pairs or ['- none: every bullet is word for word from the master.']
    orphans = [b['tailored'] for b in bullets or [] if b['verdict'] == 'no_source']
    if orphans:
        lines += ['', '## No source in the master (trace every fact, or the bullet goes)'] + [f'- {t}' for t in orphans]
    # The keyword lines stay slots: the raw lists (printed by the check) mix skills with form, benefits and place
    # words ("CA", "Townsend St", "Greenhouse"), and replacing a raw line with Edit would mean retyping all of it.
    lines += ['', '## Requirements covered', '- <requirement>: <where it shows on the resume>', '',
              '## ATS keywords', '- Covered: <posting skills and terms the page shows>', '- Gaps: <posting skills the user doesn\'t have>',
              '', '## Gaps',
              '- <requirement>: not on the resume. One way to address it: <cover letter line, interview example, a short project or course>.']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def check_template(master, name):
    """ATS problems in the master's own template, which tailoring can't fix. Built in the system temp folder."""
    tmp = tempfile.mkdtemp(prefix='master-check-')
    try:
        code, build = run_script('build_resume.py', master, '--out', os.path.join(tmp, 'master.pdf'), '--max-pages', '0')
        if code != 0:
            return [f"Couldn't build the master to check its template: {build.get('error') or build.get('code') or 'compile error'}."]
        _, ats = run_script('ats_check.py', build['pdf'], '--name', name, '--tex', master)
        return ats.get('problems', [])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def done(result, code):
    print(json.dumps(result, indent=1, ensure_ascii=False))
    return code


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('tailored')
    ap.add_argument('--master', required=True)
    ap.add_argument('--name', required=True)
    ap.add_argument('--posting')
    ap.add_argument('--profile')
    ap.add_argument('--out', help='where the built PDF goes (a .tex copy)')
    ap.add_argument('--pdf', help='the PDF converted from a .docx copy')
    ap.add_argument('--expect', action='append', default=[], help='more text that must be readable in the PDF')
    ap.add_argument('--check-template', action='store_true')
    a = ap.parse_args()

    kind = os.path.splitext(a.tailored)[1].lower()
    for p in [a.tailored, a.master, a.posting, a.profile, a.pdf]:
        if p and not os.path.isfile(p):
            return done({'ok': False, 'error': f'not found: {p}'}, 1)
    if kind == '.tex' and not a.out:
        return done({'ok': False, 'error': 'a .tex copy needs --out (where the built PDF goes)'}, 1)
    if kind == '.docx' and not a.pdf:
        return done({'ok': False, 'error': 'a .docx copy needs --pdf (the PDF you converted it to)'}, 1)
    if kind not in ('.tex', '.docx'):
        return done({'ok': False, 'error': 'TAILORED must be the .tex or .docx source, not the PDF'}, 1)

    fix, review, result = [], [], {}
    no_latex = False
    pdf = None

    # 1. The page
    if kind == '.tex':
        expects = ['--expect', a.name, '--expect', 'Education'] + [x for e in a.expect for x in ('--expect', e)]
        code, build = run_script('build_resume.py', a.tailored, '--out', a.out, '--max-pages', '1', *expects)
        if code == 1:
            return done({'ok': False, 'step': 'build', **{k: build[k] for k in ('error', 'errors', 'suspect_lines', 'hints') if k in build}}, 1)
        if code == 2:
            return done({'ok': False, 'step': 'build', 'pages': build.get('pages'), 'lines_over': build.get('lines_over'),
                         'fix': build.get('warnings', [])}, 2)
        if code == 3:
            no_latex = True
        else:
            pdf = build['pdf']
            result['page'] = {k: build.get(k) for k in ('pages', 'free_lines', 'margins_in', 'smallest_text_pt')}
            free = build.get('free_lines')
            if free is not None and free >= 2:
                # A judgment call (the master may have nothing else that fits). Shorter than the build's own warning,
                # which repeats what SKILL.md and tailoring.md already say on every run.
                review.append(f'About {free} lines are empty at the bottom: add about that many from the master ("Filling the page" '
                              'in tailoring.md), or say why not on the Page line in changes.md.')
            for w in build.get('warnings', []):
                if 'empty at the bottom' in w:
                    continue
                # "Could not measure" means look by eye; everything else the build warns about has to change.
                (review if w.startswith('Could not') else fix).append(w)
            if build.get('missing_text'):
                fix.append('Not readable in the PDF\'s text: ' + ', '.join(build['missing_text']) + '. The text layer is broken, '
                           'so tracking systems won\'t read it: for pdflatex, add \\input{glyphtounicode} and \\pdfgentounicode=1.')
    else:
        pdf = a.pdf
        pages = page_count(pdf)
        result['page'] = {'pages': pages}
        if pages and pages > 1:
            return done({'ok': False, 'step': 'page', 'pages': pages,
                         'fix': [f'{pages} pages. Cut to one, following the trim order in tailoring.md, convert again and rerun.']}, 2)

    # 2. Bullets against the master
    _, cmp_ = run_script('compare_bullets.py', a.master, a.tailored)
    bullets = cmp_.get('bullets')
    if 'error' in cmp_:
        review.append(f"Bullet comparison didn't run: {cmp_['error']}")
    else:
        result['bullets'] = {k: cmp_[k] for k in ('tailored_bullets', 'unchanged', 'reworded', 'merged', 'no_source', 'unchanged_share')}
        result['bullets']['one_bullet_entries'] = len(cmp_.get('lone_bullets', []))
        for line in cmp_['advice']:
            # An entry with one bullet is a must-change: tailoring.md's written minimum alone was explained away
            # ("the page is full") on most versions.
            (fix if line.startswith('One bullet under: ') else review).append(line)
        if cmp_['unchanged_share'] > 0.5:
            same = [short(b['tailored'], 60) for b in bullets if b['verdict'] == 'unchanged']
            review.append('Word for word: ' + ('all of them' if len(same) == len(bullets) else
                                               ' | '.join(same[:10]) + (f' (+{len(same) - 10} more)' if len(same) > 10 else '')))
        orphans = [short(b['tailored']) for b in bullets if b['verdict'] == 'no_source']
        if orphans:
            review.append('No source: ' + ' | '.join(orphans))

    # 3. Facts against the master and profile (the PDF when there is one, since that's what recruiters get)
    known = ['--known', a.profile] if a.profile else []
    _, facts = run_script('check_resume.py', a.master, pdf or a.tailored, *known, '--resume')
    if 'error' in facts:
        review.append(f"Fact-check didn't run: {facts['error']}")
    else:
        if facts['new_numbers']:
            review.append('Numbers not in the master or profile: ' + ', '.join(facts['new_numbers']) + '. Each must come from the master, or it goes.')
        if facts['new_terms']:
            review.append('Terms not in the master: ' + ', '.join(facts['new_terms']) + '. Keep one only as the posting\'s word for '
                          'something the master shows (list it under Reworded); remove a tool, number or duty the master doesn\'t have.')
        # check_resume.py counts every LinkedIn and GitHub link in the master as contact, so a project's repo or
        # LinkedIn post ("LinkedIn launch post") goes missing whenever that project is cut. That's fine; only the
        # user's own email, phone and profile links (linkedin.com/in/<name>, github.com/<name>) must stay.
        repos = [c for c in facts['missing_contact']
                 if re.match(r'(linkedin|github)\.com/', c) and not re.match(r'(linkedin\.com/in|github\.com)/[^/]+/?$', c)]
        contact = [c for c in facts['missing_contact'] if c not in repos]
        if contact:
            fix.append('Contact details lost: ' + ', '.join(contact) + '. Keep them exactly as in the master.')
        if repos:
            review.append('Project links not on this page: ' + ', '.join(repos) + '. Fine if you cut those projects; otherwise put them back.')
        if facts['placeholders']:
            fix.append('Leftover placeholders: ' + ', '.join(facts['placeholders']) + '.')

    # 4. How an applicant tracking system reads the PDF
    keywords = None
    if pdf:
        args = [pdf, '--name', a.name, '--master', a.master] + (['--tex', a.tailored] if kind == '.tex' else [])
        _, ats = run_script('ats_check.py', *args, *(['--posting', a.posting] if a.posting else []))
        if 'error' in ats:
            review.append(f"ATS check didn't run: {ats['error']}")
        else:
            fix += ats['problems']
            review += ats['notes']
            keywords = ats.get('keywords')
            if keywords:
                # The raw lists, for the ATS keywords lines in changes.md (skills only; the lists include form words)
                result['keywords'] = {'covered': keywords['in_resume'], 'gaps': keywords['not_in_master']}
                if keywords['in_master_not_resume']:
                    review.append('In the master but not on this page (bring back the ones that matter, where they fit): '
                                  + listing(keywords['in_master_not_resume'], 40))

    if a.check_template:
        if os.path.splitext(a.master)[1].lower() == '.tex' and not no_latex:
            problems = check_template(a.master, a.name)
            result['template_problems'] = problems
            if problems:
                review.append('The master\'s own template has ATS problems (' + '; '.join(problems) + '). Tailoring can\'t fix them: '
                              'tell the user once and suggest fixing the template in Overleaf.')
        else:
            result['template_problems'] = 'not checked (needs a .tex master and LaTeX here)'

    # 5. Files to look at
    stem = os.path.splitext(pdf or a.out)[0]
    result['changes'] = stem + '-changes.md'
    write_changes(result['changes'], bullets, result.get('page'), a.posting)
    if pdf:
        result['pdf'] = pdf
        result['image'] = render_page1(pdf)
        if not result['image']:
            review.append('Couldn\'t render the page (needs pdftoppm or pdfplumber). Render page 1 another way and look at it.')

    ok = not fix and not review and not no_latex  # without LaTeX the PDF itself was never checked
    out = {'ok': ok, 'fix': fix, 'review': review, **result}
    if no_latex:
        out['no_latex'] = 'No LaTeX engine here. The bullet and fact checks ran on the .tex; compile it in Overleaf (overleaf.md, exit 3).'
        return done(out, 3)
    return done(out, 0 if ok else 2)


if __name__ == '__main__':
    sys.exit(main())
