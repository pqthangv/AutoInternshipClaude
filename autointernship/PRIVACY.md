# AutoInternship privacy policy

Last updated: November 9, 2026

AutoInternship is a Chrome extension that fills job application forms from a profile you save in it. This policy covers the extension.

## What it stores

- **Your profile**: what you enter on its profile page. That can include your name, email, phone number, address, links (such as LinkedIn or GitHub), education, work history, projects, skills, work authorization and sponsorship answers, availability, salary expectations, your saved answers to application questions, writing preferences, and the kinds of jobs, companies and job sites you want Claude to apply to or skip.
- **Voluntary self-identification answers**, only if you choose them: gender, pronouns, Hispanic or Latino, race, veteran status, disability status, LGBTQ+, transgender and sexual orientation. Each one is optional. "Not set" stores nothing.
- **Your resume file**, if you attach one.
- **One setting**: whether the Fill button shows on application pages.

## Where it's kept

Everything stays in your browser's local extension storage on your device. It isn't synced to your Google account or anywhere else.

## How it's used

Only to fill job application forms, when you ask: by clicking **Fill with AutoInternship** on the page, **Fill this page** in the popup, or the keyboard shortcut. It reads the form's questions on that page, matches them to your profile and types the answers in. The answers go to that site's form, as if you had typed them (the popup and the shortcut also attach your stored resume), and a short report of what it filled is added to the same page, where the site can see it too. The report lists the answers it typed, and can include a profile value the site had filled in differently (your name, for example). Where a form's upload box is hidden inside the site's page components, it adds a plain file box below it; a file you (or Claude) put there goes to that form's upload box, as if you had picked it there, and isn't kept. It keeps nothing from the pages you visit.

## What it never does

- It makes no network requests. Your data is never sent to the developer or to anyone else. There are no servers, analytics, ads or tracking.
- It never sells or shares your data, and never uses it for anything but filling forms (not for advertising, credit or lending decisions).
- It never loads code from the internet.
- It never submits an application.

## Files you move yourself

**Download backup** saves your profile (not your resume) as `profile.json` on your computer, and **Restore from backup** loads one. Where that file goes is up to you.

This project also has Claude skills that can read `profile.json` from your job-search folder, and Claude in Chrome can read the fill report on the page. That happens in Claude, under Anthropic's privacy policy, not in this extension.

## Permissions

- **Storage**: keeps your profile, resume and setting on your device.
- **Access to job application sites** (greenhouse.io, lever.co, ashbyhq.com, myworkdayjobs.com, myworkday.com, myworkdaysite.com, smartrecruiters.com, workable.com, icims.com, jobvite.com, bamboohr.com, and Oracle Recruiting Cloud on oraclecloud.com): shows the Fill button on application pages and fills their forms, including forms inside embedded frames.
- **activeTab and scripting**: fill the page you're on when you use the popup or the keyboard shortcut.

## Deleting your data

Clear fields or remove your resume on the profile page, or remove the extension: Chrome then deletes everything it stored. Backups you downloaded stay where you saved them.

## Changes

If this policy changes, the new version is posted here with a new date.

## Contact

Open an issue at https://github.com/pqthangv/AutoInternshipClaude/issues.

AutoInternship is a personal open-source project. It isn't affiliated with or endorsed by Anthropic or any job site.
