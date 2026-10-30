#!/usr/bin/env python3
"""Compile a LaTeX resume (for example an Overleaf project) and check the result.

Usage:
  python build_resume.py MAIN.tex --out NAME.pdf [--max-pages 1] [--expect TEXT ...] [--engine pdflatex|xelatex|lualatex]

  --max-pages 0 means no page limit (for building the master, which can be any length).

What it does:
  1. Picks the engine (xelatex or lualatex if the source uses fontspec, otherwise pdflatex),
     unless --engine is given. Overleaf projects default to pdflatex.
  2. Compiles with the project folder as the working directory (so its .cls, .sty, fonts and
     images are found) but writes every build file to the system temp folder, so nothing is
     created in, or later removed from, the user's folders.
  3. Checks the page count, that the PDF's text can be extracted (applicant tracking
     systems read the text layer, not the picture), and how much of the page is left empty.
  4. Copies the PDF to --out. If a file already exists there, it is moved into an _old/
     folder beside it (with a date and time in its name) first. Nothing is ever deleted.

Prints one JSON object. Exit codes:
  0  built and within the page limit. "free_lines" says roughly how many lines are still empty at the bottom;
     2 or more means there's room to add from the master (a warning says so)
  1  compile failed (the JSON has the first LaTeX errors with line numbers)
  2  built, but longer than --max-pages: "lines_over" says roughly how much to cut, so trim once and run again
  3  no LaTeX engine available here (fall back to compiling in Overleaf)
"""
import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time


def detect_engine(source):
    if re.search(r'\\usepackage(\[[^\]]*\])?\{[^}]*\bfontspec\b', source) or re.search(r'\\set(main|sans|mono)font\b', source):
        return 'lualatex' if re.search(r'\\usepackage\{[^}]*\bluacode\b|\\directlua', source) else 'xelatex'
    if re.search(r'\\directlua|\\usepackage\{[^}]*\bluacode\b', source):
        return 'lualatex'
    return 'pdflatex'


def run(cmd, cwd, timeout=180):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors='replace', timeout=timeout)


def first_errors(log_text, limit=8):
    lines = log_text.splitlines()
    out = []
    for i, line in enumerate(lines):
        if line.startswith('!') or re.match(r'^[^:\s]+\.tex:\d+:', line):
            snippet = ' '.join(l.strip() for l in lines[i:i + 3] if l.strip())
            if snippet not in out:
                out.append(snippet[:300])
        if len(out) >= limit:
            break
    missing = sorted(set(re.findall(r"File `([^']+)' not found", log_text)))
    return out, missing


def lint_specials(source):
    """Find likely unescaped special characters in the document body (the usual tailoring mistake)."""
    found = []
    lines = source.splitlines()
    start = next((i for i, l in enumerate(lines) if '\\begin{document}' in l), 0)
    in_table = 0
    for i in range(start, len(lines)):
        line = lines[i]
        code = re.sub(r'\\[%&$#_]', '', line)  # drop escaped ones
        if re.search(r'\\begin\{(tabular\*?|tabularx|array|align\*?)\}', code):
            in_table += 1
        if re.search(r'\\end\{(tabular\*?|tabularx|array|align\*?)\}', code):
            in_table = max(0, in_table - 1)
        if re.search(r'\d\s?%|[A-Za-z]%[A-Za-z ]', code):
            found.append(f'line {i + 1}: "%" looks like text, not a comment. Write \\% (an unescaped % hides the rest of the line).')
        if '&' in code and not in_table and not code.rstrip().endswith('\\\\'):
            found.append(f'line {i + 1}: "&" outside a table. Write \\&.')
        if re.search(r'(?<![\\$])\$(?![^$]*\$)', code) and not re.search(r'\$[|]\$', code):
            found.append(f'line {i + 1}: lone "$". Write \\$ for a dollar sign.')
        if re.search(r'(?<![\\{])#', code):
            found.append(f'line {i + 1}: "#" in text. Write \\# (for example C\\#).')
    return found[:10]


