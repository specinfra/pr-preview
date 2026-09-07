"use strict";
const { Writable } = require("stream");
const { createLogger } = require("../../lib/logger");

// A logger writing to memory, as JSON unless told otherwise, with what it
// wrote available to assert on. Not a test file, just used by them.
module.exports = function memoryLogger(config) {
    let out = "";
    const destination = new Writable({ write(chunk, encoding, cb) { out += chunk; cb(); } });
    const log = createLogger(Object.assign({ logFormat: "json", destination, colorize: false }, config));
    log.text = () => out;
    log.lines = () => out.split("\n").filter(Boolean);
    log.records = () => log.lines().map(line => JSON.parse(line));
    log.messages = () => log.records().map(r => r.msg);
    return log;
};
