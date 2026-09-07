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

The logger lives in `lib/logger.js` and is created once, in `index.js`,
then handed to both the controller and the Express app. It has three
functions:

- `log(...args)` is `console.log`.
- `logError(err, indent)` prints `Name: message`, then `err.data` if any,
  then the stack when `DISPLAY_STACK_TRACES=yes`. Every error the app
  prints goes through it.
- `logResult(result, action)` prints one job's outcome, in the shapes
  shown below. Jobs are named by their GitHub URL so a line can be pasted
  straight into a browser; `queueJob()` derives it from the
  `owner/repo/number` id when the job didn't come with one.

## The cases

### Success

```
https://github.com/org/repo/pull/42: synchronize (updated)
https://github.com/org/repo/pull/42: synchronize (updated, body edited during build)
https://github.com/org/repo/pull/42: opened (not a live run, would have updated)
```

The parenthetical is `updated` in production, or a note that this wasn't a
live run. If the PR body was edited while the build ran, the build keeps
the edit (only the generated part below the marker comment is replaced)
and says so.

### Success with nothing to do

```
https://github.com/org/repo/pull/42: edited (no update: rendered body is already up to date)
https://github.com/org/repo/pull/42: synchronize (no update: no change to index.bs or the files it includes)
https://github.com/org/repo/pull/42: opened (no update: PR body opts out with <!-- no preview -->)
https://github.com/org/repo/pull/42: reopened (no update: PR is already merged)
```

`updateSkipReason()` names the condition. The first form means the build
ran and produced the same body; the others mean the build was never
attempted. A forced job (`forcedUpdate: true`, currently only reachable
from a startup queue entry) skips these checks.

### Dismissal: no usable config

```
https://github.com/org/repo/pull/42: opened (dismissed: no .pr-preview.json, repo hasn't opted into previews)
https://github.com/org/repo/pull/42: opened (dismissed: couldn't read .pr-preview.json from https://api.github.com/...: Bad credentials)
https://github.com/org/repo/pull/42: opened (dismissed: .pr-preview.json is a dir, not a file)
https://github.com/org/repo/pull/42: opened (dismissed: .pr-preview.json is invalid at /type: Data does not match any schemas from "oneOf")
```

All raised by `lib/models/config.js` with the `noConfig` flag. The first is
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
https://github.com/org/repo/pull/42: synchronize (dismissed: PR is already merged)
```

Raised by `PR.requestPR()` with the `prMerged` flag, as soon as the PR
payload comes back. (A merged PR that somehow got past that point is still
caught by `updateSkipReason()` as a no-update case.)

### Dismissal: new commits during the build

```
https://github.com/org/repo/pull/42: synchronize (dismissed: new commits pushed during build, requeued)
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
https://github.com/org/repo/pull/42: synchronize (Error: 500 Internal Server Error)
{ request_url: 'https://www.w3.org/publications/spec-generator/?...', service: { name: 'Spec Generator', ... } }
```

Followed by the stack when `DISPLAY_STACK_TRACES=yes`. The PR body is
replaced with the error report described above, so the author sees what
failed and where to take it.

### Real error, kept off the PR

```
https://github.com/org/repo/pull/42: synchronize (TypeError: Cannot read properties of undefined (reading 'sha'))
    Not reported on the PR: not a live run.
```

The second line is `reportSkipReason()`'s answer: not in production, PR
never loaded, or the PR didn't warrant an update in the first place. The
detail lines that follow are the same as for a reported error.

### Real error whose report could not be posted

```
https://github.com/org/repo/pull/42: synchronize (Error: 502 Bad Gateway)
    Additionally, reporting it on the PR failed:
        Error: Bad credentials
{ request_url: 'https://services.w3.org/htmldiff?...', service: { name: 'HTML Diff Service', ... } }
```

The original error is the headline; the failure to post it is indented
under it and printed through `logError()`, so it gets its own data and
stack too.

## Errors outside the job path

**Webhook handler** (`POST /github-hook`). Nothing here throws by design,
and every delivery is acknowledged with a 200 and then logged with what it
was and what was done with it:

```
Ignoring pull_request "closed" event on https://github.com/org/repo/pull/42: not an action we build on
Ignoring pull_request "edited" event on https://github.com/org/repo/pull/42: triggered by our own update
Ignoring issue_comment "created" event on https://github.com/org/repo/issues/7: only pull_request events are handled
Ignoring "ping" event: only pull_request events are handled (payload keys: zen, hook, ...)
Skipping pull_request "synchronize" event on https://github.com/org/repo/pull/42: already processing
```

Only `opened`, `edited`, `reopened` and `synchronize` pull_request events
are queued. The bot's own body update comes back as an `edited` event and
is recognised by its sender. A PR already queued or running is not queued
twice. Unverified requests in production are logged as `Unverified
request` with the reported client address and fall through to Express's
404.

**Config tester** (`POST /config`). Validation errors (bad repo name,
invalid JSON, schema violations, a repo with no PRs) are answered with a
400 and the error message, and logged as `/config: request failed`
followed by `logError()`. Schema violations here carry the `noConfig`
flag because they come from the same `Config.validate()`, but nothing
branches on it in this path.

**Startup queue** (`STARTUP_QUEUE`). `parseStartupQueue()` returns `null`
and logs exactly one reason when the variable is missing, isn't JSON,
isn't an array, is empty, or contains an item without a string `id`.
`processStartupQueue()` logs the ids it queues on one line, notes any it
skipped as duplicates, and awaits the drain, so the catch in `index.js`
covers anything unexpected during processing. Results are logged with
`startup-queue` as the action.

**The queue loop itself**. Because `handlePullRequest()` is total, the
only thing that can throw inside `processQueue()` is the result handler.
That is logged as `<id>: unexpected error while handling the result` and
the loop moves on.

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
