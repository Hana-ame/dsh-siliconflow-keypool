# dsh-siliconflow-keypool

SiliconFlow provider for DeepSeek Harness with a **per-session key pool**.

- Upstream: SiliconFlow's OpenAI-compatible gateway (`https://api.siliconflow.cn/v1`).
- Route: `siliconflow-pool` (provider label `SiliconFlow · Key Pool`).
- One key per session, fixed for the session's whole lifetime.
- 1,048,576-token context window and 384,000-token output ceiling per model.
- Automatic round-robin for new sessions, or a manual default key chosen on
  the Settings page. Key aliases are not shown as model-picker rows.
- Local OpenAI-compatible gateway with both Chat Completions and the **Codex
  Responses API**.

The route id is not `siliconflow` on purpose: the web profile already registers
`siliconflow` through `llm-pi-ai`, and two adapters cannot own one route. The model
ids, upstream URL, and wire format are the same as the existing provider.

## Key policy

```
session A ── first request ──▶ k1 ── every later turn ──▶ k1
session B ── first request ──▶ k2 ── every later turn ──▶ k2
session C ── first request ──▶ k1   (round-robin)
```

- `mode: "auto"` — new sessions take the next alias (`k1`, `k2`, ...).
- `mode: "manual"` — new sessions take `defaultKey`.
- A 429/401 never switches keys. The session fails with that key; the next turn
  still uses it. Retries on 429/5xx reuse the same key with backoff.

## Retry policy

The adapter retries the same key itself; the harness-level retry plugin is
deliberately kept inert (`maxRetries: 0`) so one failure is not replayed twice.

| Setting | Default here | Meaning |
|---|---|---|
| `retryableCodes` | `RATE_LIMIT`, `TIMEOUT`, `SERVER`, `TRANSPORT` | which failure codes are retried (HTTP 429 → `RATE_LIMIT`) |
| `maxRetries` | `3000` | retries after the first dispatch |
| `retryBaseDelayMs` | `1000` | first backoff delay |
| `retryMaxDelayMs` | `6000` | backoff ceiling (exponential 1s → 2s → 4s → 6s …) |

The loop stops early when the caller aborts. A code outside `retryableCodes`
(for example `INVALID_CREDENTIAL`) fails immediately. These fields are read
live from `settings.json`, so editing them does not require a DSH restart
(the running Host reads the file on the next request).

Bindings and the round-robin cursor persist in
`~/.dsh/siliconflow-keypool-state.json` (mode `0600`), so a DSH restart does not
silently move existing sessions to another key.

## Configuration

Keys are entered in exactly one place: **Settings → SiliconFlow Key Pool** in the
DSH web UI. That section adds, replaces and removes aliases, chooses automatic
or manual assignment, and writes `settings.json` through a loopback-only admin
route. The same page also exposes the retry count (`maxRetries`), the backoff
window (`retryBaseDelayMs` / `retryMaxDelayMs`) and the retry scope
(`retryableCodes`). There is no environment-variable key source and no
credential-ref fallback; the page is the single source of truth.

The browser sends a secret only in the POST body; the GET response returns
aliases plus masked values. Writes preserve every other field in
`settings.json` and are atomic with mode `0600`.

`settings.json` is therefore the storage file, not a second input surface:

```json
{
  "baseURL": "https://api.siliconflow.cn/v1",
  "chatPath": "/chat/completions",
  "mode": "auto",
  "defaultKey": "k1",
  "keys": [],
  "timeoutMs": 120000,
  "maxRetries": 3000,
  "retryBaseDelayMs": 1000,
  "retryMaxDelayMs": 6000,
  "retryableCodes": ["RATE_LIMIT", "TIMEOUT", "SERVER", "TRANSPORT"],
  "defaultModel": "deepseek-ai/DeepSeek-V4.1-Flash",
  "gateway": {
    "enabled": true,
    "path": "/api/siliconflow-keypool/v1",
    "token": ""
  }
}
```

Non-key transport overrides still exist for headless/CI profiles:

| Variable | Effect |
|---|---|
| `SILICONFLOW_BASE_URL` | upstream base URL |
| `SILICONFLOW_MAX_RETRIES` | same-key retries on retryable failures |
| `SILICONFLOW_RETRY_CODES` | comma-separated retry scope (e.g. `RATE_LIMIT,SERVER`) |
| `SILICONFLOW_STATE_PATH` | binding-state file |
| `SILICONFLOW_GATEWAY_ENABLED` | `0` to disable the local gateway |
| `SILICONFLOW_GATEWAY_PATH` | gateway mount path |
| `SILICONFLOW_GATEWAY_TOKEN` | require a bearer token on the gateway |

