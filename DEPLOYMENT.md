# Deployment

PR Preview is a small Node.js Express server that receives GitHub webhooks, builds spec previews, and uploads results to S3. It has no database and no persistent local state.

It is deployed on [Clever Cloud](https://www.clever-cloud.com/), on the Node.js runtime. This document is the runbook for that deployment: what to provision, what to configure, and how to cut over from the old Heroku dyno.

## What this move changes

| | Before | After |
| --- | --- | --- |
| Host | Heroku | Clever Cloud (Node.js runtime) |
| GitHub App | `pr-preview` | **unchanged** — same App, same App ID, same installations |
| S3 buckets | default + WHATWG | **unchanged** — same buckets, same URLs, same fronting layer |

Only the host moves. The GitHub App is not re-registered and the S3 buckets are not touched, so no repository owner has to reinstall anything and every preview URL already linked from an open PR keeps resolving. The single externally-visible change is the App's webhook URL.

## Requirements

- Node.js 20 or newer (see `engines` in `package.json`)
- A public HTTPS endpoint for GitHub to POST webhooks to (Clever Cloud provides one)
- The existing AWS S3 buckets and their credentials
- The existing GitHub App credentials
- Outbound HTTPS access to `api.github.com`, S3, and the spec-generator services listed in `lib/services.js`

## GitHub App

PR Preview is delivered as a [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps): repository owners install it once, GitHub then POSTs pull-request webhook events to a URL the app owns, and the app authenticates back to the GitHub API using a private key (as a JWT-signed App identity) plus per-installation access tokens. See [`lib/auth.js`](lib/auth.js) for the token exchange.

The public listing is at https://github.com/apps/pr-preview and the owner-only settings page is at https://github.com/settings/apps/pr-preview. See the [README](README.md) for the user-facing view (what it does for a PR author/reviewer).

We keep this App. All existing installations (w3c, whatwg, wicg, w3ctag, and individual repos) keep working with no action from repo owners.

**What must change** (at https://github.com/settings/apps/pr-preview):

- **Webhook URL** → `https://<clever-cloud-host>/github-hook`

**What must be re-supplied to Clever Cloud** (the same values Heroku used):

- `GITHUB_INTEGRATION_ID` — the numeric App ID at the top of the App settings page. Never changes.
- `GITHUB_INTEGRATION_KEY` — PEM contents of a private key. Existing keys stay valid; re-use the current one or generate a fresh one under "Private keys" and delete the old.
- `GITHUB_SECRET` — the webhook signing secret. Must match whatever is set on the App settings page.
- `GITHUB_TOKEN` — personal access token used as a fallback for unauthenticated calls.

**What does not change:** permissions, event subscriptions, installations, App slug/icon/homepage.

### Rotating the secrets

The migration is a natural point to rotate `GITHUB_INTEGRATION_KEY`, `GITHUB_SECRET`, and `GITHUB_TOKEN` so any credentials that leaked into Heroku's platform or logs are invalidated. If you rotate: generate the new values, put them in Clever Cloud's env, cut over the Webhook URL, then delete the old private key entry and revoke the old token.

### App configuration reference

The App's current settings, recorded here so they can be reproduced if the App ever has to be registered from scratch:

- **Webhook secret**: a random string; the same value goes in `GITHUB_SECRET`
- **Permissions** (Repository):
  - Contents: Read (to fetch `.pr-preview.json` and source files)
  - Pull requests: Read & write (to update the PR body with preview links)
  - Metadata: Read (granted automatically)
- **Subscribe to events**: Pull request
- **Private key**: a generated `.pem`; its contents go into `GITHUB_INTEGRATION_KEY`
- **App ID**: the numeric ID, into `GITHUB_INTEGRATION_ID`
- Plus a personal access token (fine-grained, `Contents: Read` on target repos is enough) as `GITHUB_TOKEN`

Registering a *new* App is not part of this move: it would be a breaking change requiring every org and repo to reinstall, and would need to be coordinated with w3c, whatwg, wicg, and w3ctag first.

If the App should also change hands (e.g. to a new maintainer or an org account), that is done at **Settings → Developer settings → GitHub Apps → pr-preview → Advanced → Transfer ownership** and is [independent of the host move](https://docs.github.com/en/apps/maintaining-github-apps/transferring-ownership-of-a-github-app) — before, after, or not at all. App ID, private keys, webhook config, permissions and installations all carry over; watch that the `pr-preview` slug doesn't collide on the new owner (a collision renames the app and changes its public URL), and note that `GITHUB_TOKEN` belongs to a user account rather than the App, so a new operator needs to issue a fresh one.

## AWS S3

PR Preview writes preview and diff HTML to S3 and serves the resulting URLs from the PR comment. It uses **two** buckets, dispatched at runtime by the PR owner (see `lib/models/pr.js:200` and `lib/cache.js`):

1. **Default bucket** — used for every repo *except* those owned by `whatwg`. Credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; bucket name comes from `AWS_BUCKET_NAME`. Preview URLs are direct S3 URLs: `https://<bucket>.s3.amazonaws.com/<key>`.
2. **WHATWG bucket** — used only when the PR owner is `whatwg`. Credentials come from `WHATWG_AWS_ACCESS_KEY_ID` / `WHATWG_AWS_SECRET_ACCESS_KEY`; bucket "name" comes from `WHATWG_AWS_BUCKET_NAME`. **This env var holds a hostname, not a plain S3 bucket name** — the URL is built as `https://<WHATWG_AWS_BUCKET_NAME>/<key>` (see `lib/cache.js:17-20`). In production this hostname points at the bucket through a fronting layer (CloudFront distribution and/or a Route 53 alias) so that WHATWG-hosted previews live under a WHATWG-owned domain.

Required S3 permissions on each bucket for the credentials in use:

- `s3:PutObject`
- `s3:GetObject`
- `s3:HeadObject`

Objects should be publicly readable (previews are served directly to browsers from the URLs above), typically via a bucket policy that grants `s3:GetObject` to `*`.

Nothing about the host move requires touching S3. Both buckets stay exactly where they are; the six `AWS_*` / `WHATWG_AWS_*` env vars are simply re-supplied to Clever Cloud. No object copy, no DNS change, no fronting-layer change.

Two knobs worth knowing about, neither of which this move uses:

- Set `ALLOW_MULTIPLE_AWS_BUCKETS=no` to disable the WHATWG bucket path entirely and route every PR through the default bucket — useful if you don't have WHATWG credentials.
- Moving a bucket to a different AWS account is a copy + cutover, not a transfer (S3 bucket ownership cannot be reassigned): create a bucket in the destination account, `aws s3 sync` the objects over, reapply the public-read policy and CORS, repoint any fronting layer, update the env vars, and leave the old bucket up read-only so previously-posted URLs keep resolving.

**Optional credential rotation.** As with the GitHub secrets, the migration is a good time to rotate the IAM access keys so any keys leaked into Heroku's platform or logs are invalidated: issue new keys for the same IAM users, put them in Clever Cloud's env, cut over, then deactivate the old keys.

## Clever Cloud

### Prerequisites

Install and authenticate the CLI ([clever-tools](https://github.com/CleverCloud/clever-tools)):

```
npm install -g clever-tools
clever login
```

Everything below can also be done from the [Console](https://console.clever-cloud.com/); the CLI is used here because it is copy-pasteable.

### Create the application

From a clone of this repository:

```
clever create --type node pr-preview
```

That creates the app, links it to the working directory (writing `.clever.json`), and provisions a git remote. To attach to an app someone else already created, use `clever link <app_id>` instead.

### Build and start

The Node.js runtime needs almost nothing from us:

- **Start command** — the runtime runs `scripts.start` from `package.json`, which is `node index.js`. No `CC_RUN_COMMAND` needed.
- **Dependencies** — installed at build time from `package.json`. Dev dependencies (`mocha`, `supertest`) are *not* installed by default, which is what we want; leave `CC_NODE_DEV_DEPENDENCIES` unset.
- **Build step** — there is none (no `build` script), so nothing runs between install and start.
- **Node version** — pin it explicitly rather than drifting with the platform default:

```
clever env set CC_NODE_VERSION 22
```

### Port

**Clever Cloud only routes traffic to port 8080.** `index.js` reads `process.env.PORT` and falls back to `5000`, so `PORT` must be set explicitly:

```
clever env set PORT 8080
```

Express binds all interfaces by default, which satisfies the platform's requirement that the app listen on `0.0.0.0:8080`.

### Environment variables

Set them with `clever env set <NAME> <value>`, one per variable. See the [full list](#environment-variables-reference) below.

`GITHUB_INTEGRATION_KEY` is the awkward one: it is a multi-line PEM, including the `-----BEGIN`/`-----END` lines. Multi-line values are supported, but passing one as a shell argument is error-prone. Import the whole set from a JSON file instead, escaping newlines as `\n`:

```json
[
  { "name": "GITHUB_INTEGRATION_KEY", "value": "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n" },
  { "name": "GITHUB_INTEGRATION_ID", "value": "12345" }
]
```

```
cat env.json | clever env import --json
```

Do not commit that file — write it outside the repository, or delete it once imported.

After importing, confirm the key survived intact: a PEM whose newlines were flattened produces JWT signing failures at the first webhook, not at boot, so this fails late and looks like a GitHub API problem.

### Instance sizing and scaling

**Run exactly one instance.** The controller keeps its job queue, its `currently_running` de-duplication set, and its previewer cache in process memory (`lib/controller.js:11-16`). A second instance would not see the first one's in-flight jobs, so the same PR could be built twice concurrently and the two runs would race to update the PR body. Do not enable autoscaling.

```
clever scale --flavor S --min-instances 1 --max-instances 1
```

Avoid the `pico` and `nano` flavors: they run at reduced CPU priority and can be starved when the hypervisor is busy. Spec builds are long-running and the WHATWG/HTML path writes a full checkout to scratch space under `os.tmpdir()` (`lib/wattsi-client.js:25`), so give the app real CPU and disk headroom. Size up from `S` if HTML builds time out.

The filesystem is ephemeral — each deploy or restart gets a fresh VM. That is fine here: the only local writes are that scratch space, and nothing is expected to survive. No FS Bucket is needed.

The corollary is that **a restart drops in-flight and queued jobs**. Deploy during quiet periods, and use `STARTUP_QUEUE` (see below) to replay any PRs that were dropped.

### Domain and TLS

The app gets a `*.cleverapps.io` subdomain with working TLS out of the box, which is enough to test the webhook before any DNS change. For a stable public name, add a custom domain:

```
clever domain add pr-preview.example.org
```

Clever Cloud requests and renews a Let's Encrypt certificate automatically. **It only attempts issuance during the first 3 days after the domain is added** — so point DNS at the app first, or at least within that window. If the certificate never appears, remove the domain and re-add it to restart the window.

Whichever hostname you settle on is the one that goes in the GitHub App's webhook URL, so decide before cutting over: moving the webhook URL twice means two windows where deliveries fail.

### Deploy

```
clever deploy
```

This pushes the current branch and triggers a build. Equivalently, add the remote by hand and push to its `master` branch:

```
git remote add clever git+ssh://git@push.clever-cloud.com/<app_id>.git
git push clever main:master
```

Watch the build and the running app with:

```
clever logs
```

A successful boot logs `Express server listening on port 8080 in production mode`. Other useful commands: `clever status` (current state), `clever restart` (restart without redeploying).

If a deploy is marked unhealthy even though the app logged that it is listening, check the health-check configuration in the Console: this app exposes no `GET` route at all — only `POST /github-hook` and `POST /config` — so an HTTP health check against `/` will not get a 2xx.

## Environment variables reference

Set these with `clever env set` / `clever env import`, or in the Console under the app's "Environment variables" tab.

### GitHub App credentials (required)

- `GITHUB_SECRET` — webhook signature validation secret
- `GITHUB_INTEGRATION_ID` — GitHub App ID (used to sign JWTs)
- `GITHUB_INTEGRATION_KEY` — GitHub App private key (PEM contents, including BEGIN/END lines)
- `GITHUB_TOKEN` — GitHub API token used as a fallback for unauthenticated calls

### AWS credentials for the default S3 bucket (required)

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_BUCKET_NAME`

### AWS credentials for the WHATWG bucket

Used when the PR owner is `whatwg`. Set `ALLOW_MULTIPLE_AWS_BUCKETS=no` to skip these and use the default bucket for everyone.

- `WHATWG_AWS_ACCESS_KEY_ID`
- `WHATWG_AWS_SECRET_ACCESS_KEY`
- `WHATWG_AWS_BUCKET_NAME`

### Runtime configuration

- `NODE_ENV` — set to `production` for live operation (gates webhook signature verification and PR comment writes)
- `PORT` — must be `8080` on Clever Cloud (the code defaults to `5000`)
- `ALLOW_MULTIPLE_AWS_BUCKETS` — set to `no` to force use of the default bucket only and ignore `WHATWG_*` credentials
- `STARTUP_QUEUE` — JSON array of PRs to process on startup

### Clever Cloud platform variables

- `CC_NODE_VERSION` — Node.js version to run (pin to `22`)
- `CC_NODE_DEV_DEPENDENCIES` — leave unset; dev dependencies are not installed by default
- `CC_RUN_COMMAND` — not needed; the runtime uses `npm start`

### Debugging

- `DISPLAY_STACK_TRACES` — set to `yes` to include stack traces in logs
- `DEBUG_SIMPLE_GITHUB` — set to `yes` to enable GitHub API debugging
- `DEBUG_WATTSI` — set to `yes` to log Wattsi client output

## Cutover

1. Create and configure the Clever Cloud app: env vars, `PORT=8080`, `CC_NODE_VERSION`, one instance, flavor `S`.
2. Add the domain and confirm TLS is live (`curl -I https://<host>/` — a 404 is the expected answer, since there is no `GET` route; what matters is that the TLS handshake succeeds and the response comes from the app).
3. Deploy and confirm the app boots (`clever logs`).
4. Smoke-test the webhook endpoint before pointing GitHub at it. With `NODE_ENV=production` the signature check is enforced, so an unsigned POST is rejected — that rejection is itself the signal that the app is up and verifying:
   ```
   curl -i -X POST https://<host>/github-hook -H 'Content-Type: application/json' -d '{}'
   ```
5. Point the GitHub App's webhook URL at `https://<host>/github-hook`.
6. Verify a delivery in the GitHub App's Advanced tab — it should return 200 with an ISO timestamp body.
7. Update the form action in [`docs/config.html`](docs/config.html) (line 61) from `https://pr-preview.herokuapp.com/config` to `https://<host>/config`, and deploy that change.
8. Trigger a real PR event on a repository that has a `.pr-preview.json` file and confirm the comment updates.
9. Replay anything missed during the switchover by setting `STARTUP_QUEUE` and restarting, or by pushing an empty commit to the affected PRs.
10. Leave the Heroku dyno up but idle for a grace period, then decommission it. Rotate any credentials that were only ever stored there.

**Rollback:** point the webhook URL back at the Heroku app. Nothing else is shared state — both hosts write to the same buckets under the same keys — so switching back is just the one setting, for as long as the Heroku app still exists.

## Local development

Set `NODE_ENV=dev` and create an `env.js` file at the repo root (gitignored) that sets `process.env.*` values before the app boots. `index.js` requires it automatically when `NODE_ENV=dev`:

```js
// env.js
process.env.GITHUB_SECRET = "…";
process.env.GITHUB_INTEGRATION_ID = "…";
process.env.GITHUB_INTEGRATION_KEY = "-----BEGIN RSA PRIVATE KEY-----\n…";
// …etc, per the Environment variables section above
```

Then `npm start`. The server listens on `PORT`, defaulting to `5000` locally. Webhook signature verification is skipped when `NODE_ENV` is not `production`, so you can POST synthetic payloads to `/github-hook` for testing.
