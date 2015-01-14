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
	"patric3_webapp_callbackURL": "http://www.patric.local:3000/auth/callback",
        "cookieSecret": "patric3",
        "cookieKey": "patric3",
        "cookieDomain": ".patric.local"
}

module.exports = nconf.argv().env().file("./p3-user.conf").defaults(defaults);
