# Batch runs: one subagent per posting

Read this when the user asks to work through jobs.txt or gives several links.

Use the subagent tool (Task or Agent, type `general-purpose`). Without one, follow "Without subagents" at the end.

- **Keep this conversation small.** Never fill forms or read form pages here. Your only browser work is making the tab group and, in Submit mode, clicking Submit.
- **Models.** Start filling subagents with the `sonnet` model when your subagent tool lets you choose (steps 4 and 6). Tailoring subagents keep the default model.

## The run

1. **Tidy, fetch and screen the queue**, one call each (SKILL.md, "Batch runs"). Skip postings the tracker already has. Never start a subagent for a posting the screen marks `skip`: the fetch has moved it below `# done` with its reason (for links the user gave instead of jobs.txt, log it as `Skipped`). For a `check`, decide from its `screen_why` lines by SKILL.md step 2, here, and log a skip as `Skipped` with the reason. When too few are left, fetch again with a larger `--limit`. Take the rest in queue order (`--tidy` sorted it, best-known companies first), except that a posting closing within 3 days goes first.

   **At most two per company.** For each company, count its postings in this batch plus its tracker rows added today or yesterday (`in_tracker`, by `date_added`; Skipped rows don't count). Keep at most two: the titles that fit the user best (major, skills, the kind of role they asked for), the earlier deadline on a tie. For a posting the fetch couldn't read, take the company from its jobs.txt note or link. Leave the rest in jobs.txt above `# done`, adding `held: 2 per company` to the line's note if it isn't there yet. If the user asks for more from one company ("all the Northwind roles"), use their number.
2. **Tailor**: one subagent per posting with the tailoring prompt. Start the first one alone and all the rest in your next message (all in one message if your subagent tool waits for each to finish). Postings the fetch couldn't get are read in the browser, so follow "Sharing the browser" for those. Don't read tailoring.md, overleaf.md or the master yourself.
3. **Checkpoint** (step 4) from the summaries, one short block per posting. Read a drafts file only to show its answers, and not at all in auto mode. Add one line for postings held by the company limit (company: roles), so the user can swap one in or say to do them all; in auto mode they stay held.
4. **Fill**: one subagent per application with the filling prompt, all at once, following "Sharing the browser". Start the first one alone, then every other one not queued behind a sign-in in your next message (as in step 2), and each queued one when the form ahead of it replies (or in the next message, if your subagent tool waits for all). If they reply NO BROWSER, fill them all yourself, as in "Without subagents".
5. **Hand-off**: one message for the whole batch: one line per tab (company and role, and what's needed: "sign in to Workday", "attach C:\\...\\Maya_Chen_Resume_Northwind.pdf"), then the questions from every form, grouped so one answer covers every form that asks it. Before sending, check each question against profile.json yourself (every field and `savedAnswers`, by meaning); send the ones it answers straight back to their subagents (step 6) instead of asking. Sponsorship follows filling.md's "Sponsorship" line: a question about this internship only takes `needsSponsorshipForInternship` when it's set, over any saved answer. In Submit mode without auto, also show the written answers the subagents drafted on the form (each record's "Written answers"); send this message even when nothing else needs the user, and wait.
6. **Continue**: when the user is done, run the filling prompt again for each application, all at once as in step 4, with what the user did and their answers. Each continues from its application-record.md in the same tab. Repeat once if new steps came up. When the user changes a rule for the batch ("you can click Save and Continue on Self Identify"), write it into each new filling prompt as a line after `Mode:` ("The user said: ..."); never pass it to a running subagent in a message. Never send a subagent back from Workday's review page to change work entries (filling.md, "Filling the form"); put what's wrong in the report.
7. **Submit** (Submit mode only): do it yourself, never in a subagent. For each application whose check passed (or failed only on check 3, written answers, which the user has since seen and accepted), switch to its tab, confirm it's on the review page, and follow "Submitting" in submitting.md.
8. **Report** once, one line per posting (step 8); for one the site sent early, say what wasn't filled. Move processed links in jobs.txt below `# done`, editing in place. Held postings get one line together at the end ("Held, 2 per company: ...") and stay above `# done`. Postings the screen skipped get one line too ("Skipped by the screen: Company Role (reason), ..."). Save the answers listed under `To save:` to profile.json without asking (`references/profile.md`) and say in one line what you saved. If profile.json changed in this batch, or any reply's `Extension answers:` is lower than its number of `savedAnswers`, add: "In the AutoInternship extension, open the profile page, click **Restore from backup** and choose <folder>/profile.json, so the Fill button uses the new answers." End with one line telling the user to start a new conversation for the next batch.

A posting with a wall the user can't clear in the hand-off (a broken page, a closed posting, an assessment) is `Needs you`; move on.

## Sharing the browser

- **Make the group yourself first.** Before the first subagent that uses the browser, load the browser tools (tool search) and call `tabs_context_mcp` with `createIfEmpty: true`. Keep a tab of yours in the group open until the batch ends.
- **No limit on how many at once**, except the queueing below. If the user asks for a limit, use their number.
- **One at a time per sign-in.** Never run two forms at once on the same account: two on one Workday site (such as `northwind.wd5.myworkdayjobs.com`) or two on one company's careers site. Queue the second behind the first. Greenhouse, Lever and Ashby forms for different companies can run at the same time.
- **If they get in each other's way** (two subagents report failing screenshots, clicks that didn't take, or a missing tab), let the running ones finish, then fill the rest one at a time.
- **If the tab group disappears**, each running subagent stops with `stopped: tab group lost`. Wait for the rest, make the group again, and send each the filling prompt with the third kind of `Tab:` line. Never fill from the start.

