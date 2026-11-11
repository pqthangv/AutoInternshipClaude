# The profile (profile.json)

`profile.json` in the job-search folder holds the user's standard answers. It's also the AutoInternship extension's backup (**Download backup** saves it under that name). Keep field names exactly as in `profile-template.json`; the scripts read some by name.

Edit it in place. Never delete it. If it isn't valid JSON, move it into `_old/` with the date and time in its name, then save the repaired version.

## Creating it

Only when the folder has no profile.json:

1. Copy `references/profile-template.json` into the job-search folder as `profile.json`.
2. Fill in what the master resume says, exactly as written: name, email, phone, city, state, country, links, education (current school first), work, projects, skills, relevant coursework, expected graduation. Leave the rest empty. Never guess.
3. Ask the user, in one message, only what the resume can't answer (below), marking the optional ones.
4. Save, then tell the user once: "I created profile.json. If you use the AutoInternship extension, open its profile page, click **Restore from backup** and choose this file, so it fills forms with the same answers."

### What to ask

- Work authorization: `workAuthorized` (yes/no) and the country (`authCountry`).
- Sponsorship, two questions: needed now or in the future (`needsSponsorship`), and needed for the internship itself (`needsSponsorshipForInternship`). Never work these out yourself.
- Class standing, internship term, available dates, enrolled now, returning to school after the internship, willing to relocate, work preference.
- Government ties: a current or former government employee or official (`governmentEmployee`); a close relative who is one (`governmentRelative`).
- Optional, voluntary self-identification: gender, pronouns, Hispanic or Latino, race, veteran status, disability, LGBTQ+, transgender, sexual orientation. Each is an answer, "decline", or empty (the user answers on each form). Never infer these from a name, photo or anything else.
- Optional: `writingStyle` and `extraRules` for written answers.

## Values

- Yes-or-no fields take `"yes"`, `"no"` or `""` (not set): `enrolled`, `returningToSchool`, `workAuthorized`, `needsSponsorship`, `needsSponsorshipForInternship`, `willingToRelocate`, `governmentEmployee`, `governmentRelative`.
- Self-identification takes these codes, or `""` to leave it for the user:
  - `gender`: `female`, `male`, `nonbinary`, `decline`
  - `pronouns`: `she` (she/her), `he` (he/him), `they` (they/them), `decline`. For other pronouns, leave it empty.
  - `hispanicLatino`: `yes`, `no`, `decline`
  - `race`: `american-indian`, `asian`, `black`, `pacific-islander`, `white`, `two-or-more`, `decline`
  - `veteranStatus`: `no` (not a veteran), `protected`, `decline`
  - `disabilityStatus`: `yes`, `no`, `decline`
  - `lgbtq`: `yes`, `no`, `decline`
  - `transgender`: `yes`, `no`, `decline`
  - `sexualOrientation`: `straight`, `gay`, `lesbian`, `bisexual`, `pansexual`, `asexual`, `queer`, `decline`
- Text as the user would write it: `classStanding` ("Sophomore"), `expectedGraduation` ("May 2028"), `internshipTerm` ("Summer 2027"), `availableFrom` and `availableUntil` ("June 1, 2027"), `workAuthDetails` (for written answers and the eligibility screen in fetch_posting.py, for example "F-1 student, eligible for CPT"), `salary`, `startDate`, `workPreference`, `summary`, `skills`, `yearsExperience`, `writingStyle`, and `extraRules` (one rule per line).
- List entries:
  - `education`: `{ "school", "degree", "field", "minor", "start", "end", "gpa" }`, GPA exactly as written.
  - `work`: `{ "title", "company", "location", "start", "end", "highlights" }`, one highlight per line.
  - `projects`: `{ "name", "tools", "link", "highlights" }`
  - `savedAnswers`: `{ "match", "answer" }`. A question containing `match` (a short lowercase phrase) as whole words gets the answer. Only the question sentence counts, not a statement before it; the longest matching phrase wins.

## Saving answers for next time

When the user gives an answer the profile didn't have and it will come up again, save it without asking and say in one line what you saved. Set the matching field; if none fits, add `{ "match": "<short phrase from the question>", "answer": "<their answer>" }` to `savedAnswers`. Don't save answers written for one company ("Why do you want to work here?").

End the report of every run that changed profile.json, or whose Fill report showed fewer saved answers than profile.json has, with this line: "In the AutoInternship extension, open the profile page, click **Restore from backup** and choose <folder>/profile.json, so the Fill button uses the new answers." If they changed answers in the extension instead, ask them to click **Download backup** and put the new profile.json in the job-search folder.
