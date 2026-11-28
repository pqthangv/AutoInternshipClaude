# Tailoring a student resume to an internship

Make one page that shows, to a recruiter skimming and to an applicant tracking system (ATS) searching keywords, that the student has worked with what the internship needs. Choose, order and rewrite; never add facts. Every line must be something the student can discuss in an interview.

Work only from the master resume: never open resumes, resume-src, cover letters or changes.md in other job folders.

## Three passes

1. **Read the posting for its angle.** Write down (for yourself) the three to five things this team will judge the user on, with the posting's exact words for each. For example: "backend services in Java, SQL, testing, working with product teams".
2. **Choose and order** what goes on the page (sections below): the entries that best show those things, strongest first.
3. **Rewrite every kept bullet for that angle** (next section).

When `check_tailored.py` says more than about half the bullets are still word for word, redo pass 3, unless the posting's language already matches the master's (say so in changes.md).

## Rewrite every kept bullet

For each kept bullet:

- **Decide its job:** which of the three to five things it proves.
- **Lead with that:** the action and the posting's word for the skill, if true to what the user did ("Wrote REST endpoints in Flask" for a backend role, "Built the drag-and-drop schedule view in React" for a frontend one).
- **Pull the matching facts forward** from that entry. You may merge two bullets from the same entry or split one, as long as every fact comes from the master and the entry keeps two bullets ("Bullets per entry").
- **End with the master's result** (users, numbers, speed) when it has one.
- **Keep it word for word only when it already leads with what this posting wants.**

One project rewritten for four roles, using only facts from its master bullets ("Built a course planner web app in React and Flask used by 300 students"; "Wrote SQL queries to load 1,200 courses from the public catalog into SQLite"; "Added 85 unit tests with pytest and set up GitHub Actions to run them on every pull request"; "Designed the drag-and-drop schedule view and made it work on phones"):

| Role | Rewritten bullet |
|---|---|
| Backend | Built the Flask and SQLite back end of a course planner used by 300 students, with SQL queries loading 1,200 catalog courses |
| Frontend | Designed the drag-and-drop schedule view in React and made it work on phones, for a course planner used by 300 students |
| Testing / DevOps | Set up GitHub Actions to run 85 pytest unit tests on every pull request for a React and Flask app used by 300 students |
| Data | Wrote SQL queries to load 1,200 courses from the public catalog into SQLite, the data behind a planner used by 300 students |

"Back end" in the first row needs the master to show the user worked on that part: fine for a solo project; for a team project, check the user's part first.

Versions for different roles must read differently.

## Page and section order

- One page, always, filled to the bottom when the master has enough ("Filling the page"). Use the master's margins and font size unless squeezing (below).
- Education at the top while the user is a student.
- Then whichever of Experience or Projects is stronger evidence for this internship. Keep the master's section names.
- Leadership and activities, then Skills, at the end. Drop a section only if nothing in it is relevant and space is needed.

## Bullets per entry

- Every job, project, research role and activity on the page has at least two bullets, unless the master gives it one. Education, awards, honors and skills don't count.
- The second bullet comes from another of that entry's master bullets, never from splitting one bullet in two.
- When an entry's two bullets don't fit, drop the whole entry. A research role stays, and so does a part-time job for a student with little other experience: make room elsewhere. A section goes with its last entry.
- A line or two free at the bottom is better than an entry with one bullet: never add an entry you can give only one. A leftover line goes to a kept entry (a longer bullet or a third one); with nothing to add, say why on the Page line in changes.md.

## Awards and honors: lowest priority

- Never move them up or give them space a project, job or skill could use.
- They're cut first when the page runs long.
- For an award from real work (a hackathon prize, a competition result), put the project in Projects and mention the result in a bullet ("won 2nd place at HackDavis") instead of an award line.
- With room after everything relevant, keep at most one line from an Awards or Honors section, placed last.
- An honors note in Education ("Dean's List") stays only if its line has room.

## Trimming to one page

**For a master over about two pages, select instead of cutting.** Start the copy from what to keep: header, education entry and coursework line, the two to four best-matching projects and experience entries (with their most relevant bullets, at least two each), any research role (see "Experience"), one or two activities if they fit (two bullets each), and skills. Leave awards out of this first selection. Build, then add back ("Filling the page") or trim (below).

The check lists master keywords missing from this page; bring back the ones that matter most while staying on one page.

**When the build reports `lines_over`**, cut about that many lines in one pass, in this order, then build again:

1. Awards, honors, scholarships and Dean's List lines (keep at most one, last).
2. Projects, activities and bullets that show nothing the posting asks for.
3. Third and later bullets on less relevant entries.
4. Older or unrelated part-time jobs and research roles down to two bullets (keep the entry).
5. Activities beyond the one or two most relevant.
6. The coursework line down to the four most relevant courses.
7. Long bullets shortened to one line, keeping every fact and number.
8. The least relevant project beyond the top two, or the last activity: the whole entry.

No cut leaves an entry with one bullet ("Bullets per entry").

Never cut the name and contact line, the education entry (school, degree, major, graduation date, and GPA if the master shows it), or the strongest match for the posting.

