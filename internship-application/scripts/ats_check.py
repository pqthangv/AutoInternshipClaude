#!/usr/bin/env python3
"""Check that a resume PDF reads cleanly in applicant tracking systems (ATS), and which of the
posting's keywords it covers.

Usage:
  python ats_check.py RESUME.pdf --name "Full Name" [--tex TAILORED.tex] [--posting job-posting.md] [--master MASTER.tex|.docx|.pdf]

Parse checks (these can make an ATS misread the resume), reported under "checks":
  - name_near_top: the name is in the first lines of extracted text (not an image or page header)
  - ligatures: characters like "ﬁ" that break keyword matching ("eﬃcient" doesn't match "efficient")
  - run_together: words with the spaces lost between them
  - two_column: text on both sides of the page, which many ATS read across, mixing the columns
  - fonts_embedded: false if some fonts aren't embedded (needs pdffonts; true when it isn't installed)
  - nonstandard_headings: section titles an ATS may not recognize (from --tex); a note, not a problem
Characters that extract as junk have no key of their own; they appear only as a message under "problems".

Keyword coverage (with --posting; advice, not errors):
  - in_resume: posting keywords the resume already shows
  - in_master_not_resume: keywords the user has (in the master) but this version leaves out
  - not_in_master: keywords the user doesn't have. These are gaps: never add them.

Prints one JSON object. Exit codes: 0 no parse problems, 2 parse problems to fix, 1 bad input.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

STANDARD_HEADINGS = {
    'education', 'experience', 'work experience', 'professional experience', 'research experience',
    'relevant experience', 'employment', 'internships', 'projects', 'technical projects', 'personal projects',
    'academic projects', 'skills', 'technical skills', 'leadership', 'activities', 'leadership and activities',
    'leadership & activities', 'extracurricular activities', 'involvement', 'awards', 'honors', 'honors and awards',
    'honors & awards', 'certifications', 'publications', 'coursework', 'relevant coursework', 'volunteer experience',
    'volunteering', 'summary', 'profile', 'objective', 'languages', 'interests', 'additional information',
}

# Common internship skills written in lowercase, which the tool-name pattern below wouldn't catch.
SKILL_PHRASES = [
    'machine learning', 'deep learning', 'data analysis', 'data analytics', 'data science', 'data visualization',
    'data cleaning', 'data pipelines', 'dashboards', 'statistics', 'statistical analysis', 'a/b testing',
    'experimentation', 'regression', 'forecasting', 'natural language processing', 'computer vision',
    'data structures', 'algorithms', 'object-oriented', 'unit testing', 'testing', 'debugging', 'version control',
    'databases', 'relational databases', 'cloud', 'distributed systems', 'operating systems', 'networking',
    'web development', 'front-end', 'frontend', 'back-end', 'backend', 'full-stack', 'mobile development',
    'apis', 'microservices', 'automation', 'scripting', 'agile', 'scrum', 'product management', 'user research',
    'ux', 'wireframes', 'prototyping', 'financial modeling', 'excel', 'spreadsheets', 'embedded systems',
    'circuit design', 'pcb', 'firmware', 'signal processing', 'robotics', 'cad', 'simulation',
    'communication', 'teamwork', 'leadership', 'problem solving', 'presentations', 'technical writing',
]
TERM = re.compile(r'[A-Za-z][A-Za-z0-9]*(?:[.+#/\-][A-Za-z0-9+#]*)*[+#]*')
NOT_TERMS = {'we', 'you', 'our', 'the', 'this', 'job', 'intern', 'internship', 'summer', 'fall', 'spring', 'winter',
             'team', 'role', 'company', 'inc', 'llc', 'us', 'usa', 'eoe', 'equal', 'opportunity', 'remote', 'hybrid',
             'apply', 'about', 'what', 'who', 'why', 'how', 'requirements', 'qualifications', 'responsibilities',
             'preferred', 'required', 'benefits', 'salary', 'pay', 'location', 'description', 'url', 'deadline',
             'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
             'november', 'december', 'monday', 'friday', 'bachelor', 'master', 'phd', 'gpa', 'pm', 'am', 'pt', 'et'}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, errors='replace')


def pdf_text(path, layout=False):
    if shutil.which('pdftotext'):
        r = run(['pdftotext'] + (['-layout'] if layout else []) + [path, '-'])
        if r.returncode == 0:
            return r.stdout
    from pypdf import PdfReader
    return '\n'.join((p.extract_text() or '') for p in PdfReader(path).pages)


def any_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf':
        return pdf_text(path)
    if ext == '.docx':
        with zipfile.ZipFile(path) as z:
            return re.sub(r'<[^>]+>', ' ', z.read('word/document.xml').decode('utf8', 'replace'))
    src = open(path, encoding='utf-8', errors='replace').read()
    if ext == '.tex':
        src = re.sub(r'(?<!\\)%.*', '', src)
        src = src.split('\\begin{document}', 1)[-1]
        src = re.sub(r'\\[a-zA-Z@]+\*?(\[[^\]]*\])?', ' ', src).replace('{', ' ').replace('}', ' ').replace('\\', '')
    return src


def has(text_flat, term):
    return re.search(r'(?<![a-z0-9])' + re.escape(term.lower()) + r'(?![a-z0-9])', text_flat) is not None


def posting_keywords(text):
    """Skill phrases, tool names (SQL, Node.js, C#) and capitalized names (Tableau, Computer Science)."""
    body = [l for l in text.splitlines()
            if not l.lstrip().startswith('#') and not re.search(r'https?://|^\s*(url|link|deadline|location)\s*:', l, re.I)]
    flat = re.sub(r'\s+', ' ', '\n'.join(body)).lower()
    phrases = [p for p in SKILL_PHRASES if has(flat, p)]
    phrases = [p for p in phrases if not any(p != q and p in q for q in phrases)]  # "testing" inside "a/b testing"
    found = {p: p for p in phrases}
    for line in body:
        run_words, prev_end = [], 0
        def flush():
            if run_words:
                term = ' '.join(run_words)
                if term.lower() not in NOT_TERMS and len(term) > 2:
                    found.setdefault(term.lower(), term)
                run_words.clear()
        for m in TERM.finditer(line):
            tok = m.group(0).rstrip('.-/')
            gap = line[prev_end:m.start()]
            before = line[:m.start()]
            prev_end = m.start() + len(tok)
            low = tok.lower()
            if len(tok) < 2 or low in NOT_TERMS or re.search(r'\.(com|org|io|net)\b', low):
                flush(); continue
            tool_like = bool(re.search(r'[0-9+#.]', tok[1:]) and re.search(r'[A-Za-z]', tok)) \
                or bool(re.search(r'[a-z][A-Z]', tok)) or (tok.isupper() and 2 <= len(tok) <= 6)
            sentence_start = not before.strip() or re.search(r'[.!?:;(\[•*]\s*$|^\s*-\s*$', before)
            capitalized = tok[0].isupper() and not tool_like
            if capitalized:
                if run_words and gap != ' ':
                    flush()  # "Computer Science, Statistics" is two terms
                if run_words or not sentence_start:
                    run_words.append(tok)  # Computer Science, Google Cloud (an all-caps word like the BI in Power BI ends the run)
                    continue
            flush()
            if tool_like:
                found.setdefault(low, tok)
        flush()
    # drop single tokens already covered by a phrase ("a/b" inside "a/b testing")
    return {k: v for k, v in found.items() if not any(k != q and re.search(r'(?<![a-z0-9])' + re.escape(k) + r'(?![a-z0-9])', q) for q in found)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--name', required=True)
    ap.add_argument('--tex')
    ap.add_argument('--posting')
    ap.add_argument('--master')
    a = ap.parse_args()
    for p in [a.pdf, a.tex, a.posting, a.master]:
        if p and not os.path.isfile(p):
            print(json.dumps({'ok': False, 'error': f'not found: {p}'}))
            return 1

    text = pdf_text(a.pdf)
    layout = pdf_text(a.pdf, layout=True)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    flat = re.sub(r'\s+', ' ', text).lower()
    problems, notes = [], []

    name_near_top = any(a.name.lower() in l.lower() for l in lines[:4])
    if not name_near_top:
        problems.append('Your name is not in the first lines of the text. Make sure it is real text in the body, not an image or a page header.')

    ligs = sorted(set(re.findall('[\ufb00-\ufb06]', text)))
    if ligs:
        problems.append('Ligature characters (' + ' '.join(ligs) + ') break keyword matching. For pdflatex add \\input{glyphtounicode} and \\pdfgentounicode=1 to the preamble.')
    if '(cid:' in text or '\ufffd' in text:
        problems.append('Some characters extract as junk. Check fonts, and for pdflatex add \\input{glyphtounicode} and \\pdfgentounicode=1.')

    run_together = sorted({w for w in re.findall(r'\b[a-zA-Z]{22,}\b', text) if not re.search(r'@|\.com', w)})
    if len(run_together) >= 2:
        problems.append('Some words run together without spaces: ' + ', '.join(run_together[:5]) + '. An ATS may not find keywords inside them.')

    lay = [l for l in layout.splitlines() if l.strip()]
    two_sided = sum(1 for l in lay if (lambda parts: len(parts) >= 2 and all(len(p.split()) >= 4 for p in parts[:2]))(
        [p for p in re.split(r'\s{4,}', l.strip()) if p]))
    two_column = len(lay) > 0 and two_sided >= 3 and two_sided / len(lay) >= 0.10
    if two_column:
        problems.append('This looks like a two-column layout. Many ATS read straight across the page and mix the columns. A single column is safest.')

    nonstandard = []
    if a.tex:
        src = open(a.tex, encoding='utf-8', errors='replace').read()
        for h in re.findall(r'\\section\*?\{([^}]*)\}', src):
            clean = re.sub(r'\\[a-zA-Z]+|[{}]', '', h).strip()
            if clean and clean.lower().replace('\\&', '&') not in STANDARD_HEADINGS:
                nonstandard.append(clean)
        if nonstandard:
            notes.append('Section titles an ATS may not recognize: ' + ', '.join(nonstandard) + '. Standard ones like Experience, Projects and Skills parse most reliably.')

    fonts_ok = True
    if shutil.which('pdffonts'):
        rows = [l for l in run(['pdffonts', a.pdf]).stdout.splitlines()[2:] if l.strip()]
        not_emb = [l.split()[0] for l in rows if not re.search(r'\syes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$', l)]
        fonts_ok = not not_emb
        if not_emb:
            problems.append('Fonts not embedded: ' + ', '.join(not_emb[:3]) + '. Some systems will show or read the text wrong.')

    keywords = None
    if a.posting:
        kw = posting_keywords(open(a.posting, encoding='utf-8', errors='replace').read())
        master_flat = re.sub(r'\s+', ' ', any_text(a.master)).lower() if a.master else ''
        in_resume = sorted(v for k, v in kw.items() if has(flat, k))
        missing = [v for k, v in kw.items() if not has(flat, k)]
        keywords = {
            'in_resume': in_resume,
            'in_master_not_resume': sorted(v for v in missing if master_flat and has(master_flat, v)),
            'not_in_master': sorted(v for v in missing if not master_flat or not has(master_flat, v)),
        }

    print(json.dumps({'ok': not problems, 'problems': problems, 'notes': notes,
                      'checks': {'name_near_top': name_near_top, 'ligatures': ligs, 'run_together': run_together,
                                 'two_column': two_column, 'nonstandard_headings': nonstandard, 'fonts_embedded': fonts_ok},
                      'keywords': keywords}, indent=1, ensure_ascii=False))
    return 2 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
