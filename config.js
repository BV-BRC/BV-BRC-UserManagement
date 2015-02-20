var nconf = require('nconf');

var defaults =  {
	"http_port": 3002,

	"mongo": {
		"url": "http://localhost:8983/solr"
	},
        "redis": {
                "host": "127.0.0.1",
                "port": 6379,
                "db": 1,
                "pass":""
        },
	"siteURL": "http://user.patric.local:3002",
	"patric3_webapp_callbackURL": "http://www.patric.local:3000/auth/callback",
        "//cookieSecret": "patric3",
        "cookieKey": "JSESSIONID",
        "cookieDomain": ".patric.local",
	"signing_PEM": "private.pem",
	"signing_public_PEM": "public.pem",
	"realm": "patricbrc.org",
	"email": {
		"localSendmail": false,
		"defaultFrom": "PATRIC <do-not-reply@patricbrc.org>",
		"defaultSender": "PATRIC <do-not-reply@patricbrc.org>",
                "host": "",
                "port":587
        },
}

module.exports = nconf.argv().env().file("./p3-user.conf").defaults(defaults);
