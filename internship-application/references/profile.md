# The profile (profile.json)

`profile.json` in the job-search folder holds the user's standard answers. It's the same file as the AutoInternship extension's backup (**Download backup** on its profile page saves it under that name), so one set of answers fills forms in the browser and answers questions here. The scripts read some fields by name, so keep the names exactly as in `profile-template.json`.

Edit it in place. Never delete it. If it isn't valid JSON, don't overwrite it: move it into `_old/` with the date and time in its name, then save the repaired version.

## Creating it

Only when the folder has no profile.json:

1. Copy `references/profile-template.json` into the job-search folder as `profile.json`.
2. Fill in what the master resume says, exactly as written: name, email, phone, city, state, country, links, education, work, projects, skills, relevant coursework, expected graduation. Put the current school first under `education`. Leave anything the resume doesn't say empty. Never guess.
3. Ask the user, in one message, only the questions the resume can't answer (list below). Say which are optional.
4. Save, then tell the user once: "I created profile.json. If you use the AutoInternship extension, open its profile page, click **Restore from backup** and choose this file, so it fills forms with the same answers."

### What to ask

- Work authorization: `workAuthorized` (yes/no) and the country (`authCountry`).
- Sponsorship, two separate questions: will they need it now or in the future (`needsSponsorship`), and do they need it for the internship itself (`needsSponsorshipForInternship`). Many students on F-1 need none for an internship (CPT) but will later. Never work these out yourself.
- Class standing, internship term, available dates, enrolled now, returning to school after the internship, willing to relocate, work preference.
- Government ties: are they a current or former government employee or official (`governmentEmployee`), and is a close relative one (`governmentRelative`)? Finance, consulting and defense forms ask this.
- Optional, voluntary self-identification: gender, pronouns, Hispanic or Latino, race, veteran status, disability, LGBTQ+, transgender, sexual orientation. Each can be an answer, "decline" (forms then get "Decline to answer"), or left empty (the user answers on each form). Never infer any of these from a name, photo or anything else.
- Optional: how they write (`writingStyle`) and any rules for written answers (`extraRules`).

## Values

- Yes-or-no fields take `"yes"`, `"no"` or `""` (not set): `enrolled`, `returningToSchool`, `workAuthorized`, `needsSponsorship`, `needsSponsorshipForInternship`, `willingToRelocate`, `governmentEmployee`, `governmentRelative`.
- Self-identification takes these codes, or `""` to leave it for the user:
  - `gender`: `female`, `male`, `nonbinary`, `decline`
  - `pronouns`: `she` (she/her), `he` (he/him), `they` (they/them), `decline`. For other pronouns, leave it empty and the user answers on each form.
  - `hispanicLatino`: `yes`, `no`, `decline`
  - `race`: `american-indian`, `asian`, `black`, `pacific-islander`, `white`, `two-or-more`, `decline`
  - `veteranStatus`: `no` (not a veteran), `protected`, `decline`
  - `disabilityStatus`: `yes`, `no`, `decline`
  - `lgbtq`: `yes`, `no`, `decline`
  - `transgender`: `yes`, `no`, `decline`
  - `sexualOrientation`: `straight`, `gay`, `lesbian`, `bisexual`, `pansexual`, `asexual`, `queer`, `decline`
- Text as the user would write it: `classStanding` ("Sophomore"), `expectedGraduation` ("May 2028"), `internshipTerm` ("Summer 2027"), `availableFrom` and `availableUntil` ("June 1, 2027"), `workAuthDetails` (used only in written answers, for example "F-1 student, eligible for CPT"), `salary`, `startDate`, `workPreference`, `summary`, `skills`, `yearsExperience`, `writingStyle`, and `extraRules` (one rule per line).
- List entries:
  - `education`: `{ "school", "degree", "field", "minor", "start", "end", "gpa" }`. Write the GPA exactly as written.
  - `work`: `{ "title", "company", "location", "start", "end", "highlights" }`, where highlights has one per line.
  - `projects`: `{ "name", "tools", "link", "highlights" }`
  - `savedAnswers`: `{ "match", "answer" }`. When a question contains `match` (a short lowercase phrase), the answer is used.

## Saving answers for next time

When the user gives you an answer the profile didn't have and it will come up again (a standard question, or a common one like "How did you hear about us?"), ask once: "Save this to your profile for next time?" On yes, set the matching field. If no field fits, add `{ "match": "<short phrase from the question>", "answer": "<their answer>" }` to `savedAnswers`. Don't save answers written for one company, like "Why do you want to work here?".

After any change to profile.json, remind the user once per session to **Restore from backup** in the extension. If the user says they changed answers in the extension instead, ask them to click **Download backup** and put the new profile.json in the job-search folder.
