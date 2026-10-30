# AutoInternshipClaude

Two Claude skills and a Chrome extension for internship applications. They find postings, tailor a one-page resume to each one, fill the form and track every application. You always review and click submit yourself.

| Part | What it does |
|---|---|
| [`internship-application`](internship-application/) | Finds internships from the [SimplifyJobs list](https://github.com/SimplifyJobs/Summer2027-Internships), tailors and fact-checks your resume (Overleaf or Word), fills the application and records what it entered. |
| [`internship-tracker`](internship-tracker/) | Keeps `tracker.xlsx` up to date with statuses, follow-ups and interview prep. |
| [`autointernship`](autointernship/) | The AutoInternship Chrome extension. Fills the predictable fields (name, contact details, school, links, yes-or-no questions, dropdowns, self-identification answers you chose) from your saved profile, instantly and without using Claude. Claude finishes the rest. |

It never submits for you, never uses LinkedIn, never types passwords, never adds anything to your resume that isn't in your master copy, and never deletes files.

## What you need

- A paid Claude plan (Pro or higher). Skills, Cowork and Claude in Chrome all need one.
- The [Claude desktop app](https://claude.com/download) and Google Chrome.
- Your resume, in Overleaf or as a Word file.

## Install (about 10 minutes)

1. **Download this project.** Click the green **Code** button at the top of this page, then **Download ZIP**. Right-click the file and choose **Extract All** (on a Mac, double-click it). Move the extracted folder somewhere you'll keep, like Documents, because Chrome loads the extension from it.
2. **Add the two skills.** Right-click the `internship-application` folder and compress it to a ZIP (Windows: **Compress to** → **ZIP File**; Mac: **Compress**). Do the same for `internship-tracker`. In Claude, open **Customize → Skills** and upload both ZIPs. If there's no upload option, turn on code execution in **Settings → Capabilities** ([help](https://support.claude.com/en/articles/12512180-use-skills-in-claude)).
3. **Add the AutoInternship extension.** In Chrome, go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked** and choose the `autointernship` folder. Its profile page opens: fill it in once. See [its README](autointernship/README.md) for more.
4. **Add Claude in Chrome.** Install it from the Chrome Web Store and sign in ([help](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)). It lets Claude work in your browser and press the extension's Fill button.

## Start applying

1. Make a folder for your job search with a folder named `resume` inside. Put your resume there: either your Overleaf project downloaded as **Source** (a .zip from Overleaf's menu) and unzipped, or your Word `.docx`.
2. Optional: add `profile.json` (your standard answers; use **Download backup** on the extension's profile page) and `jobs.txt` (posting links, one per line). Without `profile.json`, Claude makes one and asks only what your resume doesn't say.
3. Open the Claude desktop app, go to **Cowork** and choose your job-search folder ([help](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)).
4. Ask things like "Find data internships in CA", "Work through jobs.txt", "I submitted Northwind" or "Help me prep for my interview Tuesday".

Claude adds `Applications/` (one folder per application) and `tracker.xlsx` to your folder.

## Using Claude Code instead

Copy both skill folders into `~/.claude/skills/` and install Python 3 with `pip install openpyxl pypdf`. LaTeX (to build resumes locally instead of in Overleaf) and Poppler (for better PDF checks) are optional.
