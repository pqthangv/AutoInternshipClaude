# Interview prep

The point of this document is that the user walks in knowing exactly what the company has seen from them, with true stories ready for the likely questions. Interviewers read the resume and written answers right before the call, and they ask about them. So everything here comes from what the user actually sent and actually did.

## Read first

1. The job folder: `job-posting.md`, `application-record.md` (including any changes before submitting and the timeline), `changes.md`, the resume PDF that was sent (or `resume-src/`), and the cover letter if any.
2. The master resume and profile.json, for facts the tailored version left out but the user can still talk about.
3. What the user told you about the interview: date, time and time zone, format (phone, video, on-site), who they'll meet, and the round (recruiter screen, technical, behavioral, final). If you don't know the round, write for a mix and say so at the top.
4. If web search is available, a quick look at the company and team: what they make, and one or two recent news items. Keep sources as links. Skip this if there's no web access rather than guessing.

## Rules

- **No invented facts.** Stories, numbers, tools and outcomes come only from the resume sent, the master, the profile or the application record. Where a good answer needs a detail only the user knows (the hardest bug, what a teammate said), write `[Fill in: ...]` instead of making it up.
- **Consistency matters most.** Anything the user wrote on the application can be quoted back to them. Show their written answers word for word, so they can stay consistent with them.
- **Everything on the resume sent is fair game**, including the shortest bullet. Make sure each line has something ready behind it.
- Keep the whole document readable in about 15 minutes.

## Before saving

Draft in scratch space. Then fact-check against the user's own material, allowing the company, role and interviewer names:

```
python scripts/check_resume.py "<master resume>" "<scratch>/interview-prep.md" --known "<folder>/profile.json" --known "<job folder>/application-record.md" --allow "<Company>" --allow "<Role>" --allow "<Interviewer>"
```

Company research brings in new names and numbers, which is expected. Check every flag in the stories and intro sections, and remove anything that isn't the user's real experience. Then save `interview-prep.md` in the job folder. If an older one exists, move it into `_old/` first.

## Document layout

```
# Interview prep: Role at Company

**Interview:** <date, time and time zone>, <format>, with <whom>, <round>

## The role in brief
3 to 5 bullets: what the team does, what the intern will work on, the posting's main requirements.

## The company in brief
2 to 4 bullets, with links for anything from the web.

## What they've seen from you
- Resume sent: <file name>. The lines most likely to come up: <3 to 5 bullets that match the posting best>.
- Your written answers: <each question, then the answer word for word>.
- Cover letter: <its main points, or "none">.

## Your 30-second introduction
A short paragraph in the user's voice: year and school, major, one or two relevant experiences or projects, and why this internship. Facts only.

## Your stories
4 to 6 stories, each for a question theme the posting or the round suggests. Common internship themes: a project you're proud of, working on a team or with a disagreement, a challenge or mistake, learning something quickly, why this company.

### <Theme>: <the real project, job or activity it uses>
- **Situation and task:** ...
- **What you did:** ... (the user's own part of group work)
- **Result:** ... (from the resume, or [Fill in: ...])
- **If they dig deeper:** [Fill in: the hardest part, what you'd do differently]

## Project deep dives
For each project on the resume sent: what it does, the user's part, the tools and why they were chosen (or [Fill in: why]), one hard problem, and what they'd improve next.

## Technical topics to review
From the posting's requirements and the tools on the resume sent, list concrete subtopics with one way to practice each. For example: SQL → joins, GROUP BY, window functions; practice by writing three queries against a sample dataset. For coding rounds, say so plainly: data structures and easy-to-medium practice problems in the language they list first.

## Gaps and honest answers
For each gap in changes.md that the interviewer might raise: a truthful answer that names the closest real experience and shows willingness to learn. Never claim the missing skill.

## Questions to ask them
4 to 6 questions specific to this team and role (what an intern's first project usually is, how success is measured, how the team works), not ones the posting already answers.

## Before and after
- Check the time zone, the link or address, and have the resume sent open.
- Within 24 hours after: a short thank-you note. Offer to draft it, using one specific thing from the conversation.
```

After writing it, tell the user where it is, how many `[Fill in: ...]` spots need their input, and offer to run a short practice interview with them in chat.
