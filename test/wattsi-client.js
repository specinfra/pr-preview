var assert = require('assert'),
    Wattsi = require('../lib/wattsi-client');

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
