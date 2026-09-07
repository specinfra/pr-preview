"use strict";
const log = require("./logger").logger.child({ module: "s3" });
var request = require("request");
var S3 = require('aws-sdk/clients/s3');
var s3 = new S3({
    apiVersion: '2006-03-01',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY    
});

var whatwgS3 = new S3({
    apiVersion: '2006-03-01',
    accessKeyId: process.env.WHATWG_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.WHATWG_AWS_SECRET_ACCESS_KEY
});

let getUrl = (bucket, key) => {
    // AWS_BUCKET_URL decouples the public URL from the bucket name, so then
    // default bucket can sit behind a custom domain or CDN. The WHATWG bucket
    // instead *is* named after its hostname.
    const base = process.env.AWS_BUCKET_URL;
    if (base && bucket == process.env.AWS_BUCKET_NAME) {
        return `${ base.replace(/\/$/, "") }/${ key }`;
    }
    if (bucket == process.env.WHATWG_AWS_BUCKET_NAME) {
        return `https://${ bucket }/${ key }`
    }
    return `https://${ bucket }.s3.amazonaws.com/${ key }`;
}
let getS3 = (bucket) => bucket == process.env.AWS_BUCKET_NAME ? s3 : whatwgS3;

let getContentType = (key) => {
    if (key.endsWith('.js')) return 'text/javascript;charset=utf-8';
    if (key.endsWith('.json')) return 'application/json;charset=utf-8';
    if (key.endsWith('.css')) return 'text/css;charset=utf-8';
    return 'text/html;charset=utf-8';
};

// Each cache operation logs one line saying what became of the key: found,
// cached, or failed. The URL carries the bucket, so it isn't logged separately.
let immutable = (bucket, key, fetch) => {
    var cachedUrl = getUrl(bucket, key);
    return new Promise((resolve, reject) => {
        getS3(bucket).headObject({
            Bucket: bucket,
            Key: key,
        }, (err, data) => {
            if (data) {
                log.debug({ key, url: cachedUrl }, `Found ${key} at ${cachedUrl}.`);
                resolve(cachedUrl);
            } else {
                fetch().then(output => {
                    getS3(bucket).putObject({
                        Bucket:       bucket,
                        Key:          key,
                        Body:         output,
                        ContentType:  getContentType(key),
                        CacheControl: "max-age=315569000, immutable"
                    }, (err, data) => {
                        if (data) {
                            log.debug({ key, url: cachedUrl }, `Cached ${key} at ${cachedUrl}.`);
                            resolve(cachedUrl);
                        } else {
                            log.warn({ key, err }, `Failed to cache ${key}.`);
                            reject(err);
                        }
                    });
                }, reject);
            }
        });
    });
};

let mutable = async (bucket, key, fetch) => {
    var cachedUrl = getUrl(bucket, key);

    const output = await fetch();

    await getS3(bucket).putObject({
        Bucket:       bucket,
        Key:          key,
        Body:         output,
        ContentType:  getContentType(key),
        CacheControl: "no-cache, no-store"
    }).promise();

    log.debug({ key, url: cachedUrl }, `Cached ${key} at ${cachedUrl}.`);
    return cachedUrl;
};

module.exports.mutable = mutable;
module.exports.immutable = immutable;
module.exports.getUrl = getUrl;
