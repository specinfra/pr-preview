"use strict";
const assert = require("assert"),
    BodyView = require("../../lib/views/body");
suite("Body view", function() {
    test("Test getDate", function() {
        let v = new BodyView();
        assert.equal(v.getDate(new Date(0)), "Jan 1, 1970, 12:00 AM UTC");
    });
    
    test("Test lastUpdated", function() {
        let v = new BodyView();
        assert.equal(v.lastUpdated(new Date(0),  "1234567"), "Last updated on Jan 1, 1970, 12:00 AM UTC (1234567)");
    });

    function file(name) {
        return {
            head: { short_sha: "7dfd134", filename: name, cache_url: `https://b/pull/1${ name ? "/" + name : ".html" }` },
            diff: { cache_url: `https://b/diff${ name ? "/" + name : ".html" }` }
        };
    }

    function pr(specs, isMultiSpec) {
        return { body: "", isMultiSpec: !!isMultiSpec, specs, built_specs: specs };
    }

    function links(html) {
        return html.split("\n").map(line => line.replace(/ title="[^"]*"/g, ""));
    }

    test("a single spec shows Preview | Diff", function() {
        let v = new BodyView();
        let spec = { isMultipage: false, preview_files: [file()] };
        assert.deepEqual(links(v.content(pr([spec]))), [
            '<a href="https://b/pull/1.html">Preview</a> | <a href="https://b/diff.html">Diff</a>'
        ]);
    });

    test("a multipage spec lists each page with its diff", function() {
        let v = new BodyView();
        let spec = { isMultipage: true, preview_files: [file("a.html"), file("b.html")] };
        assert.deepEqual(links(v.content(pr([spec]))), [
            '<a href="https://b/pull/1/a.html">/a.html</a>  ( <a href="https://b/diff/a.html">diff</a> )',
            '<a href="https://b/pull/1/b.html">/b.html</a>  ( <a href="https://b/diff/b.html">diff</a> )'
        ]);
    });

    test("several specs are listed by name", function() {
        let v = new BodyView();
        let specs = [
            { name: "/a.html", preview_files: [file("a.html")] },
            { name: "CSS Grid", preview_files: [file("css-grid/Overview.html")] }
        ];
        assert.deepEqual(links(v.content(pr(specs, true))), [
            '<a href="https://b/pull/1/a.html">/a.html</a>  ( <a href="https://b/diff/a.html">diff</a> )',
            '<a href="https://b/pull/1/css-grid/Overview.html">CSS Grid</a>  ( <a href="https://b/diff/css-grid/Overview.html">diff</a> )'
        ]);
    });

    test("one of several specs is still listed by name", function() {
        let v = new BodyView();
        let specs = [{ name: "CSS Grid", preview_files: [file("css-grid/Overview.html")] }];
        assert.deepEqual(links(v.content(pr(specs, true))), [
            '<a href="https://b/pull/1/css-grid/Overview.html">CSS Grid</a>  ( <a href="https://b/diff/css-grid/Overview.html">diff</a> )'
        ]);
    });
});
