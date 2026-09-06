# PR Preview

Increasingly, GitHub is being used to collaborate on documents that aren't just code.

When such documents include a build step,
it is often difficult to assess the impact of a pull request by just looking at the source changes.

This is where PR Preview steps in.

PR Preview uses [spec-generator](https://www.w3.org/publications/spec-generator/)
to build a ReSpec or Bikeshed versions of the spec in the pull request,
which it stores on AWS.

It then uses this spec preview to create an HTML diff of the spec
(using [yet another web service](https://services.w3.org/htmldiff))
which also gets stored on AWS.

Finally, PR Preview conveniently links both preview and HTML diff from within the pull request itself:

![screenshot](/images/screenshot-1.jpg)

This makes it a lot easier to understnad the actual impact of pull requests on the end document,
considerably speeds-up pull request reviews,
and makes the whole collaboration process more accessible and inclusive.

## Assumptions

The only assumption made by PR Preview is that you're using
the latest version of either Bikeshed or ReSpec, or vanilla HTML to edit your spec.

## Known issues

ReSpec is known to have race condition issues when it's included using the async attribute.
Instead, use the defer attribute like so:

```html
<script src="https://www.w3.org/Tools/respec/respec-w3c-common" class="remove" defer></script>
```

## Install

This is [available as a GitHub App](https://github.com/apps/pr-preview).

Once the integration is installed,
you **must** add a configuration file to the root of your repository.
Nothing will happen until you do.

Note that the following orgs have blanket install of pr-preview,
which means that [adding a config file](https://specinfra.github.io/pr-preview/config.html)
is all you need to be setup if your repository is hosted in one of them:

* [github.com/w3c](https://github.com/w3c/)
* [github.com/whatwg](https://github.com/whatwg/)
* [github.com/wicg](https://github.com/wicg/)
* [github.com/w3ctag](https://github.com/w3ctag/)

## Configuration file

_To test your own config file and turn it into a pull request,
go to the [config page](https://specinfra.github.io/pr-preview/config.html)._

You must configure PR Preview by adding a
`.pr-preview.json` json file at the root of your repository
with the following fields:

```json
{
    "src_file": "index.bs",
    "type": "bikeshed",
    "params": {
        "md-foo": "bar"
    }
}
```

### `src_file` (required)

This should point to the relative path to the source file from the root of the repository.

### `type` (required)

One of "bikeshed", "respec", or "html".

### `params` (optional)

`params` are used to construct the URL that transform the source file into an html document
using [W3C's spec-generator](https://github.com/w3c/spec-generator).

When constructing the URL, `params` are rendered as if they were [mustache template strings](https://github.com/janl/mustache.js#mustachejs---logic-less-mustache-templates-with-javascript).
You can also use an array of strings, instead of a string, to pass multiple values for the same query parameter.

They're passed an object containing the `config` object itself,
the [`pull_request` payload](https://developer.github.com/v3/pulls/#get-a-single-pull-request)
and the `owner`, `repo`, `branch`, `sha`, `short_sha` and `url` of the branch being rendered:

```js
{
    config: { /* ... */ },       // The config object defined above.
    pull_request: { /* ... */ }, // The pull request payload.
    owner: "heycam",             // owner's login
    repo: "webidl",              // repo's name
    branch: "gh-pages",          // branch name
    sha: "7dfd134ee2e6df7fe...", // duh
    short_sha: "7dfd134",        // sha truncated to 7 characters
    url: "https://s3.amazon..."  // URL where the spec will be hosted
}
```

Here's a fairly involved config file example the URL standard could use
to produce [this snapshot](https://www.w3.org/publications/spec-generator/?type=bikeshed-spec&output=html&url=https%3A%2F%2Fraw.githubusercontent.com%2Fw3c%2Fcsswg-drafts%2Fb636446f7636646695b7b3b799f2a0f14a18701d%2Fcompositing-1%2FOverview.bs&die-on=nothing&md-status=LS-COMMIT&md-h1=URL%20%3Csmall%3E(%3Ca%20href%3D%22https%3A%2F%2Fgithub.com%2Fwhatwg%2Furl%2Fpull%2F234%22%3EPR%20%23234%3C%2Fa%3E)%3C%2Fsmall%3E&md-warning=Commit%20b46bf40%20https%3A%2F%2Fgithub.com%2Fwatilde%2Furl%2Fcommit%2Fb46bf404569eece5597067e89749620faf0ea320%20replaced%20by%20https%3A%2F%2Furl.spec.whatwg.org%2F&md-title=URL%20Standard%20(Pull%20Request%20Snapshot%20%23234)&md-Text-Macro=SNAPSHOT-LINK%20%3Ca%20href%3D%22https%3A%2F%2Furl.spec.whatwg.org%2F%22%20id%3D%22commit-snapshot-link%22%3EGo%20to%20the%20living%20standard%3C%2Fa%3E).

```json
{
    "src_file": "url.bs",
    "type": "bikeshed",
    "params": {
        "die-on": "nothing",
        "md-status": "LS-COMMIT",
        "md-h1": "URL <small>(<a href=\"{{ pull_request.html_url }}\">PR #{{ pull_request.number }}</a>)</small>",
        "md-warning": "Commit {{ short_sha }} {{ pull_request.head.repo.html_url }}/commit/{{ sha }} replaced by {{ config.ls_url }}",
        "md-title": "{{ config.title }} (Pull Request Snapshot #{{ pull_request.number }})",
        "md-Text-Macro": ["SNAPSHOT-LINK {{ config.back_to_ls_link }}", "COMMIT-SHA {{ sha }}"]
    },
    "ls_url": "https://url.spec.whatwg.org/",
    "title": "URL Standard",
    "back_to_ls_link": "<a href=\"https://url.spec.whatwg.org/\" id=\"commit-snapshot-link\">Go to the living standard</a>"
}
```

### `post_processing` (optional)

This let's you opt into post-processing. For example, to use the emu-algify post-processor:

```json
{
    "src_file": "index.bs",
    "type": "bikeshed",
    "params": {
        "md-foo": "bar"
    },
    "post_processing": {
        "name": "emu-algify",
        "options": {
            "throwingIndicators": true
        }
    }
}
```

#### `post_processing.name`

Lets you choose the post-processor.
Currently, the only supported ones are "emu-algify" and "webidl-grammar".

#### `post_processing.options` (optional)

Used to pass an options object to the post-processor.

***

Hosting generously provided by <a href="https://www.unlockopen.com/home">UnlockOpen</a>.
