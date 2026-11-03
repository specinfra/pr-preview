"use strict";

const Head = require("./branch").Head;
const MergeBase = require("./branch").MergeBase;
const WattsiHead = require("./branch").WattsiHead;
const WattsiMergeBase = require("./branch").WattsiMergeBase;
const SpecDiff = require("./spec-diff");
const NoSpecDiff = SpecDiff.NoSpecDiff;
const AddedFileSpecDiff = SpecDiff.AddedFileSpecDiff;
const RemovedFileSpecDiff = SpecDiff.RemovedFileSpecDiff;

// Rewrite html-dfn.js path (again) so it works for diff pages.
const rewriteHtmlDfn = html =>
    html.replace(/src=(["']?)\/?html-dfn\.js\1/g, 'src=$1../html-dfn.js$1');


class File {
    constructor(spec, filename) {
        this._spec = spec;
        this._filename = filename;
    }

    get spec() {
        return this._spec;
    }

    get pr() {
        return this.spec.pr;
    }

    get head() {
        return this._head = this._head || Head.fromSpec(this.spec, this.filename);
    }
    
    get merge_base() {
        return this._merge_base = this._merge_base || MergeBase.fromSpec(this.spec, this.filename);
    }
    
    get filename() {
        return this._filename;
    }
    
    get diff() {
        return this._diff = this._diff || new SpecDiff(this.head, this.merge_base, this.filename);
    }

    async cache() {
        await Promise.all([this.head.cache(), this.merge_base.cache()]);
        await this.diff.cache();
    } 
}

class WattsiFile extends File {
    constructor(spec, wattsi, filename) {
        super(spec, filename);
        this._wattsi = wattsi;
    }

    get head() {
        return this._head = this._head ||
            WattsiHead.fromSpec(this.spec, this._wattsi.headPath(this.filename), this.filename);
    }

    get merge_base() {
        return this._merge_base = this._merge_base ||
            WattsiMergeBase.fromSpec(this.spec, this._wattsi.mergeBasePath(this.filename), this.filename);
    }

    get diff() {
        return this._diff = this._diff || new SpecDiff(this.head, this.merge_base, this.filename, rewriteHtmlDfn);
    }
}

class UnchangedWattsiFile extends WattsiFile {
    get diff() {
        return this._diff = this._diff || new NoSpecDiff(this.head, this.merge_base, this._wattsi.mergeBasePath(this.filename), this.filename);
    }

    async cache() {
        await this.head.cache();
        await this.diff.cache();
    } 
}

class AddedWattsiFile extends WattsiFile {
    get diff() {
        return this._diff = this._diff || new AddedFileSpecDiff(this.head, this.merge_base, this.filename, rewriteHtmlDfn);
    }

    async cache() {
        await this.head.cache();
        await this.diff.cache();
    }
}

class RemovedWattsiFile extends WattsiFile {
    get diff() {
        return this._diff = this._diff || new RemovedFileSpecDiff(this.head, this.merge_base, this.filename, rewriteHtmlDfn);
    }

    async cache() {
        await this.merge_base.cache();
        await this.diff.cache();
    }
}

// Auxiliary file uploaded per PR (e.g. xrefs.json, html-dfn.js). Head only, no diff.
class AuxWattsiFile {
    constructor(spec, wattsi, filename, filepath) {
        this._spec = spec;
        this._wattsi = wattsi;
        this._filename = filename;
        this._filepath = filepath;
    }

    get spec() { return this._spec; }
    get pr() { return this.spec.pr; }
    get filename() { return this._filename; }
    get filepath() { return this._filepath; }

    get head() {
        return this._head = this._head ||
            WattsiHead.fromSpec(this.spec, this._filepath, this.filename);
    }

    async cache() {
        await this.head.cache();
    }
}

module.exports = File;
module.exports.WattsiFile = WattsiFile;
module.exports.UnchangedWattsiFile = UnchangedWattsiFile;
module.exports.AddedWattsiFile = AddedWattsiFile;
module.exports.RemovedWattsiFile = RemovedWattsiFile;
module.exports.AuxWattsiFile = AuxWattsiFile;

