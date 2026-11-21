# Batch runs: one subagent per posting

Read this when the user asks to work through jobs.txt or gives several links.

Use the subagent tool (Task or Agent, type `general-purpose`). Without one, follow "Without subagents" at the end.

- **Keep this conversation small.** Never fill, fix, check or read a form page here: not one field, not when the user says "fill Northwind", not when a subagent couldn't read the form. Start one new filling subagent for it (step 6); if that one can't read the form either, it's `Needs you`. Your only browser work is making the tab group, opening sign-in tabs (step 2), and in Submit mode clicking Submit (step 7).
- **Models.** Start filling and check subagents with the `sonnet` model when your subagent tool lets you choose (steps 4, 6 and 7). Tailoring subagents keep the default model.
- **No wakeups, no advisor.** Never schedule a wakeup, loop or cron job (ScheduleWakeup, CronCreate, /loop): each subagent tells you when it finishes. Never call the advisor tool; both prompts below say the same.

## The run

1. **Tidy and pick the queue** (SKILL.md, "Batch runs"). Never pick from jobs.txt any other way. Judge each `to_judge` posting from its `screen_why` lines by SKILL.md step 2, here; move one that fails below `# done` with its reason and log it as `Skipped`. Then take the N asked for from `picks` and the `to_judge` postings that passed: those with `closes_soon` first, then by `order`. Never start a subagent for a posting in `moved_below_done`. Picks with `ok: false` are read in the browser by their tailoring subagent.

   **Refill** whenever a posting drops out before the hand-off (step 5): you judge it out, its tailoring subagent replies `Eligibility: skip`, or its first filling subagent stops because the posting is closed or rules the user out. Handle it as usual (below `# done` with its reason, logged as `Skipped` or shown at the checkpoint), then run the same `--pick` call again with the number missing (N minus the postings still going) and the same `--out-dir`; it passes over what this batch picked already. Leave out a pick whose link is already in this batch. Take the new `picks` and `to_judge` as above and send them through steps 2 to 4 like the rest: a site that has no sign-in tab yet gets one, with one more short sign-in message. Stop refilling when a call returns no picks or `stopped` says `end of queue` or `fetch limit`, and after five refills; then go with what's left and say so at the checkpoint or in the report.

   For links the user gave instead of jobs.txt, fetch those links (SKILL.md, "Batch runs"), log the ones the screen marks `skip` as `Skipped` and take the rest; the queue's limits don't apply to them. If the user asks for more from one company ("all the Northwind roles"), pass those links this way. When they ask for more from one iCIMS site, tell them the rest come in the next batch.
2. **Tailor**: one subagent per posting with the tailoring prompt. Start the first one alone and all the rest in your next message (all in one message if your subagent tool waits for each to finish). Postings the fetch couldn't get are read in the browser, so follow "Sharing the browser" for those. Don't read tailoring.md, overleaf.md or the master yourself.

   **Sign-ins while they work.** Then open one new tab (`tabs_create_mcp`) per site among the picks that needs an account, at its sign-in page: for Workday, the posting's address cut after the site's name, plus `/login` (`https://northwind.wd5.myworkdayjobs.com/en-US/External/login`); for iCIMS, `https://<host>/jobs/<id>/login?mobile=true&needsRedirect=false`. Don't read those pages. Tell the user in one message, without waiting for an answer: the tabs (company and site), to sign in or create an account there (their browser's password manager can save the password) and then leave the tab without uploading or filling anything, and that you're carrying on meanwhile.
