var assert = require('assert'),
    Wattsi = require('../lib/wattsi-client'),
    path = require('path');

suite('WattsiClient.filter', function() {
    var w = new Wattsi();
    test('A single file changed', function() {
        var lines = ["Files ./foo/bar/baz/filename.html and ~/dir/filename.html differ"]
        assert.deepEqual(w.filter(lines), ["filename.html"]);
    });
    
    test('Multiple files changed', function() {
        var lines = [
            "Files ./foo/bar/baz/filename.html and ~/dir/filename.html differ",
            "Files ./foo/bar/baz/foo.html and ~/dir/foo.html differ",
            "Files ./foo/bar/baz/bar.html and ~/dir/bar.html differ"
        ];
        assert.deepEqual(w.filter(lines), ["filename.html", "foo.html", "bar.html"]);
    });
    
    test('A file was removed', function() {
        var lines = [
            "Files ./foo/bar/baz/filename.html and ~/dir/filename.html differ",
            "Only in ./foo/bar/baz: foobar.html",
            "Files ./foo/bar/baz/foo.html and ~/dir/foo.html differ",
            "Files ./foo/bar/baz/bar.html and ~/dir/bar.html differ"
        ];
        assert.deepEqual(w.filter(lines), ["filename.html", "foo.html", "bar.html"]);
    });
});

suite('WattsiClient.findFilesOnlyIn', function() {
    var w = new Wattsi();
    test('No files removed or added', function() {
        var lines = ["Files ./foo/bar/baz/filename.html and ~/dir/filename.html differ"]
        assert.deepEqual(w.findFilesOnlyIn("./foo/bar/baz", lines), []);
    });
    
    test('A file was only in the directory', function() {
        var lines = [
            "Files ./foo/bar/baz/filename.html and ~/dir/filename.html differ",
            "Only in ./foo/bar/baz: foobar.html",
            "Files ./foo/bar/baz/foo.html and ~/dir/foo.html differ",
            "Files ./foo/bar/baz/bar.html and ~/dir/bar.html differ"
        ];
        assert.deepEqual(w.findFilesOnlyIn("./foo/bar/baz", lines), ["foobar.html"]);
    });
    
    test('Multiple files were only in the directory', function() {
        var lines = [
            "Only in ./foo/bar/baz: foobar.html",
            "Only in ./foo/bar/baz: foo .html",
        ];
        assert.deepEqual(w.findFilesOnlyIn("./foo/bar/baz", lines), ["foobar.html", "foo .html"]);
    });
    
    test('A file was only in another directory', function() {
        var lines = [
            "Only in ./foo/bar/baz: bar.html",
            "Only in ./another/dir: foo.html",
        ];
        assert.deepEqual(w.findFilesOnlyIn("./foo/bar/baz", lines), ["bar.html"]);
    });
});

suite('WattsiClient.cleanup', function() {
    var childProcess = require('child_process'),
        originalExec = childProcess.exec,
        modulePath = require.resolve('../lib/wattsi-client'),
        commands;

    // wattsi-client binds child_process.exec at require time, so stub first and
    // then load a fresh copy of the module that picks up the stub.
    setup(function() {
        commands = [];
        childProcess.exec = function(cmd, callback) {
            commands.push(cmd);
            process.nextTick(function() { callback(null, "", ""); });
        };
        delete require.cache[modulePath];
    });

    teardown(function() {
        childProcess.exec = originalExec;
        delete require.cache[modulePath];
    });

    test('removes the per-PR directory (dirPath), not an undefined property', function() {
        var StubbedWattsi = require('../lib/wattsi-client');
        var w = new StubbedWattsi({ number: 1234 });
        return w.cleanup().then(function() {
            assert.deepEqual(commands, ["rm -rf " + w.dirPath]);
            assert.ok(/\/pr-preview\/whatwg\/html\/1234$/.test(w.dirPath));
            assert.ok(!/undefined/.test(commands[0]));
        });
    });

    test('rejects when the command fails', function() {
        childProcess.exec = function(cmd, callback) {
            process.nextTick(function() { callback(new Error("rm failed")); });
        };
        var StubbedWattsi = require('../lib/wattsi-client');
        var w = new StubbedWattsi({ number: 1234 });
        return w.cleanup().then(function() {
            assert.fail("expected cleanup to reject");
        }, function(err) {
            assert.equal(err.message, "rm failed");
        });
    });
});

