"use strict";

const assert = require('assert');
const { parseAllowedOrgs, isOrgAllowed, ownerFromId } = require('../lib/allowed-orgs');

suite('allowed-orgs', () => {
    suite('parseAllowedOrgs', () => {
        test('should return null when no list is set', () => {
            assert.strictEqual(parseAllowedOrgs(undefined), null);
            assert.strictEqual(parseAllowedOrgs(""), null);
            assert.strictEqual(parseAllowedOrgs("  , "), null);
        });

        test('should parse comma and whitespace separated lists', () => {
            assert.deepStrictEqual(parseAllowedOrgs("org1"), ["org1"]);
            assert.deepStrictEqual(parseAllowedOrgs("org1,org2"), ["org1", "org2"]);
            assert.deepStrictEqual(parseAllowedOrgs(" org1 , org2 "), ["org1", "org2"]);
            assert.deepStrictEqual(parseAllowedOrgs("org1 org2"), ["org1", "org2"]);
        });

        test('should lowercase logins', () => {
            assert.deepStrictEqual(parseAllowedOrgs("Org1,ORG2"), ["org1", "org2"]);
        });
    });

    suite('isOrgAllowed', () => {
        test('should allow everything when unrestricted', () => {
            assert.strictEqual(isOrgAllowed("anyone", null), true);
        });

        test('should match logins case-insensitively', () => {
            assert.strictEqual(isOrgAllowed("ORG1", ["org1"]), true);
            assert.strictEqual(isOrgAllowed("org1", ["org1"]), true);
        });

        test('should reject logins which are not on the list', () => {
            assert.strictEqual(isOrgAllowed("unauthorized-org1", ["org1", "org2"]), false);
        });

        test('should reject missing logins when restricted', () => {
            assert.strictEqual(isOrgAllowed(undefined, ["org1"]), false);
            assert.strictEqual(isOrgAllowed("", ["org1"]), false);
        });
    });

    suite('ownerFromId', () => {
        test('should extract the owner from a job id', () => {
            assert.strictEqual(ownerFromId("org1/repo/123"), "org1");
        });

        test('should return null for unusable ids', () => {
            assert.strictEqual(ownerFromId(undefined), null);
            assert.strictEqual(ownerFromId("/repo/123"), null);
        });
    });
});
