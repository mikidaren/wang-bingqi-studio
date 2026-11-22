# Studio Cloud Resources Implementation Plan

> **For agentic workers:** Use the assigned file ownership below; the primary agent integrates and reviews the complete result.

**Goal:** Publish a mobile-friendly cloud resource dashboard at the user's existing Process URL.
**Architecture:** Astro renders an allowlisted data snapshot. Small browser-side filters operate on rendered cards. Cloudflare Pages publishes the existing main branch.
**Tech Stack:** Astro 4, CSS, browser JavaScript, Python export script, existing Wrangler build.
**Spec:** ../specs/2026-11-23-studio-cloud-resources-design.md

## Global Constraints
- Target /category/process; use screenshot-inspired pale green cards.
- Never publish credentials or private evidence/account fields.
- Claimed and registered are different; no fabricated live status or quota.
- Keep existing Studio routes working; publish via GitHub API.

## Review Focus
- Unknown provider metrics must remain unknown.
- Search/category/status filters must compose and reset.
- 360px and 390px layouts must not overflow.
- Existing or future Process posts must remain accessible.
- Exported files must contain only deliberate public fields.

## Tasks
- [ ] Export curated public data and test private-field exclusion.
- [ ] Build dashboard component, styles, search and filters.
- [ ] Add dedicated Process page and preserve post listing.
- [ ] Run build, privacy checks, responsive and interaction checks.
- [ ] Review changes independently and publish with expected-head validation.
- [ ] Confirm Cloudflare deployment and final live route.