## Tailoring prompt

Fill in the `<...>` parts and send only this.

```
You're tailoring one internship application in a batch run by the internship-application skill.
With your file-reading tool, not cat, read <skill>/SKILL.md, the posting and the profile first, and do SKILL.md
steps 1 and 2 for this posting only (the tracker check is already done): create the job folder, save job-posting.md,
check eligibility. If it's a skip, reply now. Otherwise read <skill>/references/tailoring.md (and references/overleaf.md
if the master is .tex) and the master, then do step 3: tailor, check and save the resume, write changes.md, write the
cover letter when tailoring.md's "Cover letter" says (optional fields included), and draft any written answers into
<scratch>/answers/<NN>.md. Read each file once.
Don't open the application form, don't change the tracker, and don't start subagents of your own.
Work only from the master resume: never open resumes, resume-src or changes.md in other job folders.
For a .tex master, never type LaTeX into a shell command, heredoc or script: use the Write and Edit tools (copying files with cp, head or cat is fine).
- Posting: <fetched file> | <link: open it in a new tab of your own, read it, close that tab; pass its id on every browser action and leave other tabs alone>
- Job-search folder: <folder>  Master resume: <path>  Profile: <folder>/profile.json
- Scratch space: <scratch>/<NN>   Today: <YYYY-MM-DD>
- Master template check: <add --check-template | already done, leave it out>
Reply with only these lines:
Posting: <Company> - <Role>, deadline <date or none>
Eligibility: ok | skip: <reason>
Folder: <job folder>
Resume: <PDF file name>; page <filled, or N lines free and why>
Changes: <two or three short lines>
Gaps: <one line>
Cover letter: <file name (and the combined PDF's), or none: the Cover letter line's value>
Answers: <drafts file, or none>
Problems: <none, or what needs the user>
```

Log a `skip` as `Skipped` with its reason (in auto mode) or show it at the checkpoint. Give `--check-template` only to the first tailoring subagent.

## Filling prompt

