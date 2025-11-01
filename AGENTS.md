# Repository Guidelines

## Project Overview
This is a web automation tool for the Oliver Library System that automatically catalogues books using ISBN numbers via Playwright browser automation.

## Project Structure & Module Organization
- `index.js` is the **only** entry point - a single-file CLI tool for uploading ISBNs to Oliver Library using Playwright
- `isbns.example.txt` provides sample input format; working copies like `isbns.txt`, `session.json`, and `report.txt` are runtime artifacts (git-ignored)
- Configuration is sourced from `.env` (copy from `.env.example`), dependencies managed via `package.json` and `pnpm-lock.yaml`
- `README.md` contains comprehensive user documentation with Windows-first instructions

## Build, Test, and Development Commands
- `npm install` (or `pnpm install`) installs Playwright and dotenv dependencies
- `npm run start <input>` runs the automation with either:
  - Single ISBN: `node index.js 9780545139700`
  - File path: `node index.js isbns.txt`
- Environment variables:
  - `HEADLESS=true` runs browser in headless mode (no visible window, better performance)
  - `DEBUG=1` enables verbose logging for troubleshooting
  - Combine them: `DEBUG=1 HEADLESS=true node index.js isbns.txt`

## Architecture & Key Functions

### Core Workflow
1. **Session Management**: `session.json` persists login state between runs
2. **Navigation**: Two-path approach:
   - Direct URL navigation (`attemptDirectSmartCatalog`)
   - Menu-based navigation fallback (`attemptMenuSmartCatalog`)
3. **ISBN Processing**: Each ISBN is searched, evaluated, and catalogued automatically
4. **Reporting**: Results saved to console and `report.txt`

### Critical Bug Fixes Applied
- **Dialog Handling**: WeakSet prevents duplicate event handler registration on page objects
- **Menu Item Selection**: Handles duplicate `#menuItem_smartCataloguing` elements (one hidden, one visible) by explicitly finding the visible element
- **Navigation Optimization**: Avoids unnecessary page reloads that trigger `beforeunload` dialogs
- **Error Handling**: Gracefully continues processing remaining ISBNs even when individual items fail

### Key Functions
- `registerPageEventHandlers(targetPage)`: Sets up dialog auto-accept handlers (uses WeakSet to prevent duplicates)
- `loginThroughPopup()`: Handles Oliver's modal login dialog
- `attemptDirectSmartCatalog()`: Tries direct URL navigation to Smart Cataloguing
- `attemptMenuSmartCatalog()`: Fallback menu-based navigation when direct fails
- `ensureSmartCataloguingPage()`: Orchestrates both navigation strategies
- `processISBN(isbn)`: Main processing loop for each ISBN
- `runOliverAutomation(isbns)`: Top-level orchestrator

## Coding Style & Naming Conventions
- Use two-space indentation, semicolons, and ES6 import/export (module type)
- Favour `const`/`let` over `var`, async/await over promise chains
- Descriptive function names with `ensure*`, `attempt*`, `navigate*` prefixes
- Keep code in `index.js` unless complexity demands separate modules
- Comprehensive logging with `→` prefix for action tracking

## Testing Guidelines
- **No automated tests** - validate changes manually with both single ISBN and file-based inputs
- Test both visible and headless modes
- Verify `report.txt` generation and `session.json` persistence
- Test scenarios:
  - Fresh login (delete `session.json`)
  - Session reuse (existing `session.json`)
  - Mixed results (existing, new, not found ISBNs)
  - Error handling (network issues, invalid ISBNs)
- Document manual test steps when changing behavior

## Windows User Focus
- Primary users are Windows-based librarians with limited CLI experience
- README provides Windows-first instructions (PowerShell and CMD)
- Include platform-specific examples for all commands
- Troubleshooting section covers common Windows issues (.env.txt vs .env, PATH issues, etc.)

## Commit & Pull Request Guidelines
- Write imperative commit subjects under 72 characters (e.g., `Fix duplicate menu item selection bug`)
- Include context in commit body for multi-file changes
- Reference related issues in PR description
- Attach console output or screenshots for UI/behavior changes
- Verify `.env.example` reflects any new environment variables

## Security & Configuration Tips
- **Never commit**: `.env`, `session.json`, `report.txt`, `isbns.txt`, or any credential-bearing files
- Confirm sensitive files remain in `.gitignore`
- Rotate Oliver credentials if accidentally exposed
- Clear `session.json` when sharing the tool or changing users
- Session files contain authentication tokens - treat as secrets

## Known Issues & Gotchas
- Oliver's Smart Cataloguing page has duplicate DOM elements with same ID (`#menuItem_smartCataloguing`) - code explicitly targets visible element
- Frequent `beforeunload` dialogs require auto-accept handling
- Direct navigation often fails due to session/permission issues - menu fallback is critical
- Oliver keeps long-running background requests, causing `waitForLoadState('networkidle')` to timeout - use `'load'` state instead
- Login success is verified by presence of `#window_logout` element

## Performance Considerations
- Headless mode runs faster (no 100ms slowMo delay)
- Session persistence dramatically speeds up subsequent runs
- Each ISBN processes sequentially to avoid overwhelming the server
- Wait timeouts are tuned for Oliver's slow page loads (20s for menus, 15s for elements)