suite('WattsiClient.unzip', function() {
    var childProcess = require('child_process'),
        originalExec = childProcess.exec,
        modulePath = require.resolve('../lib/wattsi-client'),
        commands;

    setup(function() {
        commands = [];
        childProcess.exec = function(cmd, callback) {
            commands.push(cmd);
            process.nextTick(function() { callback(null, "", ""); });
        };
        delete require.cache[modulePath];
    });

    teardown(function() {
        childProcess.exec = originalExec;
        delete require.cache[modulePath];
    });

    function newClient() {
        var StubbedWattsi = require('../lib/wattsi-client');
        return new StubbedWattsi({ number: 1234, head_sha: "head", merge_base_sha: "base" });
    }

    test('extracts only multipage-html (and xrefs.json for the head)', function() {
        var w = newClient();
        return w.unzip().then(function() {
            var unzips = commands.filter(function(c) { return c.indexOf("unzip ") == 0; });
            assert.deepEqual(unzips, [
                "unzip -q " + w.headZipPath + " 'multipage-html/*' 'xrefs.json' -d " + w.headUnzipDir,
                "unzip -q " + w.mergeBaseZipPath + " 'multipage-html/*' -d " + w.mergeBaseUnzipDir,
            ]);
        });
    });

    test('deletes each zip once it is extracted', function() {
        var w = newClient();
        return w.unzip().then(function() {
            var headUnzip = commands.indexOf("unzip -q " + w.headZipPath + " 'multipage-html/*' 'xrefs.json' -d " + w.headUnzipDir);
            var headRm = commands.indexOf("rm -f " + w.headZipPath);
            var baseRm = commands.indexOf("rm -f " + w.mergeBaseZipPath);
            assert.ok(headRm > headUnzip);
            assert.ok(baseRm > headRm);
        });
    });

    test('rejects, and keeps the zip, when unzip fails', function() {
        childProcess.exec = function(cmd, callback) {
            commands.push(cmd);
            var err = cmd.indexOf("unzip ") == 0 ? new Error("unzip failed") : null;
            process.nextTick(function() { callback(err, "", ""); });
        };
        var w = newClient();
        return w.unzip().then(function() {
            assert.fail("expected unzip to reject");
        }, function(err) {
            assert.equal(err.message, "unzip failed");
            assert.ok(!commands.some(function(c) { return c.indexOf("rm -f ") == 0; }));
        });
    });
});

suite('WattsiClient.fetch', function() {
    // Stands in for fetchZip: records how many Wattsi requests overlap and
    // settles on the next tick, rejecting for the shas listed in `failing`.
    function stubFetchZip(w, state, failing) {
        w.fetchZip = function(sha) {
            state.inFlight++;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            state.order.push(sha);
            return new Promise(function(resolve, reject) {
                setTimeout(function() {
                    state.inFlight--;
                    (failing || []).indexOf(sha) < 0 ? resolve() : reject(new Error("wattsi failed: " + sha));
                }, 5);
            });
        };
    }

    test('sends one Wattsi request at a time across PRs', function() {
        var state = { inFlight: 0, maxInFlight: 0, order: [] };
        var a = new Wattsi({ number: 1, head_sha: "a-head", merge_base_sha: "a-base" });
        var b = new Wattsi({ number: 2, head_sha: "b-head", merge_base_sha: "b-base" });
        stubFetchZip(a, state);
        stubFetchZip(b, state);
        return Promise.all([a.fetch(), b.fetch()]).then(function() {
            assert.equal(state.maxInFlight, 1);
            assert.equal(state.order.length, 4);
        });
    });

    test('a failed request does not block the ones behind it', function() {
        var state = { inFlight: 0, maxInFlight: 0, order: [] };
        var a = new Wattsi({ number: 3, head_sha: "c-head", merge_base_sha: "c-base" });
        var b = new Wattsi({ number: 4, head_sha: "d-head", merge_base_sha: "d-base" });
        stubFetchZip(a, state, ["c-head"]);
        stubFetchZip(b, state);
        var failed = a.fetch().then(function() {
            assert.fail("expected fetch to reject");
        }, function(err) {
            assert.equal(err.message, "wattsi failed: c-head");
        });
        return Promise.all([failed, b.fetch()]).then(function() {
            assert.equal(state.maxInFlight, 1);
            assert.deepEqual(state.order, ["c-head", "d-head", "d-base"]);
        });
    });
});

