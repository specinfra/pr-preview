"use strict";

const postProcessor = require("../post-processor");
const fs = require("fs").promises;
const { log } = require("../logger").shared;

module.exports = (superclass) => class extends superclass {
    async fetch() {
        log(`Read file: ${ this.filepath }`);
        var postProcess = postProcessor(this.pr.postProcessingConfig) || postProcessor.noop;

        try {
            const body = await fs.readFile(this.filepath, "utf8");
            return await postProcess(body);
        } catch (err) {
            err.data = { filepath: this.filepath };
            throw err;
        }
    }
};