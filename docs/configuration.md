# Configuration

The web interface is the main configuration path. A fresh server has no selected
repositories, no provider credentials and no enabled routines.

## GitHub

For a public repository, enter `owner/repository`, save, and test access. A token
can still be useful to increase the available GitHub API quota.

For private repositories, either:

- Create a **fine-grained personal access token**, select only the intended
  repositories, and grant Contents and Pull requests read permissions.
- Create a **GitHub App** owned by your account or organization, grant Contents
  and Pull requests read permissions, disable unnecessary webhooks, and install it
  on the selected repositories. Under the advanced section of Configuration,
  enter the App ID, Installation ID and PEM private key, then select GitHub App mode.

The server mints short-lived installation tokens and requests only read access.
It never asks for repository write permissions. Registering the App is a one-time
GitHub step; this preview does not automate that registration through a manifest.

Repository selection is enforced independently of the credential's wider rights.
Renamed or moved repositories require selection to be updated. Source trees and
blobs are read through `api.github.com` at a pinned commit, without following redirects.
Source policy excludes common credential files, binary files, symbolic links,
dependency directories and oversized files. This cannot guarantee the removal of
every secret embedded in arbitrary source code.

## Providers

OpenAI uses `https://api.openai.com/v1/responses`, with storage disabled in the
request. Anthropic uses its Messages API. The compatible option uses
`<base URL>/chat/completions` and needs a model that supports function tools.

For a local model on the Docker host, a typical address is
`http://host.docker.internal:11434/v1`. The model server must be configured so the
container can reach it. The app accepts HTTP only for explicit loopback hostnames
and `host.docker.internal`; other provider origins must use HTTPS.

No model identifier is hardcoded. Enter one available to your account or local
runtime. Save before testing. The test requires a successful function call, not
just a generated greeting. Changing provider settings or its key invalidates the
test result and prevents new automatic audits until retested.
Changing the provider or compatible endpoint also clears the previous provider key
so it is not sent to a different service. Enter the key for the new provider when saving.

The APIs remain separate from your MCP client connection. The server does not
extract a ChatGPT or Claude browser session to run automated API calls.

Provider calls use bounded responses and deadlines. There is no automatic retry
after a billed request fails ambiguously. The job retains its reserved consumption.
Usage without a provider count is conservatively estimated, not reported as exact.

## Network

The default web origin is `http://localhost:4880`. For remote clients, put a reverse
proxy or tunnel in front of it and enter the external **HTTPS origin**, without a
path, as the public address. TLS termination belongs to the proxy/tunnel.

The server checks the Host header against loopback and its configured public host.
It ignores forwarded identity and IP headers. Configure the immediate proxy to
preserve the intended Host header. Do not expose the local HTTP port directly.

Changing the public origin invalidates Bearer tokens bound to the old MCP audience;
reconnect the affected clients.

## Optional environment settings

| Variable         | Default                          | Use                                                          |
| ---------------- | -------------------------------- | ------------------------------------------------------------ |
| `METIS_DATA_DIR` | `./data` relative to the project | Database, keys and first-install token                       |
| `METIS_HOST`     | `127.0.0.1`                      | Listening interface; the container uses `0.0.0.0` internally |
| `PORT`           | `4880`                           | Listening port                                               |

No GitHub, OpenAI or Anthropic secret is inherited from unrelated environment
variables. Credentials are entered explicitly and stored encrypted in the instance.
