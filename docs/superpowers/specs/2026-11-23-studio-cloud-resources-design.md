# Studio cloud resources design

## Intent
Publish the user's existing free cloud resource records at /category/process, using the supplied mobile screenshots as the visual reference.

## Approach
Use a dedicated Astro page within the existing Studio deployment. This keeps the existing domain and GitHub-to-Cloudflare deployment. An iframe would add a second hosting dependency; replacing the whole site would expand the task unnecessarily.

## Scope
Use pale green backgrounds, rounded white resource cards, coloured provider initials, category counts, search, claimed/registered filters, configuration tiles, recorded status, date information and provider console links. Default to claimed resources. Show registered resources as awaiting integration and keep that count separate. Retain any Process posts beneath the dashboard.

## Data
Publish a curated allowlist export from Miki-BadBrowserUse. Never copy private free-text notes, evidence links, account IDs, instance names or credentials. State that statuses are recorded observations. Unknown runtime configuration and expiry remain unknown. A historical usage value must carry its observation time.

## Integration and validation
Add src/pages/category/process.astro and exclude process from the existing dynamic category route. Build with the existing Astro and Wrangler versions. Verify filtering, empty search, mobile widths, keyboard access, secret exclusion, generated route, and Cloudflare deployment result. Push through GitHub API with an expected-head check.

## Decisions
The user selected the location and screenshot style. Retain all unrelated site routes and infrastructure. No provider-side provisioning or paid service is needed.

