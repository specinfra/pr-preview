"use strict";
const GH_API = require("../GH_API");
const { dismiss } = require("../utils/error-utils");

const CONFIG_FILE = ".pr-preview.json";

const validator = require("tv4").freshApi();
const schema = require("./config-schema.json");

// Flags the error as "this repo has no config we can use", which dismisses the
// job instead of reporting it on the PR. The reason is what ends up in the log,
// so it has to say which of the several ways of having no config applied.
function markError(err, reason) {
    return dismiss(err, "noConfig", reason);
}

// The common case by far: the repo has no config file, i.e. it never opted
// into previews. That's routine, not a fault, and shouldn't read like one.
// GitHub answers 404 for a file an installation can't see as well as for one
// that isn't there, and simple-github drops the status code, so the two are
// indistinguishable here; the message it does keep is GitHub's own "Not Found".
function fetchFailureReason(err) {
    if (err.message == "Not Found") {
        return `no ${CONFIG_FILE}, repo hasn't opted into previews`;
    }
    let where = err.url ? ` from ${err.url}` : "";
    return `couldn't read ${CONFIG_FILE}${where}: ${err.message}`;
}

class Config {
    constructor(pr) {
        this.pr = pr;
    }

    request() {
        return this.pr.request(GH_API.GET_CONFIG_FILE).then(file => {
            if (file.type != "file") {
                throw markError(new Error(`${CONFIG_FILE} is not a file.`),
                    `${CONFIG_FILE} is a ${file.type}, not a file`);
            }
            var json;
            try {
                json = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
            } catch (err) {
                // Not a dismissal: the repo asked for previews, its config is
                // just broken, and whoever wrote it wants to hear about it.
                throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
            }
            Config.validate(json);
            console.log("Found repo config file", json);
            return Config.addDefault(json);
        }, err => { throw markError(err, fetchFailureReason(err)); });
    }
}

module.exports = Config;
module.exports.validate = function(config) {
    let result = validator.validateResult(config, schema);
    if (!result.valid) {
        let at = result.error.dataPath ? ` at ${result.error.dataPath}` : "";
        throw markError(result.error, `${CONFIG_FILE} is invalid${at}: ${result.error.message}`);
    }
};

module.exports.addDefault = function(config) {
    let type = config.type.toLowerCase();
    if (type == "respec") {
        if (!config.params || !("isPreview" in config.params)) {
            config.params = config.params || {};
            config.params.isPreview = true;
        }
    } else if (type == "bikeshed") {
        if (!config.params) {
            config.params = config.params || {};
        }
        if (!("md-warning" in config.params) && config.params["md-status"] !== "LS-PR") {
            // See https://github.com/specinfra/pr-preview/issues/55 for why LS-PR is special-cased.
            config.params["md-warning"] = "not ready";
        }
    } else if (type == "wattsi") {
        if (!("multipage" in config)) {
            config.multipage = true;
        }
    } else if (type == "html") {
        // No build step
    }
    return config;
};
