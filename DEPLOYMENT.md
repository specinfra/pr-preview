# Deployment

PR Preview is a small Node.js Express server that receives GitHub webhooks, builds spec previews, and uploads results to S3. It has no database and no persistent local state.

It is deployed on [Clever Cloud](https://www.clever-cloud.com/), on the Node.js runtime. This document describes what that deployment needs and how it is configured. The one-time move from the previous Heroku deployment is tracked in [#194](https://github.com/specinfra/pr-preview/issues/194).

## Requirements

- Node.js 20 or 22 — **not 24 or newer** (see `engines` in `package.json`). `jsonwebtoken@8` pulls in `buffer-equal-constant-time`, which reads `SlowBuffer.prototype` at module load; `SlowBuffer` was removed in Node 24, so the process throws while requiring `jsonwebtoken` at [`lib/auth.js:3`](lib/auth.js) and dies before Express binds — no "listening" line, just a `TypeError` stack. Upgrading `jsonwebtoken` does not lift the bound: 9.x resolves to the same `jwa@1.4.1` → `buffer-equal-constant-time@1.0.1`, which has no released fix.
- A public HTTPS endpoint for GitHub to POST webhooks to (Clever Cloud provides one)
- The existing AWS S3 buckets and their credentials
- The existing GitHub App credentials
- Outbound HTTPS access to `api.github.com`, S3, and the spec-generator services listed in `lib/services.js`
- `unzip` and `diff` on the host image — the WHATWG/HTML path shells out to them (`lib/wattsi-client.js:138-171`). `diff` is on essentially any Linux image; `unzip` is a separate package on minimal images and is the one to verify.

## GitHub App

PR Preview is delivered as a [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps): repository owners install it once, GitHub then POSTs pull-request webhook events to a URL the app owns, and the app authenticates back to the GitHub API using a private key (as a JWT-signed App identity) plus per-installation access tokens. See [`lib/auth.js`](lib/auth.js) for the token exchange.

The public listing is at https://github.com/apps/pr-preview and the owner-only settings page is at https://github.com/settings/apps/pr-preview. See the [README](README.md) for the user-facing view (what it does for a PR author/reviewer).

The App's **Webhook URL** (at https://github.com/settings/apps/pr-preview) must point at the running deployment: `https://<clever-cloud-host>/github-hook`. Everything else about the App — permissions, event subscriptions, installations, slug, icon, homepage — is independent of where the app is hosted.

**Credentials the deployment needs:**

- `GITHUB_INTEGRATION_ID` — the numeric App ID at the top of the App settings page.
- `GITHUB_INTEGRATION_KEY` — PEM contents of a private key. Existing keys stay valid; re-use the current one or generate a fresh one under "Private keys" and delete the old.
- `GITHUB_SECRET` — the webhook signing secret. Must match whatever is set on the App settings page.
- `GITHUB_TOKEN` — personal access token used as a fallback for unauthenticated calls.

Of these, only `GITHUB_INTEGRATION_ID` is fixed; it is displayed on the App settings page and never changes. The other three can be regenerated at any time if they are lost or need rotating.

### Rotating the secrets

Any of the three can be replaced without touching installations or permissions, so no repository owner is affected. This is both the recovery path when a value has been lost and the procedure for routine rotation.

- `GITHUB_INTEGRATION_KEY` — generate a fresh private key under **Private keys** on the App settings page. Existing keys stay valid, so delete the old entry only once the deployment is serving with the new one.
- `GITHUB_SECRET` — set a new webhook secret on the same page and put the identical value in the app's environment. These two must match or every delivery is rejected, so change them close together.
- `GITHUB_TOKEN` — issue a new personal access token from the operator's account and revoke the old one.

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

Registering a *new* App would be a breaking change: every org and repo currently using PR Preview would have to install the replacement, so it needs coordinating with w3c, whatwg, wicg, and w3ctag before it is considered.

If the App should also change hands (e.g. to a new maintainer or an org account), that is done at **Settings → Developer settings → GitHub Apps → pr-preview → Advanced → Transfer ownership** and is [independent of where the app is hosted](https://docs.github.com/en/apps/maintaining-github-apps/transferring-ownership-of-a-github-app) — before, after, or not at all. App ID, private keys, webhook config, permissions and installations all carry over; watch that the `pr-preview` slug doesn't collide on the new owner (a collision renames the app and changes its public URL), and note that `GITHUB_TOKEN` belongs to a user account rather than the App, so a new operator needs to issue a fresh one.

## AWS S3

PR Preview writes preview and diff HTML to S3 and serves the resulting URLs from the PR comment. It uses **two** buckets, dispatched at runtime by the PR owner (see `lib/models/pr.js:200` and `lib/cache.js`):

1. **Default bucket** — used for every repo *except* those owned by `whatwg`. Credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; bucket name comes from `AWS_BUCKET_NAME`. Preview URLs are direct S3 URLs: `https://<bucket>.s3.amazonaws.com/<key>`.
2. **WHATWG bucket** — used only when the PR owner is `whatwg`. Credentials come from `WHATWG_AWS_ACCESS_KEY_ID` / `WHATWG_AWS_SECRET_ACCESS_KEY`; bucket "name" comes from `WHATWG_AWS_BUCKET_NAME`. **This env var holds a hostname, not a plain S3 bucket name** — the URL is built as `https://<WHATWG_AWS_BUCKET_NAME>/<key>` (see `lib/cache.js:17-20`). In production this hostname points at the bucket through a fronting layer (CloudFront distribution and/or a Route 53 alias) so that WHATWG-hosted previews live under a WHATWG-owned domain.

Required S3 permissions on each bucket for the credentials in use:

- `s3:PutObject`
- `s3:GetObject`
- `s3:HeadObject`

Objects should be publicly readable (previews are served directly to browsers from the URLs above), typically via a bucket policy that grants `s3:GetObject` to `*`.

The buckets are independent of where the app runs: moving hosts needs no object copy, no DNS change and no fronting-layer change, only the six `AWS_*` / `WHATWG_AWS_*` variables in the new environment.

Two knobs worth knowing about, neither used by the current deployment:

- Set `ALLOW_MULTIPLE_AWS_BUCKETS=no` to disable the WHATWG bucket path entirely and route every PR through the default bucket — useful if you don't have WHATWG credentials.
- Moving a bucket to a different AWS account is a copy + cutover, not a transfer (S3 bucket ownership cannot be reassigned): create a bucket in the destination account, `aws s3 sync` the objects over, reapply the public-read policy and CORS, repoint any fronting layer, update the env vars, and leave the old bucket up read-only so previously-posted URLs keep resolving.

**Recovering and rotating the credentials.** IAM secret access keys cannot be read back out of AWS. If `AWS_SECRET_ACCESS_KEY` or `WHATWG_AWS_SECRET_ACCESS_KEY` is lost, or needs rotating, issue new access keys for the same IAM users and deactivate the old pairs. That changes nothing about the buckets, their contents, or their policies.

The two bucket variables are not secrets and can be read off existing infrastructure if they are lost: `AWS_BUCKET_NAME` is the bucket in the S3 console, and `WHATWG_AWS_BUCKET_NAME` is the hostname serving WHATWG previews — visible in the preview URL of any recent `whatwg` PR comment.

## Clever Cloud

The app is set up and operated from the [Console](https://console.clever-cloud.com/). Everything below is done there; no CLI or local tooling is required.

Panel names are as they appear in the left-hand navigation once you open the application.

### Create the application

**Create → an application**, then choose how the code gets there:

- **From a GitHub repository** — link the GitHub account or organisation that owns `specinfra/pr-preview` and pick the repository. Clever Cloud installs a webhook, and **every push to the selected branch redeploys the app**. Convenient, but note what it implies: merging a PR to that branch ships to production immediately, with no separate deploy step.
- **From a local repository** — Clever Cloud gives you a git remote to push to, and nothing deploys until someone pushes to it deliberately.

Pick **GitHub** if you want merges to ship themselves, **local** if you want the merge and the deploy to be separate decisions. Either can be changed later.

Then select **Node.js** as the runtime, and size the instance on the next screen (see [Instance sizing and scaling](#instance-sizing-and-scaling) — the defaults are not what this app wants). The creation flow offers to set environment variables before the first build; you can do that now or leave it and use the panel afterwards, but the app will fail to boot usefully until they are set.

**Set the deployment branch to `main`** in the **Information** panel after creation. Clever Cloud tracks a branch named `master` by default, and this repository does not have one — its default branch is `main` — so leaving the default configured means pushes trigger nothing at all.

### Build and start

The Node.js runtime needs almost nothing from us:

- **Start command** — the runtime runs `scripts.start` from `package.json`, which is `node index.js`. No `CC_RUN_COMMAND` needed.
- **Dependencies** — installed at build time from `package.json`. Dev dependencies (`mocha`, `supertest`) are *not* installed by default, which is what we want; leave `CC_NODE_DEV_DEPENDENCIES` unset.
- **Build step** — there is none (no `build` script), so nothing runs between install and start.
- **Node version** — set `CC_NODE_VERSION` to `22` alongside the other environment variables. The `engines` range in `package.json` carries the upper bound (see [Requirements](#requirements)), but pin this too rather than relying on the platform to honour it: with an open-ended range the platform resolves to the newest Node available, which is how a deployment ends up on a version the app cannot run on.

  **Changing it takes a rebuild, not a plain restart.** The Node version is baked in at build time, so a restart re-injects the variable into an image still carrying the old Node — the logs report the old version and the change looks like it did not apply. Use *rebuild and restart* from the application header, and confirm the expected `Node.js v22.x` in the Logs panel.

### Port

**Clever Cloud only routes traffic to port 8080.** `index.js` reads `process.env.PORT` and falls back to `5000`, so `PORT` must be set to `8080` in the environment variables — this is not optional and there is no platform default that rescues it.

Express binds all interfaces by default, which satisfies the platform's requirement that the app listen on `0.0.0.0:8080`.

### Environment variables

The **Environment variables** panel has two editors, and the toggle between them matters here:

- The **simple editor** takes one name/value pair per row. Multi-line values work — paste the value into the field and the newlines are kept.
- **Expert mode** is a single text area in `NAME="value"` format, which lets you paste the whole set at once. **Multi-line values must be quoted** in this mode.

See the [full list](#environment-variables-reference) below for what to set.

`GITHUB_INTEGRATION_KEY` is the awkward one: it is a multi-line PEM, including the `-----BEGIN`/`-----END` lines. Paste it complete, with its line breaks intact — either into the simple editor's value field, or quoted in expert mode:

```
GITHUB_INTEGRATION_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIE...
-----END RSA PRIVATE KEY-----"
```

A PEM whose newlines were flattened produces JWT signing failures at the first webhook, not at boot, so this fails late and looks like a GitHub API problem rather than a config one. After saving, reopen the panel and check the value still spans multiple lines.

Changes take effect on restart, not on save — the panel will offer to restart the app.

### Instance sizing and scaling

Set this in the **Scalability** panel. Two things need changing from the defaults:

- **Exactly one instance.** Set minimum and maximum instances both to 1 and leave horizontal auto-scaling off. The controller keeps its job queue, its `currently_running` de-duplication set, and its previewer cache in process memory (`lib/controller.js:11-16`). A second instance would not see the first one's in-flight jobs, so the same PR could be built twice concurrently and the two runs would race to update the PR body.
- **Flavor: `pico` to start.** The app is not CPU-bound. Every spec build happens on a remote service — Spec Generator, the HTML Diff service, Wattsi Server (`lib/services.js`) — so the process spends most of its life waiting on HTTP, and `pico`'s reduced CPU priority matters less than it would for a compute-heavy service. 256 MiB is the bet being made; memory, not CPU, is what will decide whether it holds.

  Two things consume it, both scaling with spec size rather than PR count. Post-processors (`emu-algify`, `webidl-grammar`) parse a whole rendered spec in-process. And the wattsi path — gated on `processor == "wattsi"` in a repo's `.pr-preview.json`, which in practice means `whatwg/html` — downloads two complete spec builds, unzips both into `os.tmpdir()` and runs `diff -qr` across them (`lib/wattsi-client.js:138-171`); that one is mostly scratch disk, since it uploads file by file rather than holding the build in memory.

  **If 256 MiB is too tight, the failure is an OOM kill, and the blast radius is larger than one preview.** The job queue lives in process memory (`lib/controller.js:11-16`), so a kill mid-build drops every queued PR, not just the one that overran. Watch for unexplained restarts under load rather than reading a single missing preview as a one-off. Changing flavor later is a restart, so this is cheap to revisit.

The filesystem is ephemeral — each deploy or restart gets a fresh VM. That is fine here: the only local writes are that scratch space, and nothing is expected to survive. No FS Bucket add-on is needed.

The corollary is that **a restart drops in-flight and queued jobs**. Deploy during quiet periods, and use `STARTUP_QUEUE` (see below) to replay any PRs that were dropped.

### Domain and TLS

The app gets a `*.cleverapps.io` subdomain with working TLS out of the box, which is enough to test the webhook before any DNS change. For a stable public name, add a custom domain in the **Domain names** panel and point a DNS record at the app.

Clever Cloud requests and renews a Let's Encrypt certificate automatically. **It only attempts issuance during the first 3 days after the domain is added** — so point DNS at the app first, or at least within that window. If the certificate never appears, remove the domain and re-add it to restart the window.

Whichever hostname you settle on is the one that goes in the GitHub App's webhook URL, so decide before cutting over: moving the webhook URL twice means two windows where deliveries fail.

### Deploy and operate

How a deploy is triggered depends on the choice made at creation: a push to the tracked branch for a GitHub-linked app, or a push to the Clever Cloud git remote for a local-repository one. Either way the Console drives the rest.

- **Deployments** shows build and deploy history, including failures.
- **Logs** streams build and application output. A successful boot logs `Express server listening on port 8080 in production mode`.
- The application header carries **restart** controls — a plain restart, and a rebuild-and-restart that redoes the build from the current commit. Use the plain restart after an environment-variable change.

If a deploy is marked unhealthy even though the app logged that it is listening, check the health-check configuration: this app exposes no `GET` route at all — only `POST /github-hook` and `POST /config` — so an HTTP health check against `/` will not get a 2xx.

The [`clever-tools` CLI](https://github.com/CleverCloud/clever-tools) offers the same operations from a terminal (`clever logs`, `clever restart`, `clever env`) if that is ever preferable for day-to-day work. It is not needed for any step in this document.

## Environment variables reference

Set these in the Console, under the application's **Environment variables** panel.

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
- `LOG_FORMAT` — `pretty` (the default) for readable output, one line per event with error detail indented beneath it; `json` for newline-delimited JSON, one record per line, when a log collector is reading the output
- `LOG_LEVEL` — the least severe [pino level](https://getpino.io/#/docs/api?id=level-string) to log; defaults to `info`

### Clever Cloud platform variables

- `CC_NODE_VERSION` — Node.js version to run (pin to `22`; must be below 24 — see [Requirements](#requirements))
- `CC_NODE_DEV_DEPENDENCIES` — leave unset; dev dependencies are not installed by default
- `CC_RUN_COMMAND` — not needed; the runtime uses `npm start`

### Debugging

- `DISPLAY_STACK_TRACES` — set to `yes` to include stack traces in logged errors
- `DEBUG_SIMPLE_GITHUB` — set to `yes` to enable GitHub API debugging
- `DEBUG_WATTSI` — set to `yes` to log Wattsi client output

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
