"use strict";

// Jobs are identified by "owner/repo/number". This is the matching GitHub
// URL, which is what the log prints so a line can be pasted into a browser.
module.exports = function prUrl(id) {
    const [owner, repo, number] = String(id).split("/");
    return `https://github.com/${owner}/${repo}/pull/${number}`;
};