suite('WattsiClient.step', function() {
    var fs = require('fs'),
        memoryLogger = require('./support/memory-logger');

    function newClient(log) {
        return new Wattsi({ number: "test-" + process.pid, head_sha: "head", merge_base_sha: "base" }, { logger: log });
    }

    teardown(function() {
        fs.rmSync(newClient().dirPath, { recursive: true, force: true });
    });

    test('logs when a step starts and ends, with the scratch dir size', function() {
        var log = memoryLogger({ logLevel: "debug" });
        var w = newClient(log);
        return w.step("extract head build", function() {
            fs.mkdirSync(w.headDirPath, { recursive: true });
            fs.writeFileSync(w.headPath("a.html"), Buffer.alloc(2 * 1048576));
            return Promise.resolve("result");
        }).then(function(result) {
            assert.equal(result, "result");
            var records = log.records();
            assert.equal(records.length, 2);
            assert.equal(records[0].msg, "#" + w.number + " extract head build: starting");
            assert.ok(/: done in \d+ms \(scratch dir: 2 MB\)$/.test(records[1].msg), records[1].msg);
            assert.ok(records[0].memory.rss > 0);
            assert.ok(records[1].memory.rss > 0);
        });
    });

    test('logs a failed step and passes the error on', function() {
        var log = memoryLogger({ logLevel: "debug" });
        var w = newClient(log);
        return w.step("fetch head build", function() {
            return Promise.reject(new Error("Wattsi server error"));
        }).then(function() {
            assert.fail("expected step to reject");
        }, function(err) {
            assert.equal(err.message, "Wattsi server error");
            var messages = log.messages();
            assert.equal(messages[0], "#" + w.number + " fetch head build: starting");
            assert.ok(/: failed after \d+ms$/.test(messages[1]), messages[1]);
        });
    });

    test('the scratch dir size is 0 when there is none', function() {
        return newClient().scratchSize().then(function(size) {
            assert.equal(size, 0);
        });
    });
});

suite('WattsiClient.logListing', function() {
    var fs = require('fs'),
        memoryLogger = require('./support/memory-logger');

    function newClient(log) {
        return new Wattsi({ number: "test-" + process.pid }, { logger: log });
    }

    teardown(function() {
        fs.rmSync(newClient().dirPath, { recursive: true, force: true });
    });

    test('lists the unpacked files when debugging', function() {
        var log = memoryLogger({ logLevel: "debug" });
        var w = newClient(log);
        fs.mkdirSync(w.dirPath, { recursive: true });
        fs.writeFileSync(path.join(w.dirPath, "b.html"), "");
        fs.writeFileSync(path.join(w.dirPath, "a.html"), "");
        return w.logListing(w.dirPath).then(function() {
            assert.deepEqual(log.messages(), ["ls -A1 " + w.dirPath + ":\na.html\nb.html"]);
        });
    });

    test('does nothing when debug logging is off', function() {
        var log = memoryLogger({ logLevel: "info" });
        var w = newClient(log);
        return w.logListing("/does/not/exist").then(function() {
            assert.equal(log.text(), "");
        });
    });

    test('never fails the build', function() {
        var log = memoryLogger({ logLevel: "debug" });
        var w = newClient(log);
        return w.logListing("/does/not/exist").then(function() {
            assert.ok(/: failed$/.test(log.messages()[0]));
        });
    });
});
