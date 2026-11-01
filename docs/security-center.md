# Security Center — agents and personalization

Open `/metis/securite`. On a fresh installation, or after upgrading from beta 2,
the center redirects to **Agents et modèles** until setup is explicitly completed.
Existing automatic routines are paused once during migration; documents, findings,
jobs and credentials are retained. No model request is made merely by starting
the server or opening a page.

## Initial setup

1. Select GitHub repositories and verify access. Public repositories may not need
   a token; private repositories require the configured read-only credential.
2. Configure the **Auditeur** and **Gestionnaire** roles. Each has its own name,
   provider, model identifier, optional compatible endpoint, instructions, daily
   time, timezone and per-job budget. A role may be explicitly disabled; at least
   one must remain enabled.
3. Use a dedicated API key for each role, or explicitly reuse the general key
   when the provider and endpoint match. Dedicated credentials are encrypted in
   the instance store and never returned by the configuration API.
4. Test the enabled models. The test is a small billed request requiring a real
   function call. An earlier test is reusable only for the exact same provider,
   model, endpoint and credential. Model IDs are entered from the user's own
   account; no model or price is assumed.
5. Complete setup and explicitly choose whether to activate the daily routines.
   Leaving activation unchecked creates paused routines. One routine is created
   per enabled role and selected repository. Later edits are managed in Routines.

Saving agent settings requires validating setup again. Replacing a model, endpoint
or credential invalidates its connection test. Changing repository selection or
GitHub credentials invalidates the repository-access check. Tests cannot validate
settings that changed while the network response was pending.

## What each role does

The auditor reads permitted source at a pinned commit. Candidate findings require
an exact excerpt from a passage it actually read. It does not execute repository
code. The manager reads the observed pull-request state and proposes bounded next
actions for existing finding IDs using its own model. Its recommendations do not
confirm a vulnerability, merge a PR or declare a fix revalidated.

Every queued job records its agent and model. If their credential or model changes,
the queued job is rejected before another model request and retains its original
provenance. Failed billed requests keep their conservative reservation. Resuming
is explicit and uses the remaining budget; an exhausted job needs a new launch.
Per-role limits cap the limits requested by individual jobs and routines.

The dashboard shows actual job states, consumption, next scheduled passages and
logs. A completed static audit counts as an observed repository, with limited
coverage; it is not a guarantee that the repository is safe. The existing connector
audit records remain available separately.

## Personalize the sidebar

Open **Personnaliser l’interface** (`/metis/apparence`) to change the main name,
workspace name, subtitle, navigation heading, search placeholder, menu labels,
their order, visibility and counters. The settings links remain accessible.
Hidden entries do not delete content or change permissions. **Rétablir les valeurs
d’origine** loads the defaults for review; saving applies them.

Publication categories and the Security Center groups remain separately editable
at `/metis/categories`. Appearance and agent settings use revision checks so a
stale tab cannot silently overwrite newer changes.

## Further improvements to consider

- An independent reviewer model that challenges a candidate before escalation,
  with separate evidence and budget tracking.
- A true aggregate daily or monthly spending cap across repositories, in addition
  to the current per-job caps and visible consumption.
- Opt-in notifications for actionable findings, stalled work and exhausted budgets,
  with deduplication and a user-controlled destination.

These extensions are proposals, not enabled services. The isolated Lab runner,
automatic patch generation and PR creation are not part of this release.
