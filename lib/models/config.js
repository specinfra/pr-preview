"use strict";
const GH_API = require("../GH_API");
const { dismiss } = require("../utils/error-utils");
const log = require("../logger").logger.child({ module: "config" });

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
            log.debug({ config: json }, `${CONFIG_FILE}: ${JSON.stringify(json)}`);
            return json;
        }, err => { throw markError(err, fetchFailureReason(err)); });
    }
}

module.exports = Config;
function check(data, schema, path) {
    let result = validator.validateResult(data, schema);
    if (!result.valid) {
        let at = path + result.error.dataPath;
        throw markError(result.error, `${CONFIG_FILE} is invalid${at ? ` at ${at}` : ""}: ${result.error.message}`);
    }
}

function invalid(message) {
    return markError(new Error(`${CONFIG_FILE} is invalid: ${message}`), `${CONFIG_FILE} is invalid: ${message}`);
}

// Where a spec's preview goes, relative to the PR's previews, when the config
// lists several specs: its source path with an .html extension, so specs in
// different directories don't collide.
function outputPath(srcFile) {
    return srcFile.replace(/\.[^./]*$/, "") + ".html";
}

function isMultiSpec(config) {
    return Array.isArray(config);
}

// A config is either one spec or an array of them, each checked on its own.
module.exports.validate = function(config) {
    if (!isMultiSpec(config)) {
        check(config, schema, "");
        return;
    }
    if (config.length == 0) {
        throw invalid("the list of specs is empty");
    }
    let seen = new Map();
    config.forEach((spec, i) => {
        check(spec, schema, `/${i}`);
        if (spec.type.toLowerCase() == "wattsi") {
            throw invalid(`a wattsi spec can't be one of several, at /${i}`);
        }
        let path = outputPath(spec.src_file);
        if (seen.has(path)) {
            throw invalid(`/${seen.get(path)} and /${i} would both be previewed at ${path}`);
        }
        seen.set(path, i);
    });
};

module.exports.isMultiSpec = isMultiSpec;
module.exports.outputPath = outputPath;

// The config of each spec in the file, with defaults applied. A single-spec
// config is a list of one.
module.exports.specs = function(config) {
    let specs = isMultiSpec(config) ? config : [config];
    return specs.map(c => module.exports.addDefault({ ...c }));
};

module.exports.addDefault = function(config) {
    let type = config.type.toLowerCase();
    if (type == "respec") {
        if (!config.params || !("isPreview" in config.params)) {
            config.params = { ...config.params, isPreview: true };
        }
    } else if (type == "bikeshed") {
        config.params = { ...config.params };
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