**Squeezing.** When about six or fewer lines are over and the next cut would be a strong match (a project using exactly the tools the posting asks for), keep it and make room instead, rebuilding after each step and stopping once it fits:

1. **Tighten wording.** Remove filler ("responsible for", "various", "in order to"); shorten a bullet whose second line holds only a few words. Keep every fact and number.
2. **Reduce padding.** A point or two less in the template's `\vspace` values, list spacing (`itemsep`, `topsep`) and space around headings. Change only numbers in existing commands.
3. **Narrow the margins**, never below 0.4 inch.
4. **Font size, last resort:** the smallest reduction that fits; no text below 9pt (exactly 9pt is fine). Go by the build's `smallest_text_pt`, not the class option (`\small` bullets in an `11pt` document are already 10pt). For sizes `article` doesn't offer, such as 9pt, switch the copy to `extarticle` with the same options.

Then check the rendered page is still easy to skim. If it doesn't fit within these limits or looks cramped, undo the squeeze and cut the next item. Mention any squeeze in changes.md ("reduced spacing slightly to keep the Course Planner project").

## Filling the page

The page is done when its last line is within about a line of the bottom margin, or nothing left in the master fits the posting, or the only addition left would be an entry with one bullet. At 2 or more `free_lines`, add about that many lines (a two-line bullet counts as two) in this order, then build again:

1. **More bullets on the entries you kept**, most relevant first: three or four on the top one or two projects and the main internship, at least two on every other kept entry.
2. **Split merges made only for space.**
3. **The next most relevant project or experience** you left out, with two bullets.
4. **Keywords the user really has**: more courses in the coursework line; skills the ATS check lists under `in_master_not_resume`.
5. **One more activity** with two bullets, if it shows something the posting asks for (teamwork, leadership, communication).
6. **Awards last**: at most one line.

Every addition goes through the rewrite pass. If a build spills onto page 2, take back the last addition or shorten a bullet. Never pad with unrelated material, repeat a fact, or stretch spacing. If you stop with 2 or more lines free, say why on the Page line in changes.md.

## Education

- School, degree, major, minor and expected graduation exactly as in the master ("Expected May 2028").
- GPA: keep it if the master shows it; never round (3.67 stays 3.67) or change the scale. If the posting requires a GPA, the master omits it and the profile has it, add it in the master's format.
- Relevant coursework: the four to six courses that best match, most relevant first, with the master's course names; only courses taken or in progress.
- Bullets under a school never give a school's full name (with "University", "College", "Institute" or "School"): "Representing Northwind at the 2026 ICPC", not "Representing Northwind University at the 2026 ICPC". Apart from that, honors keep their exact wording if they stay.

## Projects

- The two to four projects that best match the posting.
- In each heading, list the tools the posting mentions first, only tools the project used.
- Three or four bullets on the strongest one or two, at least two on the others ("Bullets per entry"). The first bullet shows the project's strongest link to the posting.
- Group and class projects: the user's own part ("Implemented the prerequisite checker for a 4-person class project"), never the team's result as theirs. Labeling a class project is fine.

## Experience

- Internships, research and technical jobs: order bullets by relevance and rewrite them to lead with the posting's vocabulary where true.
- Research roles (student researcher, research assistant, lab member): keep the entry on every version, with two bullets. When its work also appears as projects, the first says what those don't: the program or lab, how long, outputs (papers, reports, presentations, awards). The second is work of the role that no kept project shows; if a kept project shows all of it, take that fact out of the project instead. No fact appears twice.
- Part-time and campus jobs (retail, food service, tutoring, campus IT): keep two bullets on skills the posting asks for (communication, time pressure, training others, handling money). Don't drop them for a student with little other experience.

## Skills

The posting's languages and tools first, grouped as in the master. No proficiency bars or ratings. Remove irrelevant skills if space is tight. Never add one the user doesn't have, not even "familiar with" or "currently learning", unless the master says so.

## What you may not change

- Titles (club and research titles too), organization names, dates and locations.
- Any number: GPA, user counts, percentages, team sizes, hours. No rounding up, no combining.
- School, degree, major, minor, course names, graduation date.
- Contact details.
- Scope: "contributed to" doesn't become "led", "helped build" doesn't become "built", a class project doesn't become a product.

What the posting wants and the user doesn't have goes in the gaps list in changes.md, never on the resume.

## Mapping vocabulary honestly

Test: would the user's professor, teammate or manager agree the new line describes what they did? A flagged term that is the posting's word for something the master shows ("REST API" for Flask endpoints) is fair: keep it. A tool, number or responsibility the master doesn't have: remove it.

| Master says | Posting asks for | Good | Not allowed |
|---|---|---|---|
| Built a to-do app in React for a class | Front-end development | Built a task-tracking web app in React (course project) | Built production React applications |
| Cleaned survey data in pandas for a lab study | Data analysis | Cleaned and analyzed survey data in Python (pandas) for a research study | Performed statistical modeling on survey data |
| Group project: 4 students built a movie recommender; user did the data prep | Machine learning | Prepared and cleaned the training data for a 4-person movie recommendation project | Built a movie recommendation model |
| Barista, trained 3 new hires | Communication, teamwork | Trained 3 new baristas and served 150+ customers per shift | Managed a team of baristas |
| Took Probability and Statistics | Statistics | (in the coursework line) Probability and Statistics | Applied statistics in a professional setting |

