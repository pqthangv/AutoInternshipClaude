# Applyfile

A Chrome extension that fills job applications from a profile you save once, then hands the rest to Claude.

Applyfile handles the predictable fields itself, instantly and for free: name, contact details, links, location, current job, education, resume upload and common yes-or-no questions. Anything that needs judgment (open-ended questions, custom dropdowns, cover letters) is left for Claude in Chrome, which already comes with paid Claude plans. No API key, no extra cost.

On the page, Applyfile marks what it did:

- **Solid green outline**: filled from your profile.
- **Dashed amber outline**: still empty, for you or Claude.

It never overwrites a field that already has something in it, and it never submits anything.

## Install

1. Unzip this folder somewhere permanent (the browser loads it from there).
2. Open the extensions page and turn on **Developer mode**:
   - Chrome: `chrome://extensions` (toggle at top right)
   - Edge: `edge://extensions` (toggle in the left sidebar)
3. Click **Load unpacked** and choose the `applyfile` folder.
4. Pin Applyfile from the puzzle-piece menu so it's one click away.

Edge may show a banner about developer-mode extensions when it starts. That's expected for extensions you load yourself; leave it enabled.

To use Applyfile in both browsers, load it in each, then move your profile with **Download backup** and **Restore from backup** on the profile page. Attach your resume again in the second browser.

The profile page opens on first install. You can always get back to it from the popup with **Edit profile**.

## Internships and Overleaf resumes

The profile page has a **Student and internship** section and a **Projects** list for the questions internship forms ask. Put your current school first under Education, since forms take your school, major and GPA from that entry.

If you write your resume in Overleaf, use **Download PDF** in Overleaf and attach that file on the profile page. If you use the `internship-application` Claude skill, Claude builds a tailored PDF for each internship and swaps it in for this default one.

## Fill an application

Open the application form, then click the Applyfile icon and **Fill this page**, or press **Alt+Shift+F**. You can change the shortcut at `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`).

If a form opens in a pop-up or a later step, open that step first and fill again. Running it twice is safe.

## Finish with Claude

Anthropic officially supports Claude in Chrome only in Google Chrome, but it can also be installed in Edge from the Chrome Web Store, and the steps below work the same there. If something misbehaves in Edge, try the same application in Chrome before assuming Applyfile is at fault.

Pick whichever fits how you work. Both are on the profile page under **Use with Claude**, and in the popup.

**Saved prompt (simplest).** Click **Copy Claude prompt**, open the Claude side panel in Chrome, paste it, and save it as a shortcut. On each application: fill with Applyfile, then type `/` in the side panel and run your shortcut. The prompt contains your profile and tells Claude to work on the amber fields, skip demographic questions, and stop before submitting so you can review.

**Claude skill.** Click **Download Claude skill** and upload the `.zip` in Claude under **Customize → Skills** (skills need code execution turned on under Settings → Capabilities). Claude then has your profile whenever you work on an application, without pasting anything. Re-download and re-upload after you change your profile. Skills work in the newer side panel, which is still rolling out on some plans. If Claude doesn't seem to know your details there, use the saved prompt instead.

**Batches with Claude Code.** Download your backup from the profile page and save it as `profile.json` in a folder with a `jobs.txt` list of application URLs. Then run `claude --chrome` (signed in with `/login` on your Claude account; Chrome control doesn't work with an API key) and ask something like:

> For each URL in jobs.txt, open it in Chrome and fill out the application using only the facts in profile.json. Skip demographic questions. Don't submit; stop on each one and show me what you entered.

## What it fills, and what it leaves

Fills: first, last, preferred and full name; school, major, minor, GPA, expected graduation, class standing, relevant coursework, enrollment and returning-to-school questions, internship term, and available start and end dates; email; phone; address, city, state, postal code, country (including state and country dropdowns); LinkedIn, GitHub, portfolio and website; current company and title; school, degree, field of study, GPA and graduation year; years of experience; work authorization, sponsorship and relocation (dropdowns, radio buttons or text); salary expectation; start date; your saved answers; your resume file.

Leaves for you or Claude:

- Open-ended questions and cover letters.
- Custom dropdowns that aren't real `<select>` menus (common on Greenhouse and Workday). They get an amber outline when they still show "Select…".
- Demographic and voluntary self-identification questions, and anything asking for ID numbers, date of birth or bank details. These are never filled automatically.
- Work-authorization questions that name a different country than yours.
- Skill-specific questions like "years of experience with Python", and dates in formats it can't be sure of.
- Repeating work-history sections beyond what's visible on the page.

**Saved answers** are the way to teach it new questions: if a question contains your phrase, it fills your answer. They take priority over everything else.

## Privacy and permissions

Your profile and resume are stored only in this browser (`chrome.storage.local`). Applyfile makes no network requests and never sends your data anywhere. It doesn't talk to Claude; you choose what to give Claude by copying the prompt or uploading the skill.

- **activeTab, scripting**: lets it fill the tab you're on when you click or press the shortcut. It doesn't run in the background on pages you visit.
- **storage**: keeps your profile.
- **Site access for Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, iCIMS, Jobvite and BambooHR**: these often embed their forms inside company career pages, and this lets Applyfile fill the embedded form. To add another applicant system, add its domain to `host_permissions` in `manifest.json` and click reload on the extensions page.

Some job sites restrict automated tools in their terms. You're responsible for how you use this and Claude in Chrome on each site. Always review an application before you submit it.

## Customizing

Field matching lives in the `RULES` list at the top of `autofill.js`. Each rule is a regular expression tested against the field's label (and its name, id and autocomplete attributes), plus the profile value to use. Rules run in order and the first match wins. After editing, click reload on Applyfile in `chrome://extensions` (or `edge://extensions`).

## Troubleshooting

- **"Your browser doesn't let extensions fill this page."** Chrome and Edge block extensions on their own settings pages and add-on stores. Open the actual application.
- **Nothing happens on an embedded form.** The form is probably in a frame from a site that isn't in `host_permissions`. Open the form on its own page, or add the domain.
- **A filled value didn't stick.** A few sites re-render fields after you type. Click into the field and press a key, or let Claude handle it.
- **Resume didn't attach.** Some upload widgets don't accept files from scripts. Attach it yourself; the outline shows where.
