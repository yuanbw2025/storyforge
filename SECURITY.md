# Security Policy

StoryForge stores manuscripts and project data in the user's browser. Security reports involving data loss, unintended disclosure, import/export corruption, credential exposure, or dependency vulnerabilities are treated as release blockers.

## Supported Version

Only the latest commit on `main` and the latest GitHub Release receive security fixes. Older source archives should be upgraded after exporting a JSON backup.

## Reporting

Do not open a public issue for an exploitable vulnerability or include real manuscripts, API keys, access tokens, backup files, or personal data in a report.

Use GitHub's private vulnerability reporting or Security Advisory flow for this repository. Include:

- affected commit, release, and build identifier;
- reproduction steps using synthetic data;
- expected and actual behavior;
- impact assessment;
- a proposed fix when available.

## Response Process

1. Confirm receipt and reproduce with synthetic data.
2. Classify data-loss, credential, remote-code, and backup-integrity risks first.
3. Prepare a fix on a non-`main` branch with regression coverage.
4. Run the complete CI, production dependency audit, and relevant browser tests.
5. Publish the fix and disclose details only after users have a safe upgrade path.

Production dependencies are checked with `npm run check:dependencies`. A moderate-or-higher production advisory blocks CI until upgraded or documented through a time-limited architecture exception.
