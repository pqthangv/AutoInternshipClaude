/* Shared by the popup and the profile page: the profile's shape and a few small helpers.
   The profile is what Download backup saves as profile.json, which the internship-application skill
   reads, so its field names are shared with the skill. Change them in both places. */
const AutoInternship = (() => {
  function defaults() {
    return {
      firstName: '', lastName: '', preferredName: '', email: '', phone: '',
      street: '', city: '', state: '', postalCode: '', country: '',
      linkedin: '', github: '', portfolio: '', website: '',
      work: [], projects: [], education: [],
      expectedGraduation: '', classStanding: '', enrolled: '', returningToSchool: '',
      relevantCoursework: '', internshipTerm: '', availableFrom: '', availableUntil: '', workAuthDetails: '',
      summary: '', skills: '', yearsExperience: '',
      workAuthorized: '', authCountry: '', needsSponsorship: '', needsSponsorshipForInternship: '', willingToRelocate: '',
      governmentEmployee: '', governmentRelative: '',
      salary: '', startDate: '', workPreference: '',
      // Voluntary self-identification. Empty means "leave it for me"; see SELF_ID_LABELS for the choices.
      gender: '', hispanicLatino: '', race: '', veteranStatus: '', disabilityStatus: '', lgbtq: '',
      savedAnswers: [],
      // For Claude's written answers; the internship-application skill reads these from profile.json.
      writingStyle: '', extraRules: '',
    };
  }

  // The self-identification choices: the profile stores the short code and the profile page shows the
  // words. autofill.js matches each code to the many ways forms word it.
  const SELF_ID_LABELS = {
    gender: { female: 'Female', male: 'Male', nonbinary: 'Non-binary', decline: 'Decline to answer' },
    hispanicLatino: { yes: 'Yes', no: 'No', decline: 'Decline to answer' },
    race: {
      'american-indian': 'American Indian or Alaska Native', asian: 'Asian', black: 'Black or African American',
      'pacific-islander': 'Native Hawaiian or Other Pacific Islander', white: 'White', 'two-or-more': 'Two or more races',
      decline: 'Decline to answer',
    },
    veteranStatus: { no: 'Not a veteran', protected: 'Protected veteran', decline: 'Decline to answer' },
    disabilityStatus: { yes: 'Yes, I have (or have had) a disability', no: 'No disability', decline: 'Decline to answer' },
    lgbtq: { yes: 'Yes', no: 'No', decline: 'Decline to answer' },
  };

  const blank = {
    work: () => ({ title: '', company: '', location: '', start: '', end: '', highlights: '' }),
    projects: () => ({ name: '', tools: '', link: '', highlights: '' }),
    education: () => ({ school: '', degree: '', field: '', minor: '', start: '', end: '', gpa: '' }),
    savedAnswers: () => ({ match: '', answer: '' }),
  };

  // Fields older versions saved that are no longer used (claudeKey came from the first version of the
  // Claude bridge). Dropped when a profile is loaded or restored, so they don't linger in backups.
  const RETIRED = ['claudeKey'];
  const tidyProfile = (p) => { for (const k of RETIRED) delete p[k]; return p; };

  const clean = (v) => String(v ?? '').trim();
  const fullName = (p) => [p.firstName, p.lastName].map(clean).filter(Boolean).join(' ');
  const isEmpty = (p) => !clean(p.firstName) && !clean(p.lastName) && !clean(p.email);

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const prettyBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return { SELF_ID_LABELS, defaults, blank, tidyProfile, fullName, isEmpty, download, prettyBytes };
})();

if (typeof module !== 'undefined') module.exports = AutoInternship; // for tests
