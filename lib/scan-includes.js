const realFetchUrl = require("./fetch-url");
const GITHUB_SERVICE = require("./services").GITHUB;
const { log } = require("./logger").shared;

/** Resolves path relative to scopeUrl, with the restriction that path can't use
 * any components that might go "above" the base URL.
 *
 * @param {string} scopeUrl
 * @param {string} path
 *
 * @returns {string|undefined} `undefined` if either URL can't be parsed, or if
 * the path navigated "up" in any way.
 */
function resolveSubUrl(scopeUrl, path) {
    if (!scopeUrl.endsWith('/')) {
        throw new Error(`${JSON.stringify(scopeUrl)} isn't a good scope URL.`)
    }
    if (path.startsWith('/') ||
        path.includes('../') ||
        // Block schemes, a bit more aggressively than necessary.
        path.includes(':')) {
        return undefined;
    }

    let resolvedUrl;
    try {
        resolvedUrl = new URL(path, scopeUrl).href;
    } catch {
        return undefined;
    }
    if (!resolvedUrl.startsWith(scopeUrl)) {
        throw new Error(`Path restrictions in resolveSubUrl(${JSON.stringify(scopeUrl)}, ${JSON.stringify(path)}) failed to catch an upward navigation.`);
    }
    return resolvedUrl;

}

/** Scans for recursively included paths from a root specification.
 *
 * @param {string} repositoryUrl The base URL of the repository. The function
 * won't fetch anything outside of this scope. This must end with a `/`.
 * @param {string} rootSpec A path relative to the `repositoryUrl` pointing to
 * the root specification in the `specType` format.
 * @param {"bikeshed"|"respec"|"html"|"wattsi"} specType
 *
 * @returns {Promise<Set<string>>} Paths relative to `repositoryUrl` that are
 * recursively included by the specification, not including the specification itself.
 */
module.exports = async function scanIncludes(repositoryUrl, rootSpec, specType, fetchUrl = realFetchUrl) {
    if (!repositoryUrl.endsWith('/')) {
        throw new Error(`${repositoryUrl} must end with a '/'.`);
    }
    let includeRE;
    switch (specType) {
        case "bikeshed":
            // https://speced.github.io/bikeshed/#including
            includeRE = /^path:([^\n]+)$/gm;
            break;
        case "respec":
            // https://github.com/w3c/respec/wiki/data--include
            includeRE = /data-include=["']?([^"'>]+)["']?/g;
            break;
        case "html":
        case "wattsi":
            // We don't support include scanning in pure HTML or Wattsi specs.
            return new Set();
        default:
            throw new Error(`Unexpected specification type: ${JSON.stringify(specType)}`);
    }

    /** All the paths that successfully fetched go here. This is the result of
     * the overall scan. */
    const recursiveIncludes = new Set();
    /** All the files we ever fetched, for the purpose of short-circuiting. */
    const everFetched = new Set();

    /** Fetches path relative to repositoryUrl, adds it to recursiveIncludes if
     * the fetch worked, and then recursively scans any includes found in the
     * response.
     */
    async function scanOneFile(path, specDir) {
        if (everFetched.has(path)) return;
        everFetched.add(path);

        const resolvedUrl = resolveSubUrl(repositoryUrl, path);
        if (resolvedUrl === undefined) return;

        let body;
        try {
            body = await fetchUrl(resolvedUrl, GITHUB_SERVICE);
        } catch (err) {
            // This include scan can have false positives, so if one
            // fails to fetch, we assume it's not a real include and
            // just ignore the fetch failure.
            log(`scanIncludes: Failed to fetch ${resolvedUrl}, assuming false positive.`);
            return;
        }
        recursiveIncludes.add(path);
        // Intentionally serial since Node's treatment of connection pooling is
        // hard to figure out from the documentation:
        for (const match of body.matchAll(includeRE)) {
            await scanOneFile(specDir + match[1].trim(), specDir);
        }
    }
    // Includes are relative to the root spec file.
    const specDir = rootSpec.substring(0, rootSpec.lastIndexOf('/') + 1);
    await scanOneFile(rootSpec, specDir);

    recursiveIncludes.delete(rootSpec);
    const includes = [...recursiveIncludes].sort();
    log(`scanIncludes: ${rootSpec} includes ${includes.length ? includes.join(", ") : "no other files"}.`);
    return includes;
}