def page_count(pdf):
    if shutil.which('pdfinfo'):
        r = run(['pdfinfo', pdf], cwd=os.path.dirname(pdf) or '.')
        m = re.search(r'^Pages:\s+(\d+)', r.stdout, re.M)
        if m:
            return int(m.group(1))
    try:
        from pypdf import PdfReader
        return len(PdfReader(pdf).pages)
    except Exception:
        pass
    try:
        import pdfplumber
        with pdfplumber.open(pdf) as doc:
            return len(doc.pages)
    except Exception:
        return None


def word_boxes(pdf, page):
    """Page width, height and word boxes (left, top, right, bottom, in points from the top-left corner) for one page.

    Uses poppler's pdftotext -bbox, else pdfplumber. Some pdftotext builds (xpdf's, common on Windows) have
    no -bbox, and without a fallback the page checks below would quietly report nothing."""
    if shutil.which('pdftotext'):
        r = run(['pdftotext', '-bbox', '-f', str(page), '-l', str(page), pdf, '-'], cwd=os.path.dirname(pdf) or '.')
        m = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', r.stdout)
        boxes = [tuple(map(float, b)) for b in re.findall(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"', r.stdout)]
        if m and boxes:
            return float(m.group(1)), float(m.group(2)), boxes
    try:
        import pdfplumber
        with pdfplumber.open(pdf) as doc:
            p = doc.pages[page - 1]
            boxes = [(w['x0'], w['top'], w['x1'], w['bottom']) for w in p.extract_words()]
            return (float(p.width), float(p.height), boxes) if boxes else None
    except Exception:
        return None


def page_space(pdf, page):
    """How far down the page the text reaches (0 to 1), and about how many more lines would fit below it.

    The second number exists because a fill share alone hid the problem: tailored pages that stopped at
    80-93% of the page (6 to 11 empty lines) never reached the old "under 75%" warning."""
    found = word_boxes(pdf, page)
    if not found:
        return None, None
    _, height, boxes = found
    top, last = min(b[1] for b in boxes), max(b[3] for b in boxes)
    fill = round(last / height, 2)
    # Line height is the usual step from one line's bottom to the next. Section gaps are rarer, so the median
    # skips them; steps under 6pt are words of the same line set in different fonts.
    bottoms = sorted({round(b[3]) for b in boxes})
    steps = [b - a for a, b in zip(bottoms, bottoms[1:]) if 6 <= b - a <= 24]
    if not steps:
        return fill, None
    # Resume templates nearly always use the same top and bottom margin, so the text area ends one top margin
    # above the page edge. On a full first page of a master this comes out at 0.
    return fill, max(0, int((height - top - last) / statistics.median(steps)))


def margins(pdf, page=1):
    """Distance from the text to each page edge, in inches, measured from word positions."""
    found = word_boxes(pdf, page)
    if not found:
        return None
    w, h, boxes = found
    return {'left': round(min(b[0] for b in boxes) / 72, 2), 'right': round((w - max(b[2] for b in boxes)) / 72, 2),
            'top': round(min(b[1] for b in boxes) / 72, 2), 'bottom': round((h - max(b[3] for b in boxes)) / 72, 2)}


def smallest_text_size(pdf):
    """Smallest font size used for a real share of the text (at least 2% of characters), in points."""
    try:
        import pdfplumber
        from collections import Counter
        sizes = Counter()
        with pdfplumber.open(pdf) as doc:
            for page in doc.pages:
                sizes.update(round(c['size'], 1) for c in page.chars if c['text'].strip())
        total = sum(sizes.values())
        common = [size for size, n in sizes.items() if total and n / total >= 0.02]
        return (min(common), True) if common else (None, True)
    except ImportError:
        pass
    # Fallback without pdfplumber: letter height is about 0.885 of the font size for common LaTeX fonts.
    if not shutil.which('pdftotext'):
        return (None, False)
    r = run(['pdftotext', '-bbox', pdf, '-'], cwd=os.path.dirname(pdf) or '.')
    hs = sorted(float(b) - float(a) for a, b in re.findall(r'<word [^>]*yMin="([\d.]+)"[^>]*yMax="([\d.]+)"', r.stdout))
    if not hs:
        return (None, False)
    return (round(hs[len(hs) // 50] / 0.885, 1), False)


def overflow_lines(pdf, from_page):
    """Lines of text past the page limit, so the trim can be sized in one pass."""
    if not shutil.which('pdftotext'):
        return None
    r = run(['pdftotext', '-layout', '-f', str(from_page), pdf, '-'], cwd=os.path.dirname(pdf) or '.')
    return sum(1 for l in r.stdout.splitlines() if l.strip())


def pdf_text(pdf):
    if shutil.which('pdftotext'):
        r = run(['pdftotext', '-layout', pdf, '-'], cwd=os.path.dirname(pdf) or '.')
        if r.returncode == 0:
            return r.stdout
    try:
        from pypdf import PdfReader
        return '\n'.join((p.extract_text() or '') for p in PdfReader(pdf).pages)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tex')
    ap.add_argument('--out', required=True)
    ap.add_argument('--max-pages', type=int, default=1)
    ap.add_argument('--expect', action='append', default=[], help='text that must be readable in the PDF, e.g. your name')
    ap.add_argument('--engine', choices=['pdflatex', 'xelatex', 'lualatex'])
    a = ap.parse_args()

    tex = os.path.abspath(a.tex)
    if not os.path.isfile(tex):
        print(json.dumps({'ok': False, 'error': f'not found: {tex}'}))
        return 1
    src_dir = os.path.dirname(tex)
    with open(tex, encoding='utf-8', errors='replace') as f:
        source = f.read()
    engine = a.engine or detect_engine(source)

    have_latexmk = shutil.which('latexmk')
    if not (shutil.which(engine) or shutil.which('tectonic')):
        print(json.dumps({'ok': False, 'code': 'NO_LATEX', 'engine': engine,
                          'error': 'No LaTeX engine is installed here. Compile the tailored .tex in Overleaf instead.'}))
        return 3

    build = tempfile.mkdtemp(prefix='resume-build-')  # system temp, outside the user's folders
    try:
        name = os.path.splitext(os.path.basename(tex))[0]
        if shutil.which(engine):
            if have_latexmk:
                flag = {'pdflatex': '-pdf', 'xelatex': '-xelatex', 'lualatex': '-lualatex'}[engine]
                cmd = ['latexmk', flag, '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', f'-outdir={build}', tex]
                r = run(cmd, cwd=src_dir)
            else:
                cmd = [engine, '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', f'-output-directory={build}', tex]
                r = run(cmd, cwd=src_dir)
                if r.returncode == 0:
                    r = run(cmd, cwd=src_dir)  # second pass for references
        else:
            engine = 'tectonic'
            r = run(['tectonic', '--outdir', build, tex], cwd=src_dir)

        pdf = os.path.join(build, name + '.pdf')
        log_path = os.path.join(build, name + '.log')
        log_text = open(log_path, encoding='utf-8', errors='replace').read() if os.path.exists(log_path) else (r.stdout + r.stderr)

        if r.returncode != 0 or not os.path.exists(pdf):
            errors, missing = first_errors(log_text)
            hint = []
            if missing:
                hint.append('Missing packages or files: ' + ', '.join(missing) + '. If they are part of the Overleaf project, copy them next to the .tex; otherwise compile in Overleaf.')
            if any(k in e for e in errors for k in ('File ended while scanning', 'Runaway argument', 'Paragraph ended before')):
                hint.append('Usually an unescaped % (which comments out the rest of the line) or a missing closing brace in new text.')
            if any('Misplaced alignment tab' in e or 'Missing $ inserted' in e or 'Undefined control sequence' in e for e in errors):
                hint.append('Usually unescaped special characters in new text: escape & % $ # _ { } as \\& \\% \\$ \\# \\_ \\{ \\}, and write ~ and ^ as \\textasciitilde{} and \\textasciicircum{}.')
            print(json.dumps({'ok': False, 'code': 'COMPILE_ERROR', 'engine': engine, 'errors': errors,
                              'suspect_lines': lint_specials(source), 'hints': hint}, indent=1))
            return 1

        pages = page_count(pdf)
        text = pdf_text(pdf)
        warnings = []
        missing_text = []
        if text is None:
            warnings.append('Could not extract text to check readability.')
        else:
            flat = re.sub(r'\s+', ' ', text).lower()
            for e in a.expect:
                if re.sub(r'\s+', ' ', e).lower() not in flat:
                    missing_text.append(e)
            if len(flat.strip()) < 200:
                warnings.append('Very little text could be extracted. Applicant tracking systems may not be able to read this PDF.')
            if '(cid:' in flat or '\ufffd' in text:
                warnings.append('Some characters extract as garbage. Add \\input{glyphtounicode} and \\pdfgentounicode=1 to the preamble (pdflatex), or check fonts.')
        if re.search(r'Overfull \\hbox \((\d{2,}|[5-9])\.\d+pt', log_text):
            warnings.append('Some lines run past the margin (overfull hbox over 5pt). Shorten the longest new lines.')

        limit = a.max_pages if a.max_pages > 0 else None
        over = limit is not None and pages is not None and pages > limit
        fill = None
        free = None
        extra_lines = None
        if over:
            extra_lines = overflow_lines(pdf, a.max_pages + 1)
            warnings.append(f'{pages} pages: about {extra_lines} lines past page {a.max_pages}. Cut low-value content first, following the '
                            'trim order. If only a few lines remain over and the next thing to cut is a strong match for the posting, '
                            'squeeze instead, within the limits in tailoring.md, then build again.')
        elif limit is not None and not pages:
            warnings.append('Could not count the pages (that needs pdfinfo, pypdf or pdfplumber). When you look at the rendered '
                            'PDF, check by eye that it is one page with no empty lines at the bottom.')
        elif limit is not None:
            fill, free = page_space(pdf, pages)
            if fill is None:
                warnings.append('Could not measure how full the page is (that needs pdftotext from poppler, or pdfplumber). '
                                'When you look at the rendered page, check the bottom for empty lines by eye.')
            elif free is not None and free >= 2:
                warnings.append(f'About {free} lines are empty at the bottom of the page. Fill them from the master, following '
                                '"Filling the page" in tailoring.md: more bullets on the entries you kept come first. Add about '
                                f'{free} lines (a two-line bullet counts as two) and build again; if it spills onto page 2, take '
                                'back the last addition. Never pad with unrelated items or stretch the spacing.')

        page_margins = margins(pdf)
        if page_margins:
            # A full page's last line hangs a little below the text area (LaTeX lets its descenders do that): a master
            # with margin=0.45in measures 0.38 in at the bottom. So the bottom gets 0.1 in of slack, or filling the
            # page to the bottom would read as a squeezed margin.
            limits = {'left': 0.395, 'right': 0.395, 'top': 0.395, 'bottom': 0.295}
            tight = [k for k in limits if page_margins[k] < limits[k]]
            if tight:
                warnings.append('Margins are too tight (' + ', '.join(f"{k} {page_margins[k]} in" for k in tight) + '). Keep every margin '
                                'at least 0.4 in; undo the last squeeze and cut content instead.')
        text_pt, exact = smallest_text_size(pdf)
        if text_pt is not None and text_pt < 8.95:
            warnings.append(f"Some text is {'about ' if not exact else ''}{text_pt}pt, below the 9pt minimum. Many templates set bullets one "
                            'size smaller than the document size, so check the actual text, not just the class option. Undo the font '
                            "change and cut content instead (if the master itself uses this size, it's the template's choice; leave it).")

        out = os.path.abspath(a.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        replaced = None
        if os.path.exists(out):
            old_dir = os.path.join(os.path.dirname(out), '_old')
            os.makedirs(old_dir, exist_ok=True)
            base, ext = os.path.splitext(os.path.basename(out))
            replaced = os.path.join(old_dir, f"{base}-{time.strftime('%Y%m%d-%H%M%S')}{ext}")
            shutil.move(out, replaced)
        shutil.copyfile(pdf, out)
        print(json.dumps({'ok': not over, 'pdf': out, 'engine': engine, 'pages': pages, 'max_pages': a.max_pages,
                          'lines_over': extra_lines, 'page_fill': fill, 'free_lines': free, 'margins_in': page_margins,
                          'smallest_text_pt': text_pt,
                          'missing_text': missing_text, 'warnings': warnings, 'previous_version_moved_to': replaced}, indent=1))
        return 2 if over else 0
    finally:
        shutil.rmtree(build, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
