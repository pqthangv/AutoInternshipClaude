# AutoInternship

A Chrome extension that fills job applications from a profile you save once, then leaves the rest to Claude. It never overwrites what's already filled and never submits.

- **Solid green outline**: filled from your profile.
- **Dashed amber outline**: still empty, for you or Claude.

## Install

Install AutoInternship from the [Chrome Web Store](https://chromewebstore.google.com/detail/autointernship/cdfkbdkmandhnmaejaknimdhepipbpin). It also works in Edge: allow extensions from other stores when Edge asks. The profile page opens on first install. Pin AutoInternship from the puzzle-piece menu.

**Switching from a copy you loaded unpacked?** The store copy keeps its own profile. Click **Download backup** in the old copy, then **Restore from backup** in the new one. Then remove the old copy in `chrome://extensions`, so pages don't get two Fill buttons.

**For developers:** to run it from this folder, turn on **Developer mode** in `chrome://extensions` (or `edge://extensions`), click **Load unpacked** and choose the `autointernship` folder.

## Set up your profile

Fill in the profile page once. Put your current school first under Education. Attach your resume PDF (from Overleaf: **Download PDF**).

**Download backup** saves your profile as `profile.json`. Put it in your job-search folder so the `internship-application` skill can use it, or use **Restore from backup** to move your profile to another browser.

## Fill an application

Click **Fill with AutoInternship** on the right edge of the application page. A panel lists what was filled, what was already filled and what's left. You can also use **Fill this page** in the popup or **Alt+Shift+F**; those also attach your stored resume, but the page button doesn't.

On forms with several steps (Workday's **Save and Continue**), fill again on each step. Running it twice is safe.

## Use with Claude

The `internship-application` skill in this repo reads your answers from `profile.json` and clicks the Fill button itself on each page. Then it reads the same report from the page text and works only on what's left, which is faster and uses far fewer tokens than filling every field.

## What it fills

Name, contact details, address, links, education, student questions (graduation, class standing, term, dates), work history, work authorization, sponsorship, relocation, government ties, salary, start date, your saved answers and your resume. That includes text boxes, dropdowns (including Greenhouse, Workday and Oracle's custom ones), radio buttons and "select all that apply" checkboxes.

- **Sponsorship** has two answers: "now or in the future" and "for the internship itself". A question only about this internship (or "now" without the future) gets the internship answer, even over a saved answer. If a question could mean either, it's filled only when both answers match.
- **Voluntary self-identification** (gender, pronouns, Hispanic or Latino, race, veteran, disability, LGBTQ+, transgender, sexual orientation) is filled only with the choice you pick for each, including "Decline to answer". "Not set" leaves it for you.
- **Saved answers** teach it new questions: if the question itself (not a sentence before it) contains your phrase as whole words, it uses your answer. When several phrases fit, the longest wins.

It always leaves these for you or Claude: open-ended questions, cover letters, consent and "I certify" checkboxes, religion and marital status questions, ID numbers, date of birth, bank details, and anything it can't match confidently.

## Privacy

Your profile and resume stay in this browser. AutoInternship makes no network requests. The Fill button appears only on the application sites listed in `manifest.json` (Greenhouse, Lever, Ashby, Workday and others), and only a real click starts a fill, so a web page can't start one by itself. You can hide the button on the profile page. Some job sites restrict automated tools in their terms, so review every application before you submit it. The full policy is in [PRIVACY.md](PRIVACY.md).

## If something goes wrong

- **Nothing happens on an embedded form:** open the form on its own page.
- **A field stayed amber or didn't stick:** pick it yourself or let Claude. Add a saved answer for questions you see often.
- **No Fill button:** it shows only on the listed sites, once the page has a form. Check it's turned on in the profile page. If you just reloaded the extension, reload the page too.
- **Resume didn't attach:** some sites block scripted uploads. Attach it yourself.

For developers: field matching is the `RULES` list in `autofill.js`, and the Fill button and report panel are in `bridge.js`.