Saving from the settings page emits `llm/adapters-updated`, so new aliases
appear in the bottom-right picker without a page reload. Loading the plugin
itself still requires a DSH restart.

## Models and context

Settings → **SiliconFlow Key Pool** contains a **Models & context** table. Each
row lists and lets you edit:

- model id and display name
- `contextWindow` (currently 1,048,576)
- `maxOutput` (currently 384,000)
- **text / image** input modalities

The table also selects the default model and can add/remove rows. Saving writes
the list to `settings.json`; it never syncs upstream and never changes a model
on its own. The bottom-right DSH model picker is still where the active session
model is chosen.

## Model selection

Each advertised model uses a **1,048,576-token context window** and a
**384,000-token output ceiling** (the 1M / 384K profile). The picker shows each
model once; key aliases are **not** expanded into `model · key k1` rows:

```
siliconflow-pool / deepseek-ai/DeepSeek-V4.1-Flash
```

In the web UI, click the model label at the **bottom-right of the composer**
and pick the `SiliconFlow · Key Pool` group. The session store assigns exactly
one key to the session; choose automatic round-robin or a manual default on the
Settings page. Key aliases are not encoded into the picker model ids.

## Codex interface

Codex speaks the OpenAI Responses API. The plugin mounts a local gateway:

```
base URL:  http://127.0.0.1:3080/api/siliconflow-keypool/v1
wire_api:  responses
```

Example `~/.codex/config.toml` profile (also in `docs/codex.config.example.toml`):

```toml
[model_providers.siliconflow_keypool]
name = "SiliconFlow Key Pool"
base_url = "http://127.0.0.1:3080/api/siliconflow-keypool/v1"
env_key = "SILICONFLOW_KEYPOOL_TOKEN"
wire_api = "responses"
http_headers = { "x-siliconflow-session" = "codex-local", "x-siliconflow-key" = "k1" }
```

- `x-siliconflow-key` pins the alias for this Codex process; omit it to let the
  pool assign one on the first request and keep it.
- `x-siliconflow-session` names the session for the binding store.
- `env_key` must be set to a non-empty value for Codex to send an
  `Authorization` header. Unless `gateway.token` is configured, the gateway
  ignores that header; a local loopback endpoint is the trust boundary.

Gateway endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/siliconflow-keypool/v1/models` | OpenAI model list (plain ids, no key aliases) |
| `POST` | `/api/siliconflow-keypool/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/api/siliconflow-keypool/v1/responses` | OpenAI Responses / Codex |
| `GET` | `/api/siliconflow-keypool/v1/status` | masked key pool + session bindings |
| `GET` | `/api/siliconflow-keypool/admin/config` | Settings page: aliases + masked keys |
| `POST` | `/api/siliconflow-keypool/admin/config` | Settings page: save keys (loopback only, JSON) |

Set `gateway.token` (or `SILICONFLOW_GATEWAY_TOKEN`) when the web server is
reachable beyond loopback; the gateway then requires
`Authorization: Bearer <token>`.

## Install / verify

```sh
# already installed into the web profile:
dsh plugin --profile web add /home/lumin/.dsh/plugins/dsh-siliconflow-keypool

# the bundle lands in the profile package and the composed config:
dsh --profile web --dump-config | grep -n -A3 'siliconflow-keypool'
```

Restart DSH after installing so the Host half and the Settings section load.
Then open **Settings → SiliconFlow Key Pool** and enter keys there. Key edits do
not need a restart.

## Tests

```sh
cd /home/lumin/.dsh/plugins/dsh-siliconflow-keypool
node --test test/*.test.js
```

The suite covers round-robin/session pinning, persistence, explicit alias
rebinding, no-switch-on-429, message projection, SSE fragmentation, non-stream
JSON, Responses conversion, a real local HTTP gateway round-trip for both Chat
Completions and Codex Responses, the single-source settings loader, and the
loopback-only settings admin route.

## Layout

```
dsh-siliconflow-keypool/
├── index.js              entry: register route + mount gateway/admin
├── client.js             Settings → SiliconFlow Key Pool page
├── cordis.patch.yml      bundle insert line
├── settings.json         your keys (not committed anywhere)
├── settings.example.json non-key defaults (keys empty)
├── src/
│   ├── adapter.js        7-method adapter
│   ├── keypool.js        alias pool + session binding store
│   ├── settings.js       settings.json + transport env
│   ├── admin.js          loopback key read/write route
│   ├── messages.js       DSH messages → OpenAI chat body
│   ├── upstream.js       one HTTP attempt + error classification
│   ├── stream.js         SSE/JSON → DSH StreamChunk
│   ├── responses.js      Responses ↔ Chat + Codex SSE events
│   └── gateway.js        local OpenAI/Codex HTTP gateway
└── test/
```
