# AutoInternshipClaude

Two Claude skills for internship applications. They find postings, tailor a one-page resume to each one, fill the form and track every application. You always review and click submit yourself.

| Skill | What it does |
|---|---|
| [`internship-application`](internship-application/) | Finds internships from the [SimplifyJobs list](https://github.com/SimplifyJobs/Summer2027-Internships), tailors and fact-checks your resume (Overleaf or Word), fills the application and records what it entered. |
| [`internship-tracker`](internship-tracker/) | Keeps `tracker.xlsx` up to date with statuses, follow-ups and interview prep. |

It never submits for you, never uses LinkedIn, never types passwords, never adds anything to your resume that isn't in your master copy, and never deletes files.

## Install

- **Claude app:** zip each folder (`Compress-Archive -Path internship-application -DestinationPath internship-application.zip`) and upload it in the Skills section of Claude's settings.
- **Claude Code:** copy both folders into `~/.claude/skills/`.

## Setup

Make a job-search folder, connect it in Claude, and add:

- `resume/`: your Overleaf project source, unzipped (or a master `.docx`)
- `profile.json` (optional): your standard answers. The skill offers to create it.
- `jobs.txt` (optional): posting links, one per line

The skills create `Applications/` (one folder per application) and `tracker.xlsx`.

Then ask things like "Find data internships in CA", "Work through jobs.txt", "I submitted Northwind" or "Help me prep for my interview Tuesday".

## Requirements

- Python 3: `pip install openpyxl pypdf`
- Optional: LaTeX to build resumes locally (otherwise compile in Overleaf) and Poppler for better PDF checks