```
You're filling one internship application in a batch run by the internship-application skill.
Read <skill>/references/filling.md (and references/submitting.md unless the mode is Review) with your
file-reading tool, not cat. Read each file once. You don't need SKILL.md.
Mode: <Review | Fill all | Submit>. Never click Submit in any mode: in Submit mode, fill as in Fill all,
then run "The check before Submit" from submitting.md on the review page and report the result.
iCIMS has no review page, and every step button says Submit. Click it on each step except the last step
still to do: the current step once every other one is completed (a green check on its circle;
"(Completed Step)" in the page text), whatever its number. Some forms send the whole application from an
earlier step: never tell the user a step button only saves, in Submit mode check the step first, and after
each click, if the page says the application was submitted, stop and reply with Status: sent early by the
site (filling.md, "iCIMS has no review page"). That step's heading counts its forms
("Portal Specific Forms (1/3)"): click Submit on each form before the final one, then fill the final one
(3/3) and stop without clicking Submit. With no count, treat the form on screen as the final one.
In Review mode, stop when that last step opens.
iCIMS's "Create a login" step (Login and Password boxes above the profile) is a form page: fill all of it, the
files and the profile's email in Login included, and leave only the two password boxes. Then hand over: the user
types a password in both and clicks Submit (filling.md, "Sign-ins and accounts"). Open iCIMS links as they are;
when the company's site wraps the form and read_page shows no fields, call read_page with the filter "all" once
and use the references it lists (filling.md, "Keep browser work cheap").
Don't leave the step that takes the resume until it shows the tailored PDF's file name; if you can't attach
it there (on iCIMS, Replace Resume shows the file box), stop on that step and hand it over.
Attach or paste the cover letter wherever the form takes one, optional fields included (filling.md, "Cover letter").
Leave optional opt-ins (marketing or survey emails, talent communities, texts about other jobs) as they are.
How did you hear, with no true option: a job board's "Other", then "Other", then the company's careers page; a
named site only when none of those is offered. On a Workday search list, type the item's own name ("Other Job
Board", not "Job Board"), press Enter once, click its reference and check "1 item selected, <that item>"; if
another item shows, clear it and pick again before Save and Continue (filling.md, "Keep browser work cheap").
On Workday, fix the parsed work entries on My Experience before its Save and Continue. The Fill button tidies
the Role Descriptions; one it lists under Left gets that entry's bullets from resume-src/. A past job's location
box it leaves (Workday or iCIMS) gets that entry's place from the resume, never the user's address (filling.md,
"Filling the form").
On the review page, read every Role Description in the page text: a section heading ("Projects"), a "Name |
tools" line, another job's first line or a sentence broken over two lines still in one goes under Left for you
and on the For the user line, with the exact lines to delete. Never go back from the review page
to change work entries.
The user <saw | didn't see (auto)> the drafted answers.
For this application only: fill the form in the user's browser up to the review page or the first thing
that needs the user, add each page's fields to application-record.md as you go, and log the tracker row
(filling.md, "Logging the tracker row"; run scripts from <skill>). Don't start subagents of your own.
Fill everything you can. Before you list a question, check profile.json (every field and savedAnswers, by meaning):
list only what nothing there, in the master resume or in the posting answers. Don't edit profile.json; put new
answers under To save.
Browser work (filling.md has the rest): find fields with find or read_page and click or scroll_to them by
reference, never by screen position, and never scroll by screen position. At most one screenshot per page,
as a call of its own, never inside a batch.
- Job folder: <folder>  Application link: <url>  Resume: <PDF path>  Answers: <drafts file, or none>
- Cover letter: <letter path and cover-letter.txt path (and the combined PDF's), or none>  Master resume: <path>
- Profile: <folder>/profile.json  Tracker: <folder>/tracker.xlsx
- Tab: <open a new tab of your own | continue in tab <id>: the user has since <what they did>, and answered: <answers>
  | open a new tab of your own and continue from application-record.md: the tab group was lost>
The browser tools (claude-in-chrome) may be deferred: load them with your tool search first. Only if none
exist after that, stop and reply only "NO BROWSER".
Other subagents may be filling forms in other tabs of this browser. Pass your tab's id on every browser action,
and never switch to, close or use any other tab. If your tab is gone but the group is still there, open a new
tab and continue from application-record.md. If the group itself is gone ("This session's tab group no longer
exists"), don't make a new one: stop and reply with Status: stopped: tab group lost.
Reply with only these lines:
Status: review page | needs the user | sent early by the site: <what wasn't filled> | stopped: tab group lost | stopped: <why>
Tab: <id> <url>
For the user: <one line, or none>
Questions: <each question word for word, with its choices, or none>
Written answers: <none, or "in application-record.md" for ones you drafted on the form>
Agreed for you: <short list, or none>
To save: <answers the user gave that will come up again, for profile.json, or none>
Extension answers: <N from "Profile: N saved answers." in the Fill report, or none>
Submit check: <passed | failed: which> (Submit mode only)
```

## Without subagents

Do the same run here: tailor everything first (steps 1 to 3 for each posting), one combined checkpoint, fill each application in its own tab up to where it needs the user, one hand-off for the batch, continue each form when the user is done, record and log each, and report once.
