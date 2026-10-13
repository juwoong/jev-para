# Jev PARA v0.3.3

An Obsidian desktop plugin that organizes Inbox notes into PARA folders using Jev and the criteria in each folder's `INDEX.md`. Here, syncing means organizing the local Inbox, not synchronizing with external storage.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from the [v0.3.3 release](https://github.com/juwoong/jev-para/releases/tag/v0.3.3). Place them in your vault's `.obsidian/plugins/jev-para/` directory, then enable **Jev PARA** under **Settings → Community plugins**.

The interface and new INDEX templates use English. Existing Korean INDEX sections remain supported. After updating the files, disable and re-enable the plugin or reload Obsidian.

### Build from source

1. Run `npm install`, then `npm run build` in the repository root.
2. Copy the build artifacts into your vault:

   ```bash
   JEV_PARA_VAULT=/path/to/vault npm run install:testing
   ```

   This copies `main.js`, `manifest.json`, and `styles.css`. Without `JEV_PARA_VAULT`, the script defaults to the developer's testing vault at `/Users/juwoong/vaults/testing`.
3. Enable **Jev PARA** under **Settings → Community plugins**.

## API token

Under **Settings → Jev PARA → API key source**, choose one of the following options. **Enter in settings** is the default.

**Enter in settings** — Paste your token into **API token** and click **Save**. Saved tokens are not displayed again. The plugin uses Obsidian secret storage (`app.secretStorage`) when available. On older versions, it stores the token in the plugin's `data.json` and explains this in settings. Click **Delete** to remove the saved token.

**Read from .env** — Read `JEV_API_KEY` from a local `.env` file. The default path is `_dev/jev-para/.env`, relative to the vault. Explicit absolute paths are also supported; relative paths must stay inside the vault.

```dotenv
JEV_API_KEY=your_api_token
```

Saving a token automatically runs a connection test. The result appears in a notice and under **Token status**. Use **Test connection** in settings or the organizer to test again. The test makes one API request with short synthetic input and does not send note content. Both token sources support **Reload token**.

If you use `.env`, exclude it from vault sync or backup tools as appropriate. `.gitignore` only excludes files from Git.

## Folder criteria

Creating a folder directly under `1. Projects`, `2. Areas`, `3. Resources`, or `4. Archives` automatically creates an `INDEX.md` file inside it. Use **Create folders** in settings to create any missing PARA root folders, including `0. Inbox`.

Fill in **Description** to make a folder eligible as a destination. **Include** and **Exclude** are optional criteria that help guide classification. Folders with empty descriptions are excluded.

```markdown
---
para: projects
---

# Service launch

## Description
Prepare the beta launch of a new service.

## Include
- Launch schedules and checklists
- Beta user feedback

## Exclude
- Routine business operations → 2. Areas/Business operations
```

Existing Korean section headings remain supported. When both English and Korean sections are present, a nonempty English section takes precedence; otherwise, the corresponding Korean section is used. Existing INDEX files are preserved.

Destination folders must be direct children of a PARA root. Folders whose names start with `_` or `.` are excluded from INDEX generation and classification. Archives folders receive INDEX files but are never automatic classification destinations.

## Manual sorting

The default mode is **Manual preview**. Open the organizer using the sparkle ribbon icon or the **Open Jev PARA organizer** command, then click **Analyze**. Each result shows its destination, confidence, selected probability, and top candidates.

Results appear in this order: **Ready to move → Needs review → Errors → Skipped**. Within each group, results are sorted by descending confidence. Ties retain their original order, and results without confidence appear last within their group. The list updates as analysis results arrive.

Select rows and click **Move selected**, or click **Move all ready** to move every eligible note in one operation. You can override a destination using the dropdown in its row.

Confidence describes certainty in the chosen destination, including **Keep in Inbox**. A high-confidence decision to keep a note in Inbox does not make it ready to move.

## Automatic sorting

Set **Sorting mode** to **Automatic sorting** to analyze Inbox notes after the settle time has passed since their last edit (30 seconds by default). Notes move only when all thresholds are met:

- Confidence: at least 0.80.
- Selected probability: at least 0.80.
- Difference between the top two probabilities: at least 0.20.

Notes below any threshold, or with tied top probabilities, remain for review. Notes classified as **Keep in Inbox** stay in Inbox.

Authentication errors pause automatic sorting and prompt you to check the token. You can also use **Pause automatic sorting** in the organizer.

## Undo

**Undo last run** restores the files moved in the last operation to their original locations. If a file has been edited since the move, or another file occupies its original path, that item is skipped with an explanation.

An undone note is held to prevent it from being automatically moved again with unchanged content. Editing its content allows it to be analyzed again.

## Limitations

- Only Markdown notes are moved. PDFs, images, and other attachments are counted but not moved.
- Only notes directly inside `0. Inbox` are processed. Nested Inbox folders are excluded.
- Already organized notes are not automatically reclassified. Move them back into Inbox to make them eligible again.
- Project completion is not inferred. Move completed projects into `4. Archives` yourself.
- Classification does not summarize or rewrite notes, or invent new destination folders.
- Moves use Obsidian's file-moving functionality, so link updates follow your Obsidian settings. Notes that cannot be moved safely are left for review.

## Development and testing

```bash
npm run typecheck   # TypeScript checks
npm test            # Scenario-based tests
npm run dev         # Development bundle with source maps
npm run build       # Production bundle
JEV_PARA_VAULT=/path/to/vault npm run install:testing
npm run test:live    # Live API tests; requires credentials and makes API requests
```

The implementation contract is in [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md), and test scenarios are in [TEST_SCENARIOS.md](TEST_SCENARIOS.md). These development documents are currently in Korean. Live API tests are separate from the default test suite.

## Privacy

Analysis sends note titles, note content, and folder criteria to the configured Jev API endpoint. Tokens and note bodies are not written to plugin logs.
