"use strict";
const Head = require("./branch").Head;
const File = require("./file");
const WattsiFile = File.WattsiFile;
const AddedWattsiFile = File.AddedWattsiFile;
const RemovedWattsiFile = File.RemovedWattsiFile;
const UnchangedWattsiFile = File.UnchangedWattsiFile;
const AuxWattsiFile = File.AuxWattsiFile;
const Config = require("./config");
const WattsiClient = require("../wattsi-client");
const scanIncludes = require("../scan-includes");

// One spec of a PR's repository: its config and the files previewed for it.
// A config that lists several specs gives each one its own `filename`, the
// path of its preview under the PR's; a single-spec config has none, and
// keeps the PR's own preview URL.
class Spec {
    constructor(pr, config, filename) {
        this._pr = pr;
        this._config = config;
        this._filename = filename;
    }

    static fromConfig(pr, config) {
        let multi = Config.isMultiSpec(config);
        return Config.specs(config).map(c => new Spec(pr, c, multi ? Config.outputPath(c.src_file) : undefined));
    }

    get pr() {
        return this._pr;
    }

    get config() {
        return this._config;
    }

    get filename() {
        return this._filename;
    }

    get src_file() {
        return this.config.src_file;
    }

    // How the PR body names this spec when the config lists several.
    get name() {
        return this.config.name || `/${ this.filename }`;
    }

    get processor() {
        return this.config.type.toLowerCase();
    }

    get isMultipage() {
        return !!this.config.multipage;
    }

    get postProcessingConfig() {
        return this.config.post_processing;
    }

    async requestIncludes() {
        this.includes = await scanIncludes(Head.fromSpec(this).github_repo_url, this.src_file, this.config.type);
    }

    touchesSrcFile() {
        let relFiles = [this.src_file, ...(this.includes || [])];
        return this.pr.files.some(f => relFiles.includes(f.filename));
    }

    async getPreviewFiles() {
        if (this.processor == "wattsi") {
            this.wattsi = new WattsiClient(this.pr);
            await this.wattsi.getFilenames();
            this.preview_files = [];
            this.unchanged_files = [];
            this.aux_files = [];

            this.wattsi.modifiedFiles.forEach(f => {
                this.preview_files.push(new WattsiFile(this, this.wattsi, f));
            });
            this.wattsi.addedFiles.forEach(f => {
                this.preview_files.push(new AddedWattsiFile(this, this.wattsi, f));
            });
            this.wattsi.removedFiles.forEach(f => {
                this.unchanged_files.push(new RemovedWattsiFile(this, this.wattsi, f));
            });
            this.wattsi.unchangedFiles.forEach(f => {
                this.unchanged_files.push(new UnchangedWattsiFile(this, this.wattsi, f));
            });

            // Per-PR auxiliary resources: xrefs.json so dfn panels show PR-accurate
            // cross-references, and a rewritten html-dfn.js that fetches it relatively.
            this.aux_files.push(new AuxWattsiFile(this, this.wattsi, "xrefs.json", this.wattsi.xrefsPath));
            this.aux_files.push(new AuxWattsiFile(this, this.wattsi, "html-dfn.js", this.wattsi.dfnJsPath));
        } else {
            this.preview_files = [ new File(this, this.filename) ];
        }
    }

    async cacheAll() {
        for (let files of [this.preview_files, this.unchanged_files || [], this.aux_files || []]) {
            for (let file of files.slice().reverse()) {
                await file.cache();
            }
        }
    }

    // Removes the Wattsi scratch files, if any.
    async cleanup() {
        if (this.wattsi) {
            await this.wattsi.cleanup();
        }
    }
}

module.exports = Spec;
