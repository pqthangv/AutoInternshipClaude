#!/usr/bin/env python3
"""Compare a tailored resume's bullets with the master's: how much was really tailored, and where each came from.

Usage:
  python compare_bullets.py MASTER TAILORED

MASTER and TAILORED are the sources (.tex or .docx), not the PDFs, because bullets are easy to find there.

For each bullet in TAILORED, finds the master bullet(s) it comes from and calls it:
  unchanged   word for word from the master (punctuation and spacing aside)
  reworded    rewritten from one master bullet
  merged      built from two master bullets (fine when every fact comes from them)
  no_source   no master bullet clearly matches: check every fact in it against the master

Reports, as JSON: counts, unchanged_share, advice, and the list of bullets with their closest master bullet(s),
which also gives the before -> after pairs for changes.md.
Why it exists: tailoring that only picks and reorders master bullets leaves most of them word for word, and
recruiters and ATS keyword searches see the same generic lines for every job. A high unchanged_share is the sign.
Exit codes: 0 looks tailored, 2 something to review (mostly unchanged, or a bullet with no source), 1 bad input.
"""
import difflib
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_resume import tex_text  # same LaTeX cleanup the fact-check uses

STOP = set('a an and the of for to in on with by from at as into using via over per was were is are be this that its it '
           'my our their which who while also more than'.split())
# A skills line ("Languages: Python, Java") is a list, not a bullet to tailor.
LABEL_LINE = re.compile(r'^[A-Za-z][A-Za-z &/]{1,30}:\s')


def balanced(src, start):
    """Text inside the brace group that opens at src[start] == '{'."""
    depth = 0
    for i in range(start, len(src)):
        if src[i] == '{' and (i == 0 or src[i - 1] != '\\'):
            depth += 1
        elif src[i] == '}' and src[i - 1] != '\\':
            depth -= 1
            if depth == 0:
                return src[start + 1:i]
    return src[start + 1:]


def tex_bullets(path):
    src = open(path, encoding='utf-8', errors='replace').read()
    src = re.sub(r'(?<!\\)%.*', '', src)
    if '\\begin{document}' in src:
        src = src.split('\\begin{document}', 1)[1]  # skip the preamble, where commands like \resumeItem are defined
    raw = []
    # \resumeItem{...} (Jake's template and its relatives)
    for m in re.finditer(r'\\resumeItem\s*\{', src):
        raw.append(balanced(src, m.end() - 1))
    # Plain \item ... up to the next \item or the end of the list
    for m in re.finditer(r'\\item\b(.*?)(?=\\item\b|\\end\{|\\resumeItemListEnd|\\resumeSubHeadingListEnd|$)', src, re.S):
        raw.append(m.group(1))
    return raw


def docx_bullets(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf8', 'replace')
    raw = []
    for p in re.findall(r'<w:p[ >].*?</w:p>', xml, re.S):
        text = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))
        if '<w:numPr>' in p or re.match(r'\s*[•●▪◦‣∙]', text):  # list paragraphs, or ones typed with a bullet
            raw.append(re.sub(r'^\s*[•●▪◦‣∙]\s*', '', text))
    return raw


def bullets(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.tex':
        raw = [tex_text(b) for b in tex_bullets(path)]
    elif ext == '.docx':
        raw = docx_bullets(path)
    else:
        raise ValueError(f'{path}: use the .tex or .docx source, not {ext or "this file type"}')
    out, seen = [], set()
    for b in raw:
        b = re.sub(r'\s+', ' ', b).strip(' -–•')
        if len(b) < 25 or LABEL_LINE.match(b) or b.lower() in seen:
            continue
        seen.add(b.lower())
        out.append(b)
    return out


def flat(s):
    return re.sub(r'[^a-z0-9+#%.]+', ' ', s.lower()).strip()


def words(s):
    return {w.strip('.') for w in flat(s).split() if w.strip('.') and w.strip('.') not in STOP}


def cover(t, m):
    """Share of the tailored bullet's words that appear in the master bullet(s)."""
    return len(t & m) / len(t) if t else 0.0


def main():
    if len(sys.argv) != 3:
        print(json.dumps({'ok': False, 'error': 'usage: compare_bullets.py MASTER TAILORED'}))
        sys.exit(1)
    master_path, tailored_path = sys.argv[1:]
    for p in (master_path, tailored_path):
        if not os.path.exists(p):
            print(json.dumps({'ok': False, 'error': f'not found: {p}'}))
            sys.exit(1)
    try:
        master, tailored = bullets(master_path), bullets(tailored_path)
    except (ValueError, KeyError, zipfile.BadZipFile) as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
    if not master or not tailored:
        print(json.dumps({'ok': False, 'error': f'no bullets found in {"the master" if not master else "the tailored resume"}'}))
        sys.exit(1)

    mwords = [words(m) for m in master]
    report, counts = [], {'unchanged': 0, 'reworded': 0, 'merged': 0, 'no_source': 0}
    for t in tailored:
        tw = words(t)
        ranked = sorted(range(len(master)), key=lambda i: (cover(tw, mwords[i]), difflib.SequenceMatcher(None, flat(t), flat(master[i])).ratio()), reverse=True)
        best = ranked[0]
        same = difflib.SequenceMatcher(None, flat(t), flat(master[best])).ratio()
        one = cover(tw, mwords[best])
        two = cover(tw, mwords[best] | mwords[ranked[1]]) if len(ranked) > 1 else one
        item = {'tailored': t}
        if same >= 0.95:
            verdict = 'unchanged'
        elif two >= 0.65 and two - one >= 0.2:  # a second master bullet supplies a good share of the words
            verdict = 'merged'
            item['also_from'] = master[ranked[1]]
        elif one >= 0.5 or same >= 0.6:
            verdict = 'reworded'
        else:
            verdict = 'no_source'
        item['verdict'] = verdict
        item['closest_master'] = master[best]
        counts[verdict] += 1
        report.append(item)

    share = round(counts['unchanged'] / len(tailored), 2)
    advice = []
    if share > 0.5:
        advice.append(f'{counts["unchanged"]} of {len(tailored)} bullets are word for word from the master. Rewrite the ones '
                      'that don\'t lead with what this posting asks for (references/tailoring.md, "Rewrite every kept bullet").')
    if counts['no_source']:
        advice.append('Check each no_source bullet against the master: every fact must come from it, or the bullet goes.')
    print(json.dumps({'ok': not advice, 'master_bullets': len(master), 'tailored_bullets': len(tailored), **counts,
                      'unchanged_share': share, 'advice': advice, 'bullets': report}, indent=1, ensure_ascii=False))
    sys.exit(2 if advice else 0)


if __name__ == '__main__':
    main()
