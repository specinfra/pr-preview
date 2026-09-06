"use strict";

var ViewBase = require('./base');

class ViewError extends ViewBase {
    constructor() {
        super();
    }
    
    content(pr, err) {
        return `
${ this.title(err) }

${ this.lead(err, pr) }

${ this.summary(err, pr) }
`;
    }
    
    title(err) {
        return `### :boom: ${err.name}: ${err.message} :boom: ###`;
    }

    lead(err, pr) {
        let str = this.lastTried(new Date(), pr);
        return `[PR Preview](https://github.com/specinfra/pr-preview#pr-preview) failed to build. ${ str }.`;
    }
    
    lastTried(date, pr) {
        let d = this.getDate(date);
        let sha = pr && pr.head && pr.head.short_sha;
        return `_(Last tried on ${d}` + (sha ? ` for ${sha})` : ")_");
    }

    service(err) {
        let service = err.data && err.data.service;
        return service ? `
PR Preview relies on a number of web services to run. There seems to be an issue with the following one:

:rotating_light: [${service.name}](${service.url}) - ${service.description}` : "";
    }

    link(err) {
        let url = err.data && err.data.request_url;
        return url ? `:link: [Related URL](${url})` : "";
    }
    
    stack(err) {
        if (!err.data) return "";
        let { request_url, service, error, ...rest } = err.data;
        if (error) {
            return `**Error output:**

\`\`\`
${error}
\`\`\``;
        }
        let keys = Array.isArray(err.data)
            ? err.data.filter(e => e && typeof e === "object")
            : Object.keys(rest).length > 0 ? rest : null;
        if (!keys) return "";
        return `**Error output:**

\`\`\`json
${JSON.stringify(keys, null, 4)}
\`\`\``;
    }

    fileIssue(err, pr) {
        let service = err.data && err.data.service;
        if (service) {
            let name = service.name;
            let link = `[${name}](${service.url})`;
            return `_This seems to be an issue with the ${ link } service. PR Preview doesn't manage this service and so has no control over it. If you've identified an issue with it, you can [report the issue to the maintainers of ${ name }](${ service.reportIssue }) directly. Please be courteous. Thank you!_

_If you don't have enough information above to solve the error by yourself or if the issue doesn't seem related to ${ name }, you can [file an issue with PR Preview](${ this.issueUrl(pr) })._`;
        } else {
            return `_If you don't have enough information above to solve the error by yourself, please [file an issue](${ this.issueUrl(pr) })._`; 
        } 
    }
    
    summary(err, pr) {
        let service = this.service(err);
        let link = this.link(err);
        let stack = this.stack(err);
        let fileIssue = this.fileIssue(err, pr);
        //if (!stack && !link) { return ""; }
        //if (!stack) { return link; }
        return `<details>
<summary>More</summary>

${ service }

${ link }

${ stack }

${ fileIssue }

</details>`;
    }
    
    issueUrl(pr) {
        var base = "https://github.com/specinfra/pr-preview/issues/new";
        return `${base}?title=Unidentified%20Error&body=See%20${pr.owner}/${pr.repo}%23${pr.number}.`;
    }
}

module.exports = ViewError;
