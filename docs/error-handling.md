# Error handling and logging

Every job that goes through the queue ends in exactly one of three outcomes,
and each outcome leaves a different trace:

| Outcome | Log | PR body | Requeued |
|---|---|---|---|
| **Success** | one line saying what happened | updated, or left alone | no |
| **Dismissal** | one line saying why the job was dropped | untouched | only for an aborted build |
| **Real error** | headline, detail, optional stack | error report posted, when appropriate | no |

The rule of thumb: a *dismissal* is an expected, non-actionable outcome
that nobody needs to be told about beyond the log. A *real error* is
something the PR author or a maintainer can act on, so it is reported on
the PR whenever that makes sense.

This document describes the mechanism, then walks through every case.

## The mechanism

### Every job produces a result

`Controller.handlePullRequest(job)` never rejects. Whatever happens while
building the PR ends up in the result it resolves to:

```js
{
    job,                     // { id: "owner/repo/number", url, installation_id, forcedUpdate }
    success,                 // true when the build ran to completion
    requeue,                 // true when the job should be run again
    config,                  // the parsed .pr-preview.json, once loaded
    error,                   // the Error, or null
    needsUpdate,             // the rendered body differed from the current one
    updated,                 // true, false, or "Not a live run!" outside production
    bodyChanged,             // the PR body was edited while the build ran
    content,                 // the rendered body
    skipReason,              // why no update was made, or null
    errorReported,           // on error: whether it was posted on the PR
    errorNotReportedReason,  // on error: why it wasn't
    errorReportingError      // on error: the failure that kept it from being posted
}
```

`Controller.processQueue(onResult)` hands each result to `onResult`, which
in production is the logger's `logResult()`. It then releases the job from
the running set and, if the result asked for it, puts the job back on the
queue. A throwing `onResult` is caught and logged so one bad result cannot
stall the queue.

### Dismissals are flagged errors

A dismissal is a regular `Error` carrying one of three flags, set with
`dismiss()` from `lib/utils/error-utils.js`:

```js
throw dismiss(new Error("PR is already merged."), "prMerged");
throw dismiss(err, "noConfig", "no .pr-preview.json, repo hasn't opted into previews");
```

| Flag | Fallback label | Meaning |
|---|---|---|
| `noConfig` | `no usable config` | The repo has no `.pr-preview.json` we can act on |
| `prMerged` | `PR is already merged` | Nothing left to preview |
| `aborted` | `build aborted` | The build was cut short on purpose |

`dismissalReason(error)` returns the error's `dismissalReason` when the
thrower set one, the flag's fallback label otherwise, and `null` for a real
error. That null-or-string return is what the controller and the logger
branch on, so there is no separate "is this internal" predicate to keep in
sync.

### What gets reported on the PR

`Controller.reportSkipReason(pr, job, error)` returns why an error is kept
off the PR, or `null` when it should be posted. `shouldReportError()` is
its negation. The checks run in this order:

1. **Not in production** → `not a live run`. Nothing is ever written to
   GitHub outside `NODE_ENV=production`.
2. **The error is a dismissal** → its dismissal reason.
3. **The PR never loaded** → `PR was never loaded`. There is no body to
   render the report into, so this applies even to forced jobs.
4. **The job was forced** → report.
5. **The PR didn't warrant an update anyway** → the same reason
   `updateSkipReason()` would have given: merged, no change to the source
   file or its includes, or an explicit `<!-- no preview -->` opt-out.
6. Otherwise → report.

When the error is reported, `reportError()` renders it with
`lib/views/error.js` and PATCHes the PR body. That call can itself fail
(GitHub down, token expired); the failure is recorded as
`errorReportingError` rather than thrown, so the log can mention both.

### What the PR sees

The error view renders a title with the error's name and message, a
"last tried" timestamp, and a collapsed **More** section built from
`error.data`, which throwers attach by convention:

| `error.data` key | Rendered as |
|---|---|
| `service` | Which external service is at fault, with a link to report the issue to its maintainers |
| `request_url` | A "Related URL" link |
| `error` | An "Error output" block, verbatim |
| anything else | An "Error output" block, as JSON |

`lib/fetch-url.js` attaches `request_url` and `service` to every failed
fetch, plus the response body (parsed as JSON when it is, as `error`
otherwise). The Wattsi client does the same for its own requests. GitHub
API validation failures arrive with an `errors` array, which the
controller copies into `error.data.errors` so it shows up too.

### What the log sees