Synonyms are fine. Upgrades in seniority, ownership, tools or results are not.

## Bullet shape

Lead with the action and the skill; end with the result if the master has one:

- Before: "Was in charge of the database part of our group project, which loaded the course catalog"
- After: "Wrote SQL queries to load 1,200 courses from the public catalog into SQLite"

The facts must match; the "1,200" comes from the master.

## Keeping it readable by applicant tracking systems

- One column. No added tables, columns, text boxes, images, icons, or headers and footers holding key information. The template's own alignment for dates and locations is fine.
- Standard section names (Education, Experience, Projects, Skills).
- Contact details as plain text under the name, links written out (linkedin.com/in/...).
- Dates in the master's format, consistently.
- Never hide keywords in white or tiny text.

**Keywords.** Where the user really has the skill, use the posting's exact wording ("SQL", "data visualization"). `ats_check.py` lists the posting keywords the resume shows, the ones in the master this version leaves out (bring those back where they fit), and the ones the user doesn't have (gaps; never add them, not even in skills). It also catches the name not readable as text, ligatures ("eﬃcient" won't match "efficient"), words running together, two-column layouts and fonts not embedded: fix those before saving. A two-column flag on a page with one column is wrong: note it in changes.md and change nothing. Never cut content to clear a layout flag.

If the master uses a two-column or icon-heavy template, keep its look, and tell the user once that a single-column template parses more reliably.

## changes.md

`check_tailored.py` writes this file beside the PDF with the title, the Page line and the Reworded list filled in. Replace each `<...>` slot with Edit (the angle, what changed, the requirements covered, the ATS keywords and the gaps) and leave the rest as written. Take the keywords from the check's `keywords` lists, skills and technical terms only, not their form, benefits or place words.

```
# Tailoring notes: Role at Company

## Angle
<the three to five things this posting judges on, in its own words>

## What changed
- Coursework: led with <courses> (posting asks for <requirement>).
- Projects: moved <project> to the top; dropped <project> for space.
- Experience: kept <entries>; cut <entry> to <N> bullets (or dropped it), because <reason>.
- Skills: put <tools> first.
- Page: filled to the bottom. (Or: <N> lines free, because <nothing else in the master fits this posting>.)

## Reworded
- <master bullet> → <tailored bullet>
- <master bullet> + <master bullet> → <merged bullet>

## Requirements covered
- <requirement>: <where it shows on the resume>

## ATS keywords
- Covered: <posting skills and terms the page shows>
- Gaps: <posting skills the user doesn't have>

## Gaps
- <requirement>: not on the resume. One way to address it: <cover letter line, interview example, a short project or course before the interview>.
```

Keep it short.

## Cover letter

Write one when job-posting.md's `Cover letter:` line says `required`, `optional`, `asked` or `unknown`, and for a posting read in the browser, except on Workday when the posting doesn't ask for one. Skip it for `none` and `not wanted`.

- Plain text, under 250 words, from the greeting ("Dear Northwind hiring team,") to the sign-off ("Sincerely," with the user's name on the next line), paragraphs separated by a blank line. No header: the build adds the name, contact details, date and company.
- Three or four short paragraphs: the role and why this company and team, in the posting's words; one or two pieces of evidence from the master (the user's own part, the master's numbers); what the user hopes to learn; availability (`availableFrom` to `availableUntil`).
- Do what the posting asks of the letter (the sentence quoted on the `Cover letter:` line), such as naming the role or answering its questions.
- Facts only from the master and profile, as on the resume ("What you may not change"). A skill the posting asks for and the master doesn't show stays out.
- In the user's `writingStyle`, following any `extraRules`.

Write it with the Write tool as `<scratch>/cover-letter.txt`, then build and check it:

```
python scripts/cover_letter.py "<scratch>/cover-letter.txt" --profile "<folder>/profile.json" --master "<master>" --company "<Company>" --role "<Role>" --posting "<job folder>/job-posting.md" --out "<scratch>/Firstname_Lastname_Cover_Letter_Company.pdf"
```

- Change everything under `fix`, and handle each `review` item: a term from the posting may name the company's work, never a skill of the user's. Repeat until `fix` is empty.
- For `asked`, also pass `--combine "<scratch>/Firstname_Lastname_Resume_Company.pdf"` (the checked resume). It writes `Firstname_Lastname_Resume_and_Cover_Letter_Company.pdf`, resume first, for a form with one upload box.
- Exit 3 (no LaTeX here): make the same letter as `Firstname_Lastname_Cover_Letter_Company.docx` with the docx skill.
- Save: copy the letter (and the combined PDF) and `cover-letter.txt` into the job folder. First move an earlier letter there into `_old/`, with the date and time in its name.
