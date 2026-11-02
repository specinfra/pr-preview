"use strict";
const assert = require("assert"),
    SpecDiff = require("../../lib/models/spec-diff"),
    PR = require("../../lib/models/pr"),
    File = require("../../lib/models/file"),
    Spec = require("../../lib/models/spec");

const payload = require("../fixtures/pr");
const payload2 = require("../fixtures/pr2");

suite("SpecDiff model", function() {
    test("Test constructor", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        let sp = new File(new Spec(pr, {})).diff;
        assert(sp instanceof SpecDiff);
    });
    
    test("Test in_same_repo getter", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        let sp = new File(new Spec(pr, {})).diff;
        assert.equal(sp.in_same_repo, false);
        
        pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload2.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        sp = new File(new Spec(pr, {})).diff;
        assert(sp.in_same_repo);
    });
    
    test("Test key getter", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        let sp = new File(new Spec(pr, {})).diff;
        assert.equal(sp.key, "heycam/webidl/283/c2fd513...tobie:7dfd134.html");
        
        pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload2.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        sp = new File(new Spec(pr, {})).diff;
        assert.equal(sp.key, "heycam/webidl/283/c2fd513...7dfd134.html");
    });
    
    test("Test key getter for specific page names", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        let sp = new File(new Spec(pr, {}), "foo.html").diff;
        assert.equal(sp.key, "heycam/webidl/283/c2fd513...tobie:7dfd134/foo.html");
    });

    test("Test key getter for a spec in a directory", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        let sp = new File(new Spec(pr, {}), "css-grid-2/Overview.html").diff;
        assert.equal(sp.key, "heycam/webidl/283/c2fd513...tobie:7dfd134/css-grid-2/Overview.html");
    });
});