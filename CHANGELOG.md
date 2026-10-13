# Changelog

## 0.3.5 — 2026-10-13

- Remove `.env` support and the Node.js filesystem adapter. API tokens are entered in plugin settings only.
- Remove external file access from the runtime bundle.
- Keep vault access through the Obsidian API.

## 0.3.4 — 2026-10-13

- Add the MIT license and account, network, and external-file disclosures for public distribution.
- Use a release tag matching the manifest version exactly.
- Rename the organizer command ID to avoid repeating the plugin ID (reassign custom hotkeys if needed).

## 0.3.3 — 2026-10-13

- Translate remaining built-in API classification instructions, criteria labels, and connection-test values to English.
- Preserve user-authored content and compatibility with existing Korean INDEX headings.

## 0.3.2 — 2026-10-07

- Group results by Ready to move, Needs review, Errors, then Skipped.
- Sort each group by descending confidence as results arrive.
- Add Move all ready with a count, using existing move checks and undo.

Validation: TypeScript checks, 266 tests, and production build.

## 0.3.1 — 2026-10-07

- Generate INDEX.md with English Description, Include, and Exclude sections and guidance.
- Continue reading existing Korean sections without rewriting user files.
- Prefer nonempty English sections when both languages are present.

Validation: TypeScript checks, 264 unit tests, and production build.

## 0.3.0 — 2026-10-07

- Display analysis results by confidence, highest first.
- Preserve the order of ties and place results without confidence last.
- Keep processing order and row selection unchanged.

Validation: TypeScript checks, 261 unit tests, and production build.

## 0.2.0 — 2026-10-07

- Publish Jev PARA as an independent Obsidian desktop plugin repository.
- Use English settings, organizer controls, notices, and error messages.
- Enter and save a Jev API token directly in settings, with optional .env support.
- Test the API connection after saving a token or with the Test connection button.
- Organize Inbox notes using folder INDEX.md criteria, with manual previews, confidence thresholds, and undo.
- Preserve the existing Korean INDEX.md section format.

Validation: TypeScript checks, 260 unit tests, and production build.
