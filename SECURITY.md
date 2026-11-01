# Security model and reporting

This is an initial public preview. Report vulnerabilities privately to the project
owner through an available private GitHub reporting channel. Do not post real
credentials or undisclosed customer/repository findings in public issues.

## Boundaries

- One administrator owns the instance and its data. This is not a multi-tenant service.
- Browser sessions use HttpOnly, SameSite cookies. Writes check the configured
  origin and a CSRF token. HTTPS enables Secure cookies.
- Initial account creation requires a private single-use bootstrap code from the server.
- Integration tokens are random, hashed in SQLite, scoped, expiring, revocable and
  bound to the instance's canonical MCP audience. OAuth uses exact registered
  redirects, authorization code, PKCE S256 and explicit consent.
- The public origin is explicitly configured. Host/Origin checks do not trust
  arbitrary forwarded headers to establish identity or authority.
- Provider/GitHub secrets use AES-256-GCM with field-bound associated data and a
  separate instance key. Unix files are created with restrictive modes. On Windows,
  protect the data folder with account-level filesystem permissions; Unix mode bits
  alone do not set Windows ACLs.
- The machine administrator can read the instance key and decrypted data. This is
  not end-to-end encryption. Selected source excerpts are sent to the configured provider.
- Repository text, comments, filenames and AI output are untrusted. The audit agent
  can only list permitted paths, read bounded passages, record matched evidence and
  finish its report. It has no shell, direct network, secret-store or PR-writing tool.
- No repository code or package lifecycle script is executed by the audit path.
  A text instruction alone is not relied on to isolate code execution: execution
  capability is absent from the tool dispatcher.
- Source exclusions and token redaction reduce accidental disclosure, but cannot
  establish that arbitrary source contains no sensitive information.
- Queue state, occurrence keys and pre-call usage reservations reduce duplicate
  work after interruptions. Failed requests are not automatically retried.

An isolated code-execution runner, multiple independent tenants, automated PR
creation, full Atlas import and a complete external security audit are outside
this preview. Do not infer those guarantees from the name Security Center.

## Development

Run `npm test` and `npm run check:release`. Tests use synthetic credentials and
mock upstream services. Preserve the separation between control credentials and
untrusted repository content when adding future execution capabilities.
