# Cloud resource metrics and Liquid Glass

## User request

Upgrade the existing Process dashboard with the CPU, memory, storage and compute visualizations shown in the supplied reference, and install and apply Taste with an Apple Liquid Glass appearance.

## Design decisions

- Apply the official Taste Original Frontend v1 instructions from `Leonxlnx/taste-skill-classics`, pinned to `5e08c9383dc4ad7fc0df70e1ac8cfa09ec356305`. Keep the existing Astro architecture and data-driven filtering.
- Use restrained motion, a neutral cool palette, a single teal interface accent, tabular numeric figures, inner edge highlights and tinted shadows. Glass controls sit above legible frosted resource cards.
- Follow Apple's material hierarchy: emphasize navigation and filters with glass; keep data surfaces sufficiently opaque for readable small text. Reference: <https://developer.apple.com/design/human-interface-guidelines/materials>.
- Use two resource columns on desktop and one below 768px, with a compact header and two-by-two hardware panels on phones. Preserve keyboard focus, empty search states and reduced-motion/transparency fallbacks.

## Data semantics

The current resource ledger has recorded hardware configurations, but no CPU load, RAM used, disk used or GPU utilization readings. A capacity visualization must not imply measured consumption. CPU core blocks and GPU chips represent recorded quantities; memory and disk show their total and an explicitly unmeasured usage state.

Each curated resource receives typed `metrics`. Modes distinguish `capacity`, `usage`, `balance` and `unknown`; basis distinguishes a recorded configuration, plan limit, actual observation and unknown data. Only comparable provider observations may produce `percent`. An observed zero is valid. Over-limit percentages retain their numeric value while the visual fill is capped to the available track. Neither plan limits nor missing history supply a missing usage denominator.

Firecrawl was checked through the connected service at `2026-11-22T21:53:21Z`: 1,025 credits remained against 1,000 reported plan credits. Historical endpoint usage returned no periods. Display the balance and its observation timestamp; do not infer negative consumption or treat absent history as zero usage.

The refreshed raw observation is retained in the private ledger commit `1671dc8e0ca9cbbf89f8e8a4f1ddd90715e562e5`. The source catalog and acquisition ledger are unchanged. Public export remains a field and resource allowlist, excluding credentials, account identifiers, instance details and private free text.

## Verification

Validate numerical and provenance boundaries in exporter tests; build Astro and Wrangler; inspect the deployed preview at phone and desktop widths; verify filtering and resource counts; then publish the reviewed files through the existing GitHub and Cloudflare deployment. Layout and synthetic measurement fixtures are preview-only.
