#!/usr/bin/env nodejs

var argv = require('minimist')(process.argv.slice(1));
var command = require('path').basename(argv._[0]);

var nameRegexp = /(.+) \((.+\@.+)\)/i;

var parseName = function(string) {
    var m;
    if ((m = nameRegexp.exec(string)) !== null) {
        if (m.index === nameRegexp.lastIndex) {
            nameRegexp.lastIndex++;
        }
        return {
            "name": m[1],
            "email": m[2]
        };
    }

    else {
        return {
            "name": string,
            "email": ""
        };
    }
};

var params = {
    "id": argv.change,
    "draft": argv['is-draft'],
    "url": argv['change-url'],
    "project": argv.project,
    "branch": argv.branch,
    "topic": argv.topic,
    "uploader": parseName(argv.uploader),
    "commit": argv.commit,
    "patchset": argv.patchset,
    "author": parseName(argv.author),
    "comment": argv.comment,
    "reason": argv.reason,
    "oldTopic": argv['old-topic'],
    "newTopic": argv['new-topic'],
    "submitter": parseName(argv.submitter)
};

console.dir(params);

require("./gerritflow.js").processHook(command, params);
