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

It also lists entries (a job, project or activity) left with one bullet when the master gives that entry two or more
("lone_bullets"; .tex only). A lone bullet under a heading looks unfinished, and tailoring agents kept making them to
squeeze one more entry onto a full page. Education, awards, honors and skills lists are left out (one line there is
normal), and so is anything this can't place: a .docx, a template whose lists it can't read, a bullet with no source.

Reports, as JSON: counts, unchanged_share, lone_bullets, advice, and the list of bullets with their closest master
bullet(s), which also gives the before -> after pairs for changes.md.
Why it exists: tailoring that only picks and reorders master bullets leaves most of them word for word, and
recruiters and ATS keyword searches see the same generic lines for every job. A high unchanged_share is the sign.
Exit codes: 0 looks tailored, 2 something to review (mostly unchanged, a bullet with no source, an entry with one
bullet), 1 bad input.
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


def tidy(b):
    return re.sub(r'\s+', ' ', b).strip(' -–•')


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
        b = tidy(b)
        if len(b) < 25 or LABEL_LINE.match(b) or b.lower() in seen:
            continue
        seen.add(b.lower())
        out.append(b)
    return out


# Where lists start and end, their items, and section titles. Jake's template wraps entries in
# \resumeSubHeadingListStart and their bullets in \resumeItemListStart; other templates use itemize directly.
# A list that holds another list is a list of entries, not of bullets, and is skipped.
TOKENS = re.compile(r'(?P<start>\\resume(?:Item|SubHeading)ListStart\b|\\begin\{(?:itemize|enumerate)\})'
                    r'|(?P<end>\\resume(?:Item|SubHeading)ListEnd\b|\\end\{(?:itemize|enumerate)\})'
                    r'|(?P<ritem>\\resumeItem\s*\{)|(?P<item>\\item\b)|(?P<section>\\section\*?\s*\{)')
# Sections where one line under a heading is normal (a school's honors line, one award, a skills list).
ONE_LINE_OK = re.compile(r'educat|award|honou?r|skill|certif|publication|coursework|interest|language|achievement|'
                         r'scholarship|technolog', re.I)
DIMENSION = re.compile(r'-?[\d.]+\s*(pt|in|em|ex|cm|mm|bp)?')
LONE_ADVICE = 'One bullet under: '  # check_tailored.py lists advice starting with this under "fix"


def entry_name(chunk):
    """The heading's first readable argument: a company or a project's name (before "| tools")."""
    chunk = chunk.replace('$\\vert$', ' | ').replace('$|$', ' | ')
    chunk = re.sub(r'\\href\s*\{[^{}]*\}\s*\{', '{', chunk)  # a linked name: keep the text, not the address
    for m in re.finditer(r'\\[A-Za-z]+\*?\s*\{', chunk):
        text = tidy(tex_text(balanced(chunk, m.end() - 1)))
        if len(re.findall(r'[A-Za-z]', text)) >= 2 and not DIMENSION.fullmatch(text):  # skip \vspace{-2pt} and the like
            break
    else:
        text = tidy(tex_text(chunk))
    text = text.split(' | ')[0].strip()
    return text if len(text) <= 60 else text[:60].rsplit(' ', 1)[0].rstrip(' ,;:-') + '…'


def tex_entries(path):
    """Each bullet list in a .tex resume: [{'section', 'entry', 'items'}], items as cleaned text."""
    src = open(path, encoding='utf-8', errors='replace').read()
    src = re.sub(r'(?<!\\)%.*', '', src)
    if '\\begin{document}' in src:
        src = src.split('\\begin{document}', 1)[1]
    toks = list(TOKENS.finditer(src))
    section, stack, out, last, skip = '', [], [], 0, -1
    for i, m in enumerate(toks):
        if m.start() < skip:  # inside a \resumeItem{...} already read
            continue
        if m.group('section'):
            body = balanced(src, m.end() - 1)
            section, last = tidy(tex_text(body)), m.end() + len(body) + 1
        elif m.group('start'):
            if stack:
                stack[-1]['parent'] = True
            stack.append({'section': section, 'entry': entry_name(src[last:m.start()]), 'items': [], 'parent': False})
            last = m.end()
        elif m.group('end'):
            if stack:
                lst = stack.pop()
                if not lst['parent']:
                    out.append(lst)
            last = m.end()
        elif m.group('ritem'):
            body = balanced(src, m.end() - 1)
            skip = m.end() + len(body)
            if stack:
                stack[-1]['items'].append(body)
        elif stack:  # \item: its text runs to the next token
            stack[-1]['items'].append(src[m.end():toks[i + 1].start() if i + 1 < len(toks) else len(src)])
    for lst in out:
        lst['items'] = [t for t in (tidy(tex_text(x)) for x in lst['items']) if t]
        del lst['parent']
    return out