The logger lives in `lib/logger.js` and is [pino](https://getpino.io).
Every record says what it is about in fields; the message is the
readable sentence. `index.js` hands the logger to the
controller and the Express app; modules that log on their own (the S3
cache, the fetch and file mixins, the spec-diff model, the include
scanner, the config model, the Wattsi client) use it directly, bound to a
`module`.

Job records come from a child logger (`jobLogger()`) bound to the job's
`pr` URL and `action`, so a line can be pasted straight into a browser;
`queueJob()` derives the URL from the `owner/repo/number` id when the job
didn't come with one. Each carries a `status` and, when there is one, a
`reason`. The status of a processed job (`logResult()`) is `updated`,
`no update`, `not a live run`, `dismissed` or `failed`; the queue and the
webhook add `starting`, `ignored` and `skipped` (`logStatus()`). A real
error is an `error` record carrying `err` (`type`, `message`, the
thrower's `data`, and the stack when `DISPLAY_STACK_TRACES=yes`), plus
`notReported` or `reportingError` when they apply.

Levels: `debug` is the build's chatter (fetches, cache hits, file reads,
the config as read), `info` is what happened to a job, `warn` is a job
dismissed or a request refused, `error` is a real failure. `LOG_LEVEL`
(default `info`) sets the threshold, so the chatter is off unless asked
for.

By default the log is pretty-printed: each record is the level, then
`<pr> (<action>): <message>` for a job, with error detail indented
beneath. Fields the line already conveys aren't repeated
under it, and there is no timestamp: the output is either watched live in
a terminal or read through a log stream that stamps each line itself, as
Clever Cloud's does. `LOG_FORMAT=json` writes newline-delimited JSON
instead, one record per line with every field (`time` included), for a
log collector. The examples below are the pretty-printed form with the
level left out.

## The cases

### Success

```
https://github.com/org/repo/pull/42 (synchronize): updated
https://github.com/org/repo/pull/42 (synchronize): updated (body edited during build)
https://github.com/org/repo/pull/42 (opened): not a live run (would have updated)
```

The status is `updated` in production, or `not a live run` otherwise. If the PR body was edited while the build ran, the build keeps
the edit (only the generated part below the marker comment is replaced)
and says so.

### Success with nothing to do

```
https://github.com/org/repo/pull/42 (edited): no update (rendered body is already up to date)
https://github.com/org/repo/pull/42 (synchronize): no update (no change to index.bs or the files it includes)
https://github.com/org/repo/pull/42 (opened): no update (PR body opts out with <!-- no preview -->)
https://github.com/org/repo/pull/42 (reopened): no update (PR is already merged)
```

`updateSkipReason()` names the condition. The first form means the build
ran and produced the same body; the others mean the build was never
attempted. A forced job (`forcedUpdate: true`, currently only reachable
from a startup queue entry) skips these checks.

### Dismissal: no usable config

```
https://github.com/org/repo/pull/42 (opened): dismissed (no .pr-preview.json, repo hasn't opted into previews)
https://github.com/org/repo/pull/42 (opened): dismissed (couldn't read .pr-preview.json from https://api.github.com/...: Bad credentials)
https://github.com/org/repo/pull/42 (opened): dismissed (.pr-preview.json is a dir, not a file)
https://github.com/org/repo/pull/42 (opened): dismissed (.pr-preview.json is invalid at /type: Data does not match any schemas from "oneOf")
```

All raised by `lib/models/config.js` with the `noConfig` flag, and logged
at `warn` with the reason as the `reason` field. The first is
the routine case with an org-wide install and reads as such. GitHub
answers 404 both for a missing file and for one the installation can't
see, and the HTTP client discards the status code, so those two are
indistinguishable and both land on the first line.

A config that *is* present but isn't valid JSON is deliberately **not** a
dismissal: the repo asked for previews and its config is broken, so that
is reported on the PR as a real error reading
`.pr-preview.json is not valid JSON: ...`.

### Dismissal: PR already merged

```
https://github.com/org/repo/pull/42 (synchronize): dismissed (PR is already merged)
```

Raised by `PR.requestPR()` with the `prMerged` flag, as soon as the PR
payload comes back. (A merged PR that somehow got past that point is still
caught by `updateSkipReason()` as a no-update case.)

### Dismissal: new commits during the build

```
https://github.com/org/repo/pull/42 (synchronize): dismissed (new commits pushed during build, requeued)
```

Builds take a while. Before writing anything, `updateBody()` re-fetches
the PR and compares the head SHA it started with. If it moved, the result
of this build is stale: the job is dismissed with the `aborted` flag and
`requeue: true`, and `processQueue()` puts it back on the queue once the
first run has released it. The next run starts from the new head. If only
the PR body changed in the meantime, the build continues with the new
body instead (see "body edited during build" above).

### Real error, reported on the PR

```
https://github.com/org/repo/pull/42 (synchronize): failed
    err: Error: 500 Internal Server Error
        data: {
          "request_url": "https://www.w3.org/publications/spec-generator/?...",
          "service": { "name": "Spec Generator", ... }
        }
```

When `DISPLAY_STACK_TRACES=yes`, the stack takes the place of the first
`err` line. The PR body is replaced with the error report described
above, so the author sees what failed and where to take it.

### Real error, kept off the PR

```
https://github.com/org/repo/pull/42 (synchronize): failed
    err: TypeError: Cannot read properties of undefined (reading 'sha')
    notReported: "not a live run"
```

`notReported` is `reportSkipReason()`'s answer: not in production, PR
never loaded, or the PR didn't warrant an update in the first place.

### Real error whose report could not be posted

```
https://github.com/org/repo/pull/42 (synchronize): failed
    err: Error: 502 Bad Gateway
        data: {
          "request_url": "https://services.w3.org/htmldiff?...",
          "service": { "name": "HTML Diff Service", ... }
        }
    reportingError: Error: Bad credentials
```

The original error is the headline; the failure to post it is the
`reportingError`, serialized the same way, so it gets its own data and
stack too.

## Errors outside the job path

**Webhook handler** (`POST /github-hook`). Nothing here throws by design,
and every delivery is acknowledged with a 200 and then logged with the
same `status` and `reason` fields as a processed job:

```
https://github.com/org/repo/pull/42 (closed): ignored (not an action we build on)
https://github.com/org/repo/pull/42 (edited): ignored (triggered by our own update)
https://github.com/org/repo/pull/42 (synchronize): skipped (already processing)
https://github.com/org/repo/issues/7 (issue_comment created): ignored (only pull_request events are handled)
ping event: ignored (only pull_request events are handled; payload keys: zen, hook)
```

A queued job also logs `<url> (<action>): starting (currently running:
...)` when it is picked up, before its result line.

Only `opened`, `edited`, `reopened` and `synchronize` pull_request events
are queued. The bot's own body update comes back as an `edited` event and
is recognised by its sender. A PR already queued or running is not queued
twice. Unverified requests in production are logged at `warn` as
`Unverified request: <method> <url> from <address>` and fall through to
Express's 404.

**Config tester** (`POST /config`). Validation errors (bad repo name,
invalid JSON, schema violations, a repo with no PRs) are answered with a
400 and the error message, and logged as an `error` record reading
`/config: request failed` with the error as `err`. Schema violations here carry the `noConfig`
flag because they come from the same `Config.validate()`, but nothing
branches on it in this path.

**Startup queue** (`STARTUP_QUEUE`). `parseStartupQueue()` returns `null`
and logs exactly one reason (at `warn`, except for the routine absence of
the variable) when the variable is missing, isn't JSON,
isn't an array, is empty, or contains an item without a string `id`.
`processStartupQueue()` logs the URLs it queues on one line, logs any it
skipped as duplicates as `<url> (startup-queue): skipped (already queued)`,
and awaits the drain, so the catch in `index.js`
covers anything unexpected during processing. Results are logged with
`startup-queue` as the action.

**The queue loop itself**. Because `handlePullRequest()` is total, the
only thing that can throw inside `processQueue()` is the result handler.
That is logged against the job as `result handler failed`, with the
error, and the loop moves on.

## Adding a case

- **A new way for a job to be non-actionable**: throw a `dismiss()`ed
  error with an existing flag and a specific `dismissalReason`. Add a
  flag to `DISMISSAL_LABELS` only if it is a genuinely new category, since
  `dismiss()` rejects unknown flags.
- **A new reason not to update**: add a branch to `updateSkipReason()`.
  `needsUpdate()`, `updateBody()`'s skip reason and `reportSkipReason()`
  all follow from it.
- **A new reason not to report**: add a branch to `reportSkipReason()`.
  `shouldReportError()` follows from it.
- **A new external failure**: attach `request_url` and `service` (from
  `lib/services.js`) to `error.data` so the PR report can point the author
  at the right place.

Tests for all of this live in `test/error-utils.js`,
`test/controller-skip-reasons.js`, `test/controller-error-handling.js`,
`test/logger.js` and `test/startup-queue.js`.
