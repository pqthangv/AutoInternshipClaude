# Tailoring a student resume to an internship

The goal is one page where a recruiter skimming for 10 seconds, and an applicant tracking system scanning for keywords, both see that this student has worked with what the internship needs: in classes, projects, research, jobs or clubs. You get there by choosing, ordering and rewriting, never by adding facts. Every line has to be something the student can talk about confidently in an interview, because internship interviews dig into exactly these projects.

## How to tailor: three passes

Choosing which projects to keep is only the start. A resume that keeps the master's bullets word for word reads the same for every job: early versions of this skill copied 96% of bullets unchanged, and every application got nearly the same page. So every tailoring does all three passes:

1. **Read the posting for its angle.** Before touching the resume, write down (for yourself) the three to five things this team will judge the user on, from the responsibilities, the requirements and what the team builds. For example: "backend services in Java, SQL, testing, working with product teams". Note the posting's exact words for each, since those are what recruiters search for.
2. **Choose and order** what goes on the page (sections below): the entries that best show those things, strongest first.
3. **Rewrite every kept bullet for that angle** (next section). This is the pass that makes it tailored.

Then check it: `compare_bullets.py` (SKILL.md step 3) shows how many bullets are still word for word. When more than about half are, go back to pass 3. The exception is a posting whose language already matches the master's; say so in changes.md.

## Rewrite every kept bullet

A master entry usually holds several facts: what was built, the tools, the user's part, tests, deployment, users, speed. Each posting cares about different ones. For each kept bullet:

- **Decide its job:** which of the posting's three to five things it proves.
- **Lead with that:** the action and the posting's word for the skill, if it's true to what the user did ("Wrote REST endpoints in Flask" for a backend role, "Built the drag-and-drop schedule view in React" for a frontend one).
- **Pull the matching facts forward.** Pick and order the facts from that entry the posting cares about. You may merge two bullets from the same entry, or split one, as long as every fact comes from the master.
- **End with the master's result** (users, numbers, speed) when it has one.
- **Keep it word for word only when it already leads with what this posting wants.**

The same project, rewritten for four roles, using only facts from its master bullets ("Built a course planner web app in React and Flask used by 300 students"; "Wrote SQL queries to load 1,200 courses from the public catalog into SQLite"; "Added 85 unit tests with pytest and set up GitHub Actions to run them on every pull request"; "Designed the drag-and-drop schedule view and made it work on phones"):

| Role | Rewritten bullet |
|---|---|
| Backend | Built the Flask and SQLite back end of a course planner used by 300 students, with SQL queries loading 1,200 catalog courses |
| Frontend | Designed the drag-and-drop schedule view in React and made it work on phones, for a course planner used by 300 students |
| Testing / DevOps | Set up GitHub Actions to run 85 pytest unit tests on every pull request for a React and Flask app used by 300 students |
| Data | Wrote SQL queries to load 1,200 courses from the public catalog into SQLite, the data behind a planner used by 300 students |

"Back end" in the first row is only fine if the master shows the user worked on that part. When the master just says "Built ... in React and Flask" for a solo project, it does; for a team project, check the master for the user's part first.

Two versions for different roles should read differently. If you'd send the same lines to a backend team and a mobile team, it isn't tailored yet.

## Page and section order

- One page, always, filled to the bottom when the master has enough for it (see "Filling the page"). Use the master's margins and font size; never shrink them to fit.
- Education stays at the top while the user is a student.
- After Education, put whichever of Experience or Projects is stronger evidence for this internship. A student whose best match is a class project should lead with Projects. Keep the master's section names.
- Leadership and activities, then Skills, at the end. Drop a section only if nothing in it is relevant and space is needed.

## Awards and honors: lowest priority

The user's view, and what recruiters generally skim past: awards, honors, scholarships and Dean's List lines carry little weight on an internship resume compared with what the student built and did. So:

- Never move them up, and never give them space a project, job or skill could use.
- They're the first thing cut when the page runs long, before any project or experience bullet.
- If an award came from real work (a hackathon prize, a competition result), show the work instead: put the project in Projects and mention the result in one of its bullets ("won 2nd place at HackDavis"), rather than keeping a separate award line.
- If the master has an Awards or Honors section and there's room after everything relevant, keep at most one line from it, placed last.
- In Education, an honors note (for example "Dean's List") can stay only if the line has room for it; drop it before shortening anything else.

When picking what to keep for a long master, leave awards out of the first selection entirely.

## Trimming to one page

The master can be any length, and may grow to several pages as the user adds to it.

**When the master is more than about two pages, select instead of cutting.** Start the tailored copy from what to keep, not from everything: the header, the education entry and coursework line, the two to four projects and the experience entries that best match the posting (with their most relevant bullets), one or two activities if they fit, and the skills section. Build it, then adjust: if the build reports 2 or more `free_lines`, add back as in "Filling the page" below; if it's over, trim as below. Choosing first is much faster than deleting most of a long document, and it keeps the focus on the posting.

`ats_check.py` will list more keywords under `in_master_not_resume` as the master grows. That's expected: bring back the ones that matter most for this posting while staying on one page, and leave the rest.

