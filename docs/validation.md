# Initial preview validation

Date: 1 November 2026.

## Verified locally

- Node v26.12.1 on Windows.
- 28 automated tests passing with disposable SQLite databases and simulated
  GitHub, OpenAI, Anthropic and compatible-provider responses.
- HTTP bootstrap/login/CSRF, document version conflicts and replay keys.
- MCP initialization, scoped discovery, denied writes and revocation.
- OAuth registration, exact redirect checks, PKCE, audience and single-use exchange.
- GitHub App read permissions and short-lived token caching with synthetic keys.
- Complete autonomous audit on a synthetic source tree, with commit-pinned
  evidence, persistent activity, budget failure and interruption handling.
- Scheduling across spring and autumn daylight-saving transitions.
- Secret encryption, consistent backup and restore integrity/revocation.
- Linux / Node 24 automated tests passing inside a disposable, read-only container
  with external networking disabled.
- Docker Compose image build, healthy startup, first-account creation and
  administrator persistence after restart.
- Browser verification: navigation, document creation, routine creation in pause,
  configuration save and dashboard rendering on the local demonstration instance.

No private repository was sent to a provider and no real provider API call was
made. The visual demonstration uses only synthetic data and mock services.

## Further compatibility checks

CI is configured for Node 24/26 on Linux and Windows, plus a Docker startup test.
Its status must be checked on the public repository after publication.

Real account/model compatibility is checked by the user-facing connection test.
Hardware-specific performance, Raspberry Pi operation, arm64 image builds and
real external MCP client journeys remain to be measured on the target systems.

This file records observed checks; it is not a claim of an independent security
audit or of universal model compatibility.
