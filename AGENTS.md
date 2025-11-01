# Repository Guidelines

## Project Structure & Module Organization
- `index.js` is the main CLI entry point; use it for uploading ISBNs interactively via Playwright.
- `index-robust.js` contains experimental resilience helpers; treat changes here as optional enhancements.
- `index-api.js` exposes the DWR-backed automation flow for API-style usage.
- Sample inputs live at `isbns.example.txt`; working copies such as `isbns.txt`, `session.json`, and `report.txt` are runtime artifacts and should be git-ignored.
- Configuration is sourced from `.env` (copy `.env.example`), while dependencies are managed through `package.json` and `pnpm-lock.yaml`.

## Build, Test, and Development Commands
- `npm install` (or `pnpm install`) pulls Playwright and dotenv.
- `npm run start` / `npm run search` runs `index.js` and accepts either a single ISBN (`node index.js 978...`) or a file path (`node index.js isbns.txt`).
- `npm run api` executes `index-api.js` for scripted cataloguing; review console output for raw DWR responses.
- When debugging browser steps, add `DEBUG=1` before the command to surface additional logging.

## Coding Style & Naming Conventions
- Use two-space indentation, semicolons, and double quotes to match existing CommonJS modules.
- Favour `const`/`let` over `var`, async/await over promise chains, and descriptive helpers (`ensureLoggedIn`, `navigateToSmartCataloguing`) when adding automation flows.
- Keep new files in the project root unless a dedicated folder (e.g., `lib/`) becomes necessary; name Playwright utilities with the `ensure*` prefix for symmetry.

## Testing Guidelines
- There are no automated tests yet; validate changes by running ISBN workflows against both single-value and file-based inputs.
- Confirm reports (`report.txt`) and saved sessions (`session.json`) behave as expected after your change.
- Document manual test steps in the PR when behaviour changes.

## Commit & Pull Request Guidelines
- Write imperative commit subjects under 72 characters (e.g., `Improve smart cataloguing retry logic`); include context in the body if the change spans multiple files.
- Reference related issues in the PR description, outline test evidence, and attach console excerpts or screenshots for UI-affecting work.
- Flag credentials or session-handling changes for review and verify `.env` updates are mirrored in `.env.example`.

## Security & Configuration Tips
- Never commit `.env`, `session.json`, or other credential-bearing files; confirm they remain listed in `.gitignore`.
- Rotate Oliver credentials promptly if shared outside the trusted team, and remove local session artifacts when onboarding new operators.
