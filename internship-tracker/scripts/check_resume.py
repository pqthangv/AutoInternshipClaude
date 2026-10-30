#!/usr/bin/env python3
"""Fact-check a tailored resume, cover letter or interview prep file against the master resume.

Usage:
  python check_resume.py MASTER CANDIDATE [--known profile.json ...] [--allow "Northwind" ...] [--resume]

MASTER and CANDIDATE can be .tex, .pdf, .docx, .md or .txt. --known adds other files whose facts are
the user's own (profile.json, an AutoInternship backup). --allow adds words that are fine to introduce,
like the target company's name and the role title. --resume also checks that contact details (emails,
phone numbers, LinkedIn and GitHub links) are unchanged.

Reports, as JSON:
  new_numbers   numbers, percentages, amounts and years in CANDIDATE that appear nowhere in MASTER/known
  new_terms     tool-like or proper-noun terms (SQL, Tableau, Node.js, C#) that are new
  missing_contact  emails, phone numbers and LinkedIn/GitHub links from MASTER that CANDIDATE lost (with --resume)
  placeholders  leftover template text like [Company], TODO, XXX or lorem ipsum
Everything flagged needs a look: either it's an honest rewording (fine) or an invented fact (fix it).
Exit codes: 0 nothing flagged, 2 something to review, 1 bad input.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import zipfile


def tex_text(src):
    src = re.sub(r'(?<!\\)%.*', '', src)  # comments
    if '\\begin{document}' in src:
        src = src.split('\\begin{document}', 1)[1]
    src = src.replace('\\\\', '\n')
    src = re.sub(r'\\(href)\{([^}]*)\}\{([^}]*)\}', r'\2 \3', src)
    for ch in '&%$#_{}':
        src = src.replace('\\' + ch, ch if ch not in '{}' else '')
    src = re.sub(r'\\(textasciitilde|textasciicircum)\{\}', '', src)
    src = re.sub(r'\\[a-zA-Z@]+\*?(\[[^\]]*\])?', ' ', src)  # commands, keep their brace contents
    src = src.replace('{', ' ').replace('}', ' ').replace('$|$', ' | ').replace('$', ' ')
    src = src.replace('--', '-').replace('``', '"').replace("''", '"')
    return src


def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf8', 'replace')
    xml = re.sub(r'</w:p>', '\n', xml)
    return re.sub(r'<[^>]+>', '', xml)


def pdf_text(path):
    try:
        return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, errors='replace').stdout
    except FileNotFoundError:
        from pypdf import PdfReader
        return '\n'.join((p.extract_text() or '') for p in PdfReader(path).pages)


def read(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.tex':
        return tex_text(open(path, encoding='utf-8', errors='replace').read())
    if ext == '.pdf':
        return pdf_text(path)
    if ext == '.docx':
        return docx_text(path)
    if ext == '.json':
        def walk(v):
            if isinstance(v, dict):
                return ' '.join(walk(x) for x in v.values())
            if isinstance(v, list):
                return ' '.join(walk(x) for x in v)
            return str(v)
        return walk(json.load(open(path, encoding='utf-8')))
    return open(path, encoding='utf-8', errors='replace').read()


NUM = re.compile(r'(?<![\w.])[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?[%+kKmM]|\+)?(?![\w])')
TERM = re.compile(r'[A-Za-z][A-Za-z0-9]*(?:[.+#/\-][A-Za-z0-9+#]*)*[+#]*')
MONTHS = set('jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december present'.split())


def norm_num(s):
    return re.sub(r'[,\s]', '', s).lower().lstrip('$€£')


def numbers(text):
    return {norm_num(m.group(0)) for m in NUM.finditer(text)}


def is_termlike(tok, prev):
    if len(tok) < 2 or tok.lower() in MONTHS:
        return False
    if re.search(r'[0-9+#.]', tok[1:]) and re.search(r'[A-Za-z]', tok):  # C++, Node.js, S3, C#
        return True
    if re.search(r'[a-z][A-Z]', tok) or (tok.isupper() and len(tok) >= 2):  # JavaScript, PostgreSQL, SQL, AWS
        return True
    # Capitalized mid-sentence: "dashboards in Tableau"
    return tok[0].isupper() and prev is not None and prev[:1].islower()


def terms(text):
    found = {}
    text = re.sub(r'\[fill in:[^\]]*\]', ' ', text, flags=re.I)  # reminders for the user, not claims
    for line in text.splitlines():
        prev, prev_end = None, 0
        for m in TERM.finditer(line):
            tok = m.group(0).rstrip('.-/')
            gap = line[prev_end:m.start()]
            starts_sentence = prev is None or re.search(r'[.!?:;(\[]', gap)
            if is_termlike(tok, None if starts_sentence else prev):
                found.setdefault(tok.lower(), tok)
            prev, prev_end = tok, m.start() + len(tok)  # trailing punctuation belongs to the gap
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('master')
    ap.add_argument('candidate')
    ap.add_argument('--known', action='append', default=[])
    ap.add_argument('--allow', action='append', default=[])
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    for p in [a.master, a.candidate, *a.known]:
        if not os.path.isfile(p):
            print(json.dumps({'ok': False, 'error': f'not found: {p}'}))
            return 1

    master = read(a.master)
    known = master + '\n' + '\n'.join(read(k) for k in a.known) + '\n' + '\n'.join(a.allow)
    cand = read(a.candidate)
    known_flat = re.sub(r'\s+', ' ', known).lower()
    known_nums = numbers(known)

    new_numbers = sorted(n for n in numbers(cand) - known_nums if not re.fullmatch(r'\d', n))
    def known_word(k):
        return re.search(r'(?<![a-z0-9])' + re.escape(k) + r'(?![a-z0-9])', known_flat) is not None
    new_terms = sorted(t for k, t in terms(cand).items() if not known_word(k))
    placeholders = sorted(set(m.group(0) for m in re.finditer(
        r'\[(?:company|role|team|name|insert[^\]]*|your [^\]]*|[A-Z ]{3,})\]|\bTODO\b|\bTBD\b|\bXXX+\b|lorem ipsum|<[a-z ]+>', cand, re.I)))
    missing = []
    if a.resume:
        cand_flat = re.sub(r'\s+', ' ', cand).lower()
        contact = set(re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', master))
        contact |= set(re.findall(r'(?:https?://)?(?:www\.)?(?:linkedin\.com|github\.com)/[\w/-]+', master))
        contact |= set(re.findall(r'\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}', master))
        bare = lambda c: re.sub(r'^(https?://)?(www\.)?', '', c.lower()).rstrip('/')
        missing = sorted({bare(c) for c in contact if bare(c) not in cand_flat})

    flagged = bool(new_numbers or new_terms or placeholders or missing)
    print(json.dumps({'ok': not flagged, 'new_numbers': new_numbers, 'new_terms': new_terms,
                      'missing_contact': missing, 'placeholders': placeholders}, indent=1))
    return 2 if flagged else 0


if __name__ == '__main__':
    sys.exit(main())
