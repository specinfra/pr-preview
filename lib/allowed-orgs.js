"use strict";

// The app can be restricted to a set of GitHub organizations (or user
// accounts) through the ALLOWED_ORGS env variable, which holds a comma or
// whitespace separated list of logins. When the list is empty or missing,
// the app runs for every installation, as it always has.
function parseAllowedOrgs(value) {
    if (!value) return null;
    // GitHub logins are case-insensitive, so normalize once, here.
    let orgs = String(value).split(/[\s,]+/)
        .filter(org => org.length > 0)
        .map(org => org.toLowerCase());
    return orgs.length > 0 ? orgs : null;
}

function isOrgAllowed(owner, allowedOrgs) {
    if (!allowedOrgs) return true;
    if (!owner) return false;
    return allowedOrgs.includes(String(owner).toLowerCase());
}

// Pull request and job ids are of the form "owner/repo/number".
function ownerFromId(id) {
    if (typeof id != "string") return null;
    let owner = id.split("/")[0];
    return owner.length > 0 ? owner : null;
}

function orgNotAllowedError(owner) {
    let error = new Error(`PR Preview is not enabled for ${ owner || "this organization" }`);
    error.name = "ForbiddenOrgError";
    error.orgNotAllowed = true;
    error.status = 403;
    return error;
}

module.exports = { parseAllowedOrgs, isOrgAllowed, ownerFromId, orgNotAllowedError };
