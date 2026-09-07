"use strict";

const postProcessor = require("../post-processor");
const fs = require("fs").promises;
const log = require("../logger").logger.child({ module: "file" });

module.exports = (superclass) => class extends superclass {
    async fetch() {
        log.debug({ path: this.filepath }, `Read ${this.filepath}`);
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