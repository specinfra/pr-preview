"use strict";

const emuAlgify = require("emu-algify");
const webidlGrammar = require("webidl-grammar-post-processor");
const noop = (body) => Promise.resolve(body);

module.exports = (config) => {
    if (config) {
        if (config.name == "emu-algify") {
            return (body) => emuAlgify(body, config.options || {});
        } else if (config.name == "webidl-grammar") {
            return (body) => webidlGrammar(body, config.options || {});
        } else {
            throw new Error("Pre-processor config error: " + JSON.stringify(config));
        }
    } else {
        return noop;
    }
};

module.exports.noop = noop;