**When the build reports `lines_over`**, cut about that many lines in one pass, in this order, then build again:

1. Awards, honors, scholarships and Dean's List lines (keep at most one, last, and only if everything relevant already fits).
2. Projects, bullets and activities that show nothing the posting asks for.
3. Third and later bullets on less relevant entries.
4. Older or unrelated part-time jobs down to one bullet (keep the entry; it shows reliability).
5. Activities beyond the one or two most relevant.
6. The coursework line down to the four most relevant courses.
7. Long bullets shortened to one line, keeping every fact and number.

Never cut the name and contact line, the education entry (school, degree, major, graduation date, and GPA if the master shows it), or the strongest match for the posting.

**Squeezing a little, when it's worth it.** Cut low-value content first (the trim order above, awards first). But when only a few lines are still over (about six or fewer) and the next thing you'd have to cut is a strong match for the posting, such as a project using exactly the tools it asks for, keep it and make room instead, in this order, rebuilding after each step and stopping as soon as it fits:

1. **Tighten wording.** Remove filler ("responsible for", "various", "in order to"), and shorten any bullet whose second line holds only a few words so it fits on one line. Keep every fact and number.
2. **Reduce padding.** Make small cuts to spacing: a point or two less in the template's `\vspace` values, list spacing (`itemsep`, `topsep`), and space around section headings. Change only the numbers in existing commands; don't restructure them.
3. **Narrow the margins**, but never below 0.4 inch on any side.
4. **Font size, last resort:** the smallest reduction that fits, and no text below 9pt (exactly 9pt is fine). Many templates set bullets one size smaller than the document's font option (`\small`), so an `11pt` document may already have 10pt bullets, and switching it to `10pt` makes them 9pt. Go by the actual text size the build reports (`smallest_text_pt`), not the class option. For sizes `article` doesn't offer, such as 9pt, switch the copy to `extarticle` with the same options.

Then look at the rendered page: it must still be easy to skim, with entries and sections clearly separated. If squeezing within these limits doesn't make it fit, or the page starts to look cramped, undo the squeeze and cut the next item instead. The build reports the margins and the smallest text size, and warns if either goes past these limits. Mention any squeeze in changes.md (for example "reduced spacing slightly to keep the Course Planner project").

## Filling the page

Empty lines at the bottom are evidence the user has but the recruiter never sees. Early tailored versions stopped 6 to 11 lines short of the bottom while their projects sat at one or two bullets and the master had more. So the page is done when its last line is within about a line of the bottom margin, or when nothing left in the master fits the posting.

The build reports `free_lines`: about how many lines are still empty at the bottom. At 2 or more, add about that many lines (a two-line bullet counts as two) in this order, then build again:

1. **More bullets on the entries you kept**, most relevant entry first. They were chosen for this posting, so their other master bullets are the safest additions. Aim for three or four bullets on the top one or two projects and the main internship, and at least two on every other kept entry.
2. **Split merges made only for space.** If you merged two master bullets to save a line, give each its own bullet again.
3. **The next most relevant project or experience** you left out.
4. **Keywords the user really has**: more courses in the coursework line, and skills the ATS check lists under `in_master_not_resume`, once you've run it.
5. **One more activity**, if it shows something the posting asks for, such as teamwork, leadership or communication.
6. **Awards last**: at most one line (see "Awards and honors").

Every addition goes through the rewrite pass like the rest, so it points at this posting's angle and `compare_bullets.py` still passes. If a build spills onto page 2, take back the last addition or shorten a bullet to one line. Never pad with unrelated material, repeat a fact in two places, or stretch the spacing to fill. If you stop with 2 or more lines free, say why on the Page line in changes.md.

## Education

- Keep school, degree, major, minor and expected graduation exactly as in the master ("Expected May 2028").
- GPA: keep it if the master shows it. Never round (3.67 stays 3.67) or change the scale. If the posting requires a GPA and the master omits it but the profile has it, add it in the master's format.
- Relevant coursework: choose the four to six courses that best match the posting, most relevant first, using the course names the master uses. Only courses the user has taken or is taking.
- Honors and awards keep their exact wording if they stay, but they're the first thing to drop for space (see "Awards and honors" above).

## Projects

Projects are often the strongest evidence a student has.

- Choose the two to four projects that best match the posting. Leave out ones that show nothing it asks for.
- In each project's heading, list the tools the posting mentions first, but only tools the project really used.
- Three or four bullets on the strongest one or two projects, and at least two on each of the others; one only when the page is truly full. Each is rewritten for this posting (see "Rewrite every kept bullet"): what was built, the user's part, and a result if the master has one (users, scale, speed, accuracy). The first bullet should show the project's strongest link to the posting.
- Group and class projects: describe the user's own part ("Implemented the prerequisite checker for a 4-person class project"), never the team's whole result as if it were theirs. Labeling something a class project is fine; recruiters expect it.

## Experience

