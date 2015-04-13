var https = require("https");
var http = require("http");

var colors = {
    "yellow": "yellow",
    "red": "red",
    "blue": "blue",
    "green": "green",
    "cyan": "cyan",
    "orange": "orange",
    "grey": "grey",
    "black": "black",
    "lime": "lime",
    "purple": "purple"
};

var foreignData = {
    "gerrit": undefined
}

var flowId;
var params;
var command;

exports.processHook = function(c, p) {
    /*
     "id", "draft", "url", "project", "branch", "topic",
     "uploader", "commit", "patchset", "author.name",
     "author.email", "comment", "reason", "oldTopic",
     "newTopic"
     */
    command = c;
    params = p;

    console.log(":: "+command+": "+params.project+":"+params.branch);
    flowId = findFlowId(params);
    if (!flowId) {
        console.log("Failed to find a flow id");
        return;
    }

    console.log("Found flow id: "+flowId);

    queryGerrit();
};

var findFlowId = function(params) {
    // TODO change the code to support sending one message to several flows.

    var flowId = null;
    require("./config.json").some(function (conf) {
        var project = null;
        conf.projects.some(function(p) {
            if (p === params.project) {
                project = p;
                console.log("project match found: "+p);
                return true;
            }
            return false;
        });

        if (!project) return false;

        var branch = null;
        conf.branches.some(function (b) {
            if (b === params.branch) {
                branch = b;
                console.log("branch match found: "+b);
                return true;
            }
            return false;
        });

        if (!branch) return false;

        flowId = conf.flowId;
        return true;
    });

    return flowId;
};

var createMessageStub = function(params) {
    return {
        "flow_token": flowId,
        "event": "activity",
        "author": {
            "name": "[name]",
            "email": "[email]"
        },
        "title": "[activity title]",
        "external_thread_id": params.id,
        "thread": {
            "title": "[title]",
            "fields": [],
//            "body": "[commit message]",
            "external_url": params.url,
            "status": {
                "color": colors.grey,
                "value": "[status]"
            }
        }
    };
};

var getUpdateTitle = function(command) {
    switch (command) {
        case "patchset-created": return "added a patch";
        case "comment-added": return "commented";
        case "change-merged": return "merged the code";
        default: return "["+command+"]";
    }
};

var queryGerrit = function() {
    var url = "http://dev.vaadin.com/review/changes/"+params.id+"/detail";
    http.get(url, function(res) {
        if (res.statusCode !== 200) {
            throw "Querying Gerrit failed with the status code "+res.statusCode;
        }

        res.setEncoding("utf8");

        var data = "";
        res.on("data", function(d) {
            data += d;
        });

        res.on("end", function() {
            var gerrit = JSON.parse(data.substr(4));
            foreignData.gerrit = {
                "diff": "+"+gerrit.insertions+"/-"+gerrit.deletions,
                "verified": getExtremeValue(gerrit.labels['Verified'].all),
                "codeReview": getExtremeValue(gerrit.labels['Code-Review'].all),
                "status": gerrit.status,
                "subject": gerrit.subject
            };

            tryCallFlowdock();
        });
    }).on("error", function(e) {
        throw e;
    });
};

var getExtremeValue = function(gerritValues) {
    var value = 0;
    var currentString = "-";
    gerritValues.forEach(function (e) {
        var v = e.value;
        if (v < 0) {
            value = Math.min(value, v);
            currentString = getScoreString(value)+" "+ e.name;
        }
        else if (value == 0 && v > 0) {
            value = Math.max(value, v);
            if (value != 0) currentString = getScoreString(value)+" "+ e.name;
        }
    });
    return currentString;
}

var getScoreString = function(score) {
    if (score > 0) return "+"+score;
    if (score < 0) return ""+score;
    return "-";
};

var tryCallFlowdock = function() {
    if (foreignData.gerrit) {
        callFlowdock();
    }
};

var callFlowdock = function() {
    var message = createMessageStub(params);
    message.author = getAuthor();
    message.title = getUpdateTitle(command);
    message.external_thread_id = params.id;
    message.thread.title = foreignData.gerrit.subject;
    message.thread.external_url = params.url;

    /*
    message.thread.fields.push({
        "label": "Diff",
        "value": foreignData.gerrit.diff
    });
    */

    message.thread.fields.push({
        "label": "Code-Review",
        "value": foreignData.gerrit.codeReview
    });

    message.thread.fields.push({
        "label": "Verified",
        "value": foreignData.gerrit.verified
    });

    if (params.topic) {
        message.thread.fields.push({
            "label": "Topic",
            "value": params.topic
        });
    }

    message.thread.status = {
        "value": foreignData.gerrit.status,
        "color": getStatusColor(foreignData.gerrit.status,
            foreignData.gerrit.codeReview, foreignData.gerrit.verified)
    };

    var messageString = JSON.stringify(message);

    console.dir(messageString);

    // prep https POST //

    var headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(messageString, 'utf8')
    };

    var options = {
        "host": "api.flowdock.com",
        "path": "/messages",
        //"host": "requestb.in", // remember: requestb.in requires http, not https
        //"path": "[id]",
        "method": "POST",
        "headers": headers
    };

    var req = https.request(options, function(res) {
        res.setEncoding("utf-8");

        var responseString = '';
        res.on('data', function(data) {
            responseString+=data;
        });

        res.on('end', function() {
            console.dir("end:");
            console.dir(responseString);
        })
    });

    req.on('error', function(e) {
        console.dir("error:");
        console.dir(e);
        process.exit(1);
    });

    req.write(messageString);
    req.end();
};

var getAuthor = function() {
    switch (command) {
        case "comment-added": return params.author;
        case "change-merged": return params.submitter;
        default: return params.uploader;
    }
};

var getStatusColor = function(status, codeReview, verified) {
    /*
     * "-1 foo" == -1
     * "2 foo" == 2
     * "-" == NaN
     */
    if (parseInt(codeReview) < 0 || parseInt(verified) < 0) {
        return colors.red;
    }

    switch (status) {
        case "NEW": return colors.yellow;
        case "SUBMITTED": return colors.blue;
        case "MERGED": return colors.green;
        case "ABANDONED": return colors.red;
        case "DRAFT": return colors.grey;
        default: return colors.red;
    }
};
