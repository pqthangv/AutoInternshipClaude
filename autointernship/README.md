# AutoInternship

A Chrome extension that fills job applications from a profile you save once, then leaves the rest to Claude. It never overwrites what's already filled and never submits.

- **Solid green outline**: filled from your profile.
- **Dashed amber outline**: still empty, for you or Claude.

## Install

1. Keep this folder somewhere permanent (the browser loads it from there).
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `autointernship` folder.
4. Pin AutoInternship from the puzzle-piece menu. The profile page opens on first install.

## Set up your profile

Fill in the profile page once. Put your current school first under Education. Attach your resume PDF (from Overleaf: **Download PDF**).

**Download backup** saves your profile as `profile.json`. Put it in your job-search folder so the `internship-application` skill can use it, or use **Restore from backup** to move your profile to another browser.

## Fill an application

Open the form and click **Fill this page** in the popup, or press **Alt+Shift+F**. On forms with several steps (Workday's **Save and Continue**), fill again on each step. Running it twice is safe.

## Use with Claude

- **With the internship-application skill (recommended):** turn on **Let Claude start fills** on the profile page, then download the backup again into your job-search folder. Claude can then start a fill itself on each page and step, and works only on what's left. It's faster and uses far fewer tokens.
- **Saved prompt:** **Copy Claude prompt**, paste it into the Claude side panel and save it as a shortcut. Run it after each fill.
- **Claude skill:** **Download Claude skill** and upload the zip under **Customize → Skills** in Claude.

## What it fills

Name, contact details, address, links, education, student questions (graduation, class standing, term, dates), work history, work authorization, sponsorship, relocation, government ties, salary, start date, your saved answers and your resume. That includes text boxes, dropdowns (including Greenhouse and Workday's custom ones), radio buttons and "select all that apply" checkboxes.

- **Sponsorship** has two answers: "now or in the future" and "for the internship itself". If a question could mean either, it's filled only when both answers match.
- **Voluntary self-identification** (gender, Hispanic or Latino, race, veteran, disability, LGBTQ+) is filled only with the choice you pick for each, including "Decline to answer". "Not set" leaves it for you.
- **Saved answers** teach it new questions: if a question contains your phrase, it uses your answer.

It always leaves these for you or Claude: open-ended questions, cover letters, consent and "I certify" checkboxes, pronouns, sexual orientation and transgender identity questions, ID numbers, date of birth, bank details, and anything it can't match confidently.

## Privacy

Your profile and resume stay in this browser. AutoInternship makes no network requests. It runs on the application sites listed in `manifest.json` (Greenhouse, Lever, Ashby, Workday and others), and only starts a fill for Claude when **Let Claude start fills** is on and the request carries your key. Some job sites restrict automated tools in their terms, so review every application before you submit it.

## If something goes wrong

- **Nothing happens on an embedded form:** open the form on its own page.
- **A field stayed amber or didn't stick:** pick it yourself or let Claude. Add a saved answer for questions you see often.
- **Claude says fills are off or the key is wrong:** turn on **Let Claude start fills** and download the backup again. If you just reloaded the extension, reload the page too.
- **Resume didn't attach:** some sites block scripted uploads. Attach it yourself.

For developers: field matching is the `RULES` list in `autofill.js`, and the Claude message format is at the top of `bridge.js`.
