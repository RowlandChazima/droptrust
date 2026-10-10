# DropTrust Capture

An AI-assisted order capture and transaction record tool that helps small businesses turn handwritten order records, customer conversation screenshots, and manual entries into accurate, searchable digital orders and customer-accessible Trust Receipts.

## Overview

- **Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Supabase (PostgreSQL, Auth, Storage), Google Gemini (`gemini-3.8-flash`), and PayPal Orders v2 Sandbox.
- **Package Manager:** `pnpm` (Windows: `pnpm.cmd`).
- **Core Workflow:** Capture → Extract → Review → Confirm → Share → Track → Learn.

## Getting Started

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

## Engineering Workflow Verification

This repository follows the engineering and Git workflow rules documented in [`AGENTS.md`](./AGENTS.md):

- Dedicated feature branches for all approved milestones.
- Strictly no direct commits or direct pushes to `main`.
- Validation checks run before committing.
- Automated creation of draft pull requests targeting `main`.