- Internships, research and technical jobs: order bullets by relevance to the posting, and rewrite them to lead with its vocabulary wherever that's true to what the user did (see "Rewrite every kept bullet").
- Part-time and campus jobs (retail, food service, tutoring, campus IT): keep one or two bullets showing transferable skills the posting asks for, such as communication, working under time pressure, training others or handling money. Don't drop these entirely for a student with little other experience; they show reliability.

## Skills

Put the posting's languages and tools first. Group them the way the master does. No proficiency bars or ratings. Remove skills irrelevant to this internship if space is tight. Never add one the user doesn't have, not even "familiar with" or "currently learning", unless that wording is in the master.

## What you may not change

- Titles, including club and research titles, organization names, dates and locations.
- Any number: GPA, user counts, percentages, team sizes, hours. No rounding up, no combining.
- School, degree, major, minor, course names and graduation date.
- Contact details.
- Scope: "contributed to" doesn't become "led", "helped build" doesn't become "built", a class project doesn't become a product.

If the posting wants something the user doesn't have, it goes in the gaps list in changes.md, never on the resume.

## Mapping vocabulary honestly

Rewording is expected; these are its limits. The test: would the user's professor, teammate or manager read the new line and agree it describes what they did?

`check_resume.py` flags words the master doesn't contain. When a flagged word is the posting's term for something the master shows (for example "REST API" for a master bullet about Flask endpoints), it's a fair rewording: keep it and list it under "Reworded" in changes.md. When it names a tool, number or responsibility the master doesn't have, remove it.

| Master says | Posting asks for | Good | Not allowed |
|---|---|---|---|
| Built a to-do app in React for a class | Front-end development | Built a task-tracking web app in React (course project) | Built production React applications |
| Cleaned survey data in pandas for a lab study | Data analysis | Cleaned and analyzed survey data in Python (pandas) for a research study | Performed statistical modeling on survey data |
| Group project: 4 students built a movie recommender; user did the data prep | Machine learning | Prepared and cleaned the training data for a 4-person movie recommendation project | Built a movie recommendation model |
| Barista, trained 3 new hires | Communication, teamwork | Trained 3 new baristas and served 150+ customers per shift | Managed a team of baristas |
| Took Probability and Statistics | Statistics | (in the coursework line) Probability and Statistics | Applied statistics in a professional setting |

Synonyms are fine. Upgrades in seniority, ownership, tools or results are not.

## Bullet shape

Lead with the action and the skill the posting cares about; end with the result if the master has one:

- Before: "Was in charge of the database part of our group project, which loaded the course catalog"
- After: "Wrote SQL queries to load 1,200 courses from the public catalog into SQLite"

Only reshape like this when the facts in both versions are the same; the "1,200" has to come from the master.

## Keeping it readable by applicant tracking systems

Most applications pass through an applicant tracking system (ATS) before a person sees them. It pulls the text out of the PDF, splits it into sections, and recruiters search it by keyword. A resume that looks perfect can still parse badly, so:

- One column. Don't add tables, columns, text boxes, images, icons, or headers and footers holding key information. The template's own alignment for dates and locations is fine.
- Keep standard section names (Education, Experience, Projects, Skills). An ATS may not recognize creative ones like "Stuff I Built".
- Contact details as plain text in the body, under the name, including links written out (linkedin.com/in/...), not icons alone.
- Keep dates in the master's format, consistently.
- Never hide keywords in white or tiny text. Systems detect it and recruiters reject it.

**Keywords.** Recruiters search for the posting's own terms, so where the user really has the skill, use the posting's exact wording: "SQL" if it says SQL, "data visualization" if it says that and the user built charts. `ats_check.py` lists which posting keywords the resume shows, which ones the user has in the master but this version leaves out (bring those back where they fit), and which the user doesn't have (gaps; never add them, not even in the skills list).

`ats_check.py` also catches problems you can't see on the page: the name not readable as text, ligature characters that break matching ("eﬃcient" won't match "efficient"), words running together, two-column layouts, and fonts that aren't embedded. Fix those before saving.

If the master itself uses a two-column or icon-heavy template, keep its look in the tailored version, but tell the user once that a single-column template parses more reliably.

## changes.md

```
# Tailoring notes: Role at Company

## Angle
<the three to five things this posting judges on, in its own words>

## What changed
- Coursework: led with <courses> (posting asks for <requirement>).
- Projects: moved <project> to the top; dropped <project> for space.
- Skills: put <tools> first.
- Page: filled to the bottom. (Or: <N> lines free, because <nothing else in the master fits this posting>.)

## Reworded
- <master bullet> → <tailored bullet> (why: <which part of the angle it shows>)
- <master bullet> + <master bullet> → <merged bullet>
(From compare_bullets.py: every bullet marked reworded or merged. Unchanged ones aren't listed.)

## Requirements covered
- <requirement>: <where it shows on the resume>

## ATS keywords
- Covered: <keywords from the posting that the resume shows>
- Gaps: <posting keywords the user doesn't have>

## Gaps
- <requirement>: not on the resume. One way to address it: <cover letter line, interview example, a short project or course before the interview>.
```

Keep it short. The user reads it to decide whether to trust this version, and the Reworded list lets them check each changed line against the master at a glance.
