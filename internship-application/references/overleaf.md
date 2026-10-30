# Tailoring an Overleaf (LaTeX) resume

The master lives in the job-search folder under `resume/`, downloaded from Overleaf with Menu → Download → Source and unzipped. Never edit the master itself. Copy it into your scratch space, tailor and build the copy there, and only after it passes the checks in SKILL.md, copy the PDF and the tailored source (as `resume-src/`) into the job folder. That way the user's folder only ever receives finished files, and each application keeps the exact source that produced its PDF.

## Find the main file

It's the .tex file containing `\documentclass`. If several do, prefer `main.tex`, then the one named like a resume. Files pulled in with `\input` or `\include` are part of the resume too; edit them in the copy the same way.

## Edit only the words

Resume templates define their own commands in the preamble (everything before `\begin{document}`), for example `\resumeItem{...}`, `\resumeSubheading{title}{dates}{organization}{location}` or `\resumeProjectHeading{...}{date}`. The layout lives in those definitions, so:

- Leave the preamble and every `\newcommand` definition alone, apart from the spacing numbers you may adjust when squeezing (see "Squeezing a little" in tailoring.md), and one more exception: if the document compiles with pdflatex and the preamble lacks `\input{glyphtounicode}` and `\pdfgentounicode=1`, add both to the copy. They change nothing visible and make the text extract correctly for applicant tracking systems.
- Change only the text inside the arguments of the template's commands and plain text in the body.
- Reorder by moving whole items: one `\resumeItem{...}` line, or a whole heading with its item list. Trim by deleting whole items. Keep every `{` matched with its `}`.
- Keep the master's conventions: its date style (`Jan 2026 -- Present`), separators (`$|$`), capitalization and bold or italic usage.
- Lines starting with `%` are comments. Students often keep old bullets commented out; those are the user's own material, so you may uncomment one if it fits this internship better than what's showing.

## Escape special characters in anything you write

LaTeX treats these characters as commands. Unescaped, they break the build or, worse, silently hide text.

| Write | As | Example |
|---|---|---|
| & | `\&` | R\&D |
| % | `\%` | cut load time 40\% |
| $ | `\$` | \$5K budget |
| # | `\#` | C\# |
| _ | `\_` | snake\_case |
| { } | `\{ \}` | |
| ~ | `\textasciitilde{}` | |
| ^ | `\textasciicircum{}` | |

An unescaped `%` is the dangerous one: it comments out the rest of the line, so a bullet loses its ending and the closing brace, and the build fails far from the real mistake. `C++`, `/`, `-` and `.` are fine as they are. Copy the master's way of writing quotes and dashes.

## Build and check

```
python scripts/build_resume.py "<scratch>/<main>.tex" --out "<scratch>/Firstname_Lastname_Resume_Company.pdf" --max-pages 1 --expect "<Full Name>" --expect "Education"
```

Add one or two `--expect` phrases you just added, so you know they made it into the PDF's text. The script prints JSON and exits with:

- **0, built.** Check `warnings`. Lines running past the margin mean a new line is too long; shorten it. If `missing_text` lists your expected phrases, the PDF's text layer is broken and tracking systems won't read it: for pdflatex, make sure the preamble has `\input{glyphtounicode}` and `\pdfgentounicode=1`, adding them to the copy if not.
- **1, compile error.** Read `errors`, `suspect_lines` and `hints`. It's almost always a special character or a brace in text you added. Fix and build again. After three failed tries, undo your last round of edits and build that instead, then tell the user what you couldn't change.
- **2, too long.** `lines_over` says roughly how many lines spill past page one. Cut low-value content first, following "Trimming to one page" in tailoring.md. If only a few lines remain over and the next item is a strong match for the posting, squeeze instead, within the limits in tailoring.md. Then build again. If the result warns that margins are too tight or text is below 9pt, undo the last squeeze.
- **Space at the bottom** (exit 0, `free_lines` of 2 or more, and a warning): add about that many lines from the master, following "Filling the page" in tailoring.md, and build again. Leave the space only when nothing else in the master fits the posting, and say so in changes.md.
- **3, no LaTeX here.** Fact-check the tailored .tex against the master with `check_resume.py`, save it to the job folder as `resume-src/`, and tell the user to compile it in Overleaf: zip the resume-src folder and use New Project → Upload Project, or paste the changed lines into a copy of their project. Keep filling the rest of the application, leave the resume upload for the user, and log the row with status `Needs you` and next step "compile resume in Overleaf, then attach".

If the error is a missing package or font that's not in the project folder (for example fontawesome5 icons), treat it like exit 3: the user's Overleaf has it even when this machine doesn't.

After a successful build, run `ats_check.py` as described in SKILL.md step 3.

## Keeping a copy in Overleaf

The user doesn't need to, since the PDF and its source are in the job folder. If a build you already saved turns out wrong, rebuild in scratch and save again: build_resume.py moves the older PDF into `_old/` instead of overwriting or deleting it. If they want the tailored version in Overleaf too, zip resume-src and upload it with New Project → Upload Project.