3. **Checkpoint** (step 4) from the summaries, one short block per posting. Read a drafts file only to show its answers, and not at all in auto mode. Add one line for the `held` postings from the last pick call (company: role, and why), so the user can swap one in or say to do them all; in auto mode they stay held.
4. **Fill**: one subagent per application with the filling prompt, all at once, following "Sharing the browser". Start the first one alone, then every other one not queued behind a sign-in in your next message (as in step 2), and each queued one when the form ahead of it replies (or in the next message, if your subagent tool waits for all). The first form on a site with a sign-in tab from step 2 gets `Tab: continue in tab <id>: the user was asked to sign in there`. If they reply NO BROWSER, fill them all yourself, as in "Without subagents".
5. **Hand-off**: one message for the whole batch: one line per tab (company and role, and what's needed: "sign in to Workday", "attach C:\\...\\Maya_Chen_Resume_Northwind.pdf"), then the questions from every form, grouped so one answer covers every form that asks it. Before sending, check each question against profile.json yourself (every field and `savedAnswers`, by meaning); for the ones it answers, start that application's step 6 subagent right away instead of asking. Sponsorship follows filling.md's "Sponsorship" line: a question about this internship only takes `needsSponsorshipForInternship` when it's set, over any saved answer. In Submit mode without auto, also show the written answers the subagents drafted on the form (each record's "Written answers"); send this message even when nothing else needs the user, and wait.
6. **Continue**: when the user is done, start a new filling subagent for each application with the filling prompt, all at once as in step 4, with what the user did and their answers. Each continues from its application-record.md in the same tab. Repeat once if new steps came up. Never send a subagent a message (SendMessage), running or finished: everything goes into a new filling prompt. When the user changes a rule for the batch or approves something ("you can click Save and Continue on Self Identify", "yes, tick them"), write it into each new filling prompt as a line after `Mode:` ("The user said: ..."). Never send a subagent back from Workday's review page to change work entries (filling.md, "Filling the form"); put what's wrong in the report.
7. **Submit** (Submit mode only): only you click Submit, never a subagent. Take each reply's `Submit check:` as it is; never re-check, read or change the page yourself. If the user turned on Submit after the filling subagents started, they ran no check: start one check subagent per application on its last page before Submit, with the check prompt, all at once. For each application whose check passed (or failed only on check 3, written answers, which the user has since seen and accepted), switch to its tab. Its address (in the tab list your browser calls return) must still be the one the reply gave (`Tab:` or `Page:`); if it changed (a sign-in page, a reload), don't click: start a new check subagent. Then `find` the Submit button and follow "Submitting" in submitting.md, checking the confirmation with `find`. A failed check, or an answer that looks wrong, goes to a new filling subagent (step 6) with what to fix, then a new check subagent. Never close a tab, submitted ones included: the user may have more to do there after Submit.
8. **Report** once, one line per posting (step 8); for one the site sent early, say what wasn't filled. Move processed links in jobs.txt below `# done`, editing in place. Held postings get one line together at the end ("Held: Company Role (2 per company), ...") and stay above `# done`. Postings the pick moved get one line too ("Moved below # done: 3 closed, 2 not software or data roles, ..."). Save the answers listed under `To save:` to profile.json without asking (`references/profile.md`) and say in one line what you saved. If profile.json changed in this batch, or any reply's `Extension answers:` is lower than its number of `savedAnswers`, add: "In the AutoInternship extension, open the profile page, click **Restore from backup** and choose <folder>/profile.json, so the Fill button uses the new answers." End with one line telling the user to start a new conversation for the next batch.

A posting with a wall the user can't clear in the hand-off (a broken page, an assessment) is `Needs you`; move on. A closed posting is `Skipped`, refilled as in step 1 when it closes before the hand-off.

## Sharing the browser

- **Make the group yourself first.** Before the first subagent that uses the browser, load the browser tools (tool search) and call `tabs_context_mcp` with `createIfEmpty: true`. The tab it gives you, then and each time you make the group again, stays blank and open until the batch ends: never navigate it, give it to a subagent or close it. Open every other tab, sign-in tabs included, with `tabs_create_mcp`.
- **No limit on how many at once**, except the queueing below. If the user asks for a limit, use their number.
- **One at a time per sign-in.** Never run two forms at once on the same account: two on one Workday site (such as `northwind.wd5.myworkdayjobs.com`) or two on one company's careers site. Queue the second behind the first. Greenhouse, Lever and Ashby forms for different companies can run at the same time.
- **If they get in each other's way** (two subagents report failing screenshots, clicks that didn't take, or a missing tab), let the running ones finish, then fill the rest one at a time.
- **If the tab group disappears**, each running subagent stops with `stopped: tab group lost`. Wait for the rest, make the group again, and start a new subagent for each with the filling prompt and the `Tab:` line for a lost tab group. Never fill from the start.

## Tailoring prompt

Fill in the `<...>` parts and send only this.

```
You're tailoring one internship application in a batch run by the internship-application skill.
With your file-reading tool, not cat, read <skill>/SKILL.md, the posting and the profile first, and do SKILL.md
steps 1 and 2 for this posting only (the tracker check is already done): create the job folder (a new one when another
posting's folder has the name: never write into it), save job-posting.md, check eligibility. If it's a skip, reply
now. Otherwise read <skill>/references/tailoring.md (and references/overleaf.md if the master is .tex) and the master,
then do step 3: tailor, check and save the resume, write changes.md, write the
cover letter when tailoring.md's "Cover letter" says (optional fields included), and draft any written answers into
<scratch>/answers/<NN>.md. Read each file once.
Don't open the application form, don't change the tracker, don't start subagents of your own, and don't call the advisor tool.
Work only from the master resume: never open resumes, resume-src or changes.md in other job folders.
For a .tex master, never type LaTeX into a shell command, heredoc or script: use the Write and Edit tools (copying files with cp, head or cat is fine).
- Posting: <fetched file> | <link: open it in a new tab of your own (tabs_create_mcp), read it, close that tab; pass its id on every browser action and leave other tabs alone>
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
types a password in both and clicks Submit (filling.md, "Sign-ins and accounts"). Open iCIMS at the Application
link (it ends in mobile=true&needsRedirect=false). If a page shows only "Skip Branding" and no fields, open its
address again with mobile=true&needsRedirect=false in its query (in place of mobile=false); never click "Skip Branding"
(filling.md, "Keep browser work cheap").
Don't leave the step that takes the resume until it shows the tailored PDF's file name; if you can't attach
it there (on iCIMS, Replace Resume shows the file box), stop on that step and hand it over.
Attach or paste the cover letter wherever the form takes one, optional fields included (filling.md, "Cover letter").
Leave optional opt-ins (marketing or survey emails, talent communities, texts about other jobs) as they are.
How did you hear, with no true option: a job board's "Other", then "Other", then the company's careers page; a
named site only when none of those is offered. On a Workday search list, type the item's own name ("Other Job
Board", not "Job Board"), press Enter once, click its reference and check "1 item selected, <that item>"; if
another item shows, clear it and pick again before Save and Continue (filling.md, "Keep browser work cheap").
On Workday, fix the parsed work entries on My Experience before its Save and Continue; if it parsed none, add
the jobs from resume-src/'s Experience section. The Fill button tidies
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
(filling.md, "Logging the tracker row"; run scripts from <skill>). Don't start subagents of your own or call the advisor tool.
Fill everything you can. Before you list a question, check profile.json (every field and savedAnswers, by meaning):
list only what nothing there, in the master resume or in the posting answers. Don't edit profile.json; put new
answers under To save.
Browser work (filling.md has the rest): find fields with find or read_page and click or scroll_to them by
reference, never by screen position, and never scroll by screen position. At most one screenshot per page,
as a call of its own, never inside a batch.
- Job folder: <folder>  Application link: <url; the fetch's apply_url when it has one>  Resume: <PDF path>  Answers: <drafts file, or none>
- Cover letter: <letter path and cover-letter.txt path (and the combined PDF's), or none>  Master resume: <path>
- Profile: <folder>/profile.json  Tracker: <folder>/tracker.xlsx
- Tab: <open a new tab of your own | continue in tab <id>: the user was asked to sign in there
  | continue in tab <id>: the user has since <what they did>, and answered: <answers>
  | open a new tab of your own and continue from application-record.md: the tab group was lost>
The browser tools (claude-in-chrome) may be deferred: load them with your tool search first. Only if none
exist after that, stop and reply only "NO BROWSER".
When the Tab line says to open a new tab, open it with tabs_create_mcp; never take a tab that was already there,
a blank one included.
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

## Check prompt

For step 7, when the filling subagents ran without the check.

```
You're checking one internship application before Submit, in a batch run by the internship-application skill.
Read "The check before Submit" in <skill>/references/submitting.md with your file-reading tool, not cat. You don't
need other files from the skill. The form is in tab <id>, on its last page before Submit (iCIMS: the final form of
its last step). Read that page with get_page_text and find (one screenshot at most), the job folder's
application-record.md, job-posting.md and resume file name, and the profile, then run all seven checks (check 5
against the profile and the master resume; check 6:
python <skill>/scripts/tracker.py find "<folder>/tracker.xlsx" --company "<Company>").
Change nothing on the page, never click Submit or any button that leaves the page, and pass your tab's id on every
browser action without using any other tab. Don't start subagents of your own or call the advisor tool.
- Job folder: <folder>  Tab: <id>  The user saw the written answers: <yes | no | auto>
- Profile: <folder>/profile.json  Master resume: <path>
The browser tools (claude-in-chrome) may be deferred: load them with your tool search first.
Reply with only these lines:
Submit check: passed | failed: <which checks, and what's wrong>
Page: <the tab's address, the page's heading, and the Submit button's label>
```

## Without subagents

Do the same run here: tailor everything first (steps 1 to 3 for each posting), one combined checkpoint, fill each application in its own tab up to where it needs the user, one hand-off for the batch, continue each form when the user is done, record and log each, and report once.
