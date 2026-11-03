"use strict";

var ViewBase = require('./base');

let shorten = (txt, size) => {
    txt = txt.split("\n")[0];
    if (size < txt.length) {
        return txt.substr(0, size).trim() + "…";
    }
    return txt;
};

class ViewComment extends ViewBase {
    constructor() {
        super();
    }
    
    lastUpdated(date, sha) {
        return `Last updated on ${ this.getDate(date) } (${ sha })`;
    }
    
    content(pr) {
        let anchors = this.getAnchors(pr);
        let anchor = anchors.length == 1 ? anchors[0] : "";
        let size = Math.floor(40 / anchors.length);

        // Several specs are always listed by name, even when the PR changes
        // only one of them, so readers can tell which spec they're looking at.
        if (pr.isMultiSpec) {
            return pr.built_specs.map(spec =>
                this.listItem(spec.name, spec.preview_files[0], anchor, anchors, size)
            ).join("\n");
        }

        let spec = pr.specs[0];
        if (spec.isMultipage) {
            return spec.preview_files.map(f =>
                this.listItem(`/${f.head.filename}`, f, anchor, anchors, size)
            ).join("\n");
        }

        let f = spec.preview_files[0];
        let title = this.lastUpdated(new Date(), f.head.short_sha);
        let preview = this.displayLink("Preview", f.head.cache_url + anchor, title);
        let diff = this.displayLink("Diff", f.diff.cache_url, title);
        return `${ preview } ${ this.displayAnchors(f.head.cache_url, anchors, size) }| ${ diff }`;
    }

    // `label (diff)`, the label linking to the preview.
    listItem(label, f, anchor, anchors, size) {
        let title = this.lastUpdated(new Date(), f.head.short_sha);
        let preview = this.displayLink(label, f.head.cache_url + anchor, title);
        let diff = this.displayLink("diff", f.diff.cache_url, title);
        return `${ preview } ${ this.displayAnchors(f.head.cache_url, anchors, size) } ( ${ diff } )`;
    }
    
    displayLink(content, href, title) {
        return `<a href="${ href }" title="${title}">${ content }</a>`;
    }

    displayAnchors(url, anchors, size) {
        if (!anchors || anchors.length < 2) return "";
        if (typeof size == "number") {
          size = Math.floor(size);
          if (size < 3) {
            size = null;
          }
        }
        return anchors.map(a => `(<a href="${ url }${ a }" title="${ a }">${ size ? shorten(a, size) : "#" }</a>)`).join(" ") + " ";
    }
}

module.exports = ViewComment;