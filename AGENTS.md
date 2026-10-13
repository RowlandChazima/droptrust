<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DropTrust Capture — Engineering and Git Rules

## Project constraints

- Use JavaScript and JSX for application code. Do not introduce TypeScript application files unless I explicitly approve the change.
- Use pnpm on Windows (`pnpm.cmd`).
- Follow the approved DropTrust architecture and design system. Do not replace the chosen stack or introduce unnecessary libraries.
- Keep the implementation incremental. Work on one approved milestone or small feature at a time.
- Do not begin implementation until I explicitly approve it.

## Git and GitHub workflow

- Never commit directly to `main` or push changes directly to `main`.
- Before starting work, inspect `git status`, the current branch, and the remote. Never overwrite or discard existing user changes.
- Create a dedicated branch for each approved milestone or feature. Use short, plain names with no prefixes, such as `receipts`, `paypal`, or `manual-orders`. Do not use `feat/`, `fix/`, `chore/` or similar.
- Commit completed work in small, logically grouped commits. Write commit messages as plain, short sentences in the imperative, such as `Add public receipt page` or `Mask customer phone on receipts`. Do not use Conventional Commit prefixes like `feat:`, `fix(scope):` or `chore:`.
- Push only the working branch to the configured GitHub remote.
- Open a **draft pull request** targeting `main` after pushing. Give it a plain, short title that describes the change, such as `Public receipt page`. No prefixes, no milestone numbers, no taglines. Do not merge it, mark it ready for review, or close it without my explicit approval.
- Never force-push, reset away user changes, amend published commits, rewrite shared history, or delete branches without my explicit approval.
- Never commit `.env`, `.env.local`, API keys, passwords, service-role keys, private customer data, or other secrets. Check the staged diff before committing.
- Do not execute destructive database operations, production migrations, or deployment commands without my explicit approval.

## Verification and reporting

- Run appropriate checks before committing, including linting, tests, and a production build when available.
- Report each command actually run and whether it passed or failed. Do not invent test results.
- Inspect `git diff` and `git diff --cached` before committing.
- After pushing, provide the branch name, commit SHA(s), remote push result, and draft pull-request URL.
- In the pull-request description, include:
  1. What changed and why.
  2. Files or areas changed.
  3. Commands run and their real results.
  4. Manual testing steps and results.
  5. Screenshots for meaningful UI changes, when available.
  6. Known limitations, security considerations, and unfinished work.
- Do not claim code is pushed, tested, deployed, or merged unless the corresponding action has actually succeeded.
- If GitHub authentication, permissions, network access, a test, or a command fails, stop and explain the blocker instead of pretending it succeeded.

## Approval boundary

My approval is required before implementation starts. Once implementation is approved, you may create a feature branch, implement the approved scope, run checks, commit, push that feature branch, and open a draft pull request. I alone decide whether to approve, mark ready, and merge the pull request.