def flat(s):
    return re.sub(r'[^a-z0-9+#%.]+', ' ', s.lower()).strip()


def words(s):
    return {w.strip('.') for w in flat(s).split() if w.strip('.') and w.strip('.') not in STOP}


def cover(t, m):
    """Share of the tailored bullet's words that appear in the master bullet(s)."""
    return len(t & m) / len(t) if t else 0.0


def closest(t, master, mwords):
    """(verdict, index of the closest master bullet, index of the second closest or None)."""
    tw = words(t)
    ranked = sorted(range(len(master)), key=lambda i: (cover(tw, mwords[i]), difflib.SequenceMatcher(None, flat(t), flat(master[i])).ratio()), reverse=True)
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    same = difflib.SequenceMatcher(None, flat(t), flat(master[best])).ratio()
    one = cover(tw, mwords[best])
    two = cover(tw, mwords[best] | mwords[second]) if second is not None else one
    if same >= 0.95:
        return 'unchanged', best, second
    if two >= 0.65 and two - one >= 0.2:  # a second master bullet supplies a good share of the words
        return 'merged', best, second
    if one >= 0.5 or same >= 0.6:
        return 'reworded', best, second
    return 'no_source', best, second


def lone_bullets(master_path, tailored_path, master, mwords):
    """Entries left with one bullet whose master entry has two or more. Empty unless both files are .tex."""
    if not all(os.path.splitext(p)[1].lower() == '.tex' for p in (master_path, tailored_path)):
        return []
    size = {}  # master bullet (as bullets() keeps it, lowercased) -> how many bullets its entry has
    for e in tex_entries(master_path):
        for t in e['items']:
            size.setdefault(t.lower(), len(e['items']))
    out = []
    for e in tex_entries(tailored_path):
        if len(e['items']) != 1 or not e['section'] or ONE_LINE_OK.search(e['section']):
            continue
        t = e['items'][0]
        if len(t) < 25 or LABEL_LINE.match(t):
            continue
        verdict, best, _ = closest(t, master, mwords)
        n = size.get(master[best].lower(), 0)
        if verdict != 'no_source' and n >= 2:
            out.append({'section': e['section'], 'entry': e['entry'], 'bullet': t, 'master_bullets': n})
    return out


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
        verdict, best, second = closest(t, master, mwords)
        item = {'tailored': t}
        if verdict == 'merged':
            item['also_from'] = master[second]
        item['verdict'] = verdict
        item['closest_master'] = master[best]
        counts[verdict] += 1
        report.append(item)
    lone = lone_bullets(master_path, tailored_path, master, mwords)

    share = round(counts['unchanged'] / len(tailored), 2)
    advice = []
    if share > 0.5:
        advice.append(f'{counts["unchanged"]} of {len(tailored)} bullets are word for word from the master. Rewrite the ones '
                      'that don\'t lead with what this posting asks for (references/tailoring.md, "Rewrite every kept bullet").')
    if counts['no_source']:
        advice.append('Check each no_source bullet against the master: every fact must come from it, or the bullet goes.')
    if lone:
        advice.append(LONE_ADVICE + '; '.join(e['entry'] for e in lone) + '. Give each a second bullet from that entry\'s '
                      'other master bullets, or drop the entry; a research role stays, so make room elsewhere '
                      '(references/tailoring.md, "Bullets per entry").')
    print(json.dumps({'ok': not advice, 'master_bullets': len(master), 'tailored_bullets': len(tailored), **counts,
                      'unchanged_share': share, 'lone_bullets': lone, 'advice': advice, 'bullets': report},
                     indent=1, ensure_ascii=False))
    sys.exit(2 if advice else 0)


if __name__ == '__main__':
    main()
