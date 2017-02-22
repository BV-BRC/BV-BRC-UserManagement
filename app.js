var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var site = require("./site");
var session = require("express-session-unsigned");
var RedisStore = require('connect-redis')(session);
var passport = require("passport");
var oauth2 = require("./oauth2");
var config = require("./config");
var cors = require('cors');
var debug = require('debug')('p3api-user');
var userView = require("./routes/user");
var clientView= require("./routes/client");
var fs = require("fs-extra");
var app = express();
var DataModel = require("./dataModel");
var engine = require('dme');
var when = require("promised-io/promise").when;
var validateToken = require("./validateToken");
var package = require("./package.json");

require('dme/media/');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (config.get("signing_PEM")){
        var f = config.get("signing_PEM");
        if (f.charAt(0)!="/") {
                f = __dirname + "/" + f;
        }
        try {
                console.log("Filename: ", f);
                SigningPEM =   fs.readFileSync(f);
              if (SigningPEM) { console.log("Got PEM File") }
        }catch(err){
                console.log("Could not find PEM File: ", f, err);
        }
}


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
//app.use(bodyParser());
app.use(bodyParser.urlencoded({ extended: true}));
app.use(cors({origin: true, methods: ["GET,PUT,POST,PUT,DELETE"], allowHeaders: ["content-type", "authorization"],exposedHeaders: ['Content-Range', 'X-Content-Range'], credential: true, maxAge: 8200}));

app.use(cookieParser()); //config.get('cookieSecret')));

var sessionStore = app.sessionStore = new RedisStore(config.get("redis"));
console.log("sessionStore: ", sessionStore);
app.use(session({
    store: sessionStore,
    key: config.get("cookieKey"),
    cookie: { domain: config.get('cookieDomain'),  maxAge: 2628000000 },
    resave:false,
    saveUninitialized:true
}));

app.use(passport.initialize());
app.use(passport.session()); // persistent login sessions

app.use(function(req,res,next){
    console.log("Config.production: ", config.production);
    console.log("Session Data: ", req.session);
    req.config = config;
    req.production = config.get("production") || false;
    req.package = package;
    req.productionLayers=["p3/layer/core"]
    req.applicationOptions = {version: "3.0", workspaceServiceURL:config.get("workspaceServiceURL"),appServiceURL:config.get("appServiceURL"),dataServiceURL:config.get("dataServiceURL"), p3Home: config.get("p3Home") }
    next();
})

app.use(function(req,res,next){
	if (!req.isAuthenticated || (req.isAuthenticated && !req.isAuthenticated())){
		if (req.headers && req.headers["authorization"]) {
			when(validateToken(req.headers["authorization"]),function(valid){
				if (valid) {
					console.log("Valid Login: ", valid);
					req.logIn(valid, function(err){
						if (err) {return  next(err); }
						next();	
					});
				}else{
					next();
				}
			}, function(err){
				console.log("Invalid Token Validation");
				next(err);
			})
		}else {
			next();
		}
	}else{
		next();
	}
});

app.use(function(req,res,next){
	if (req.isAuthenticated && req.isAuthenticated()){
		console.log("loggedIn: ", req.user);
		if (req.user && req.user.roles && (req.user.roles.indexOf("admin")>=0)) {
			req.apiPrivilegeFacet="admin";
		}else{
			req.apiPrivilegeFacet="user";
		}
	}else{
		req.apiPrivilegeFacet="public";
//		if (req.session && req.session.userProfile){
//			req.session.regenerate();
//		}
	}
	console.log("USING PRIVILEGE FACET: ", req.apiPrivilegeFacet);
	next();
});


require("./auth");

app.use("/js/" + package.version + "/", [
        express.static(path.join(__dirname, 'public/js/release/'), {
                maxage:"356d",
                /*etag:false,*/
                setHeaders: function(res,path){
                        var d = new Date();
                        d.setYear(d.getFullYear() + 1);
                        res.setHeader("Expires", d.toGMTString());
                }
        }),
]);
app.post("/login", site.login);
app.post("/sulogin", site.sulogin);
app.get("/login", site.loginForm);
app.get("/sulogin", site.suloginForm);
app.get("/logout", site.logout);
app.get("/register", site.register);
app.post("/register", site.handleRegistration);
app.get("/reset/:email/:code", site.performResetWithCode);
app.get("/reset_password", site.requestResetPassword);
app.post("/reset_password", site.resetPassword);
app.get("/change_password", site.changePasswordForm);
app.post("/change_password", site.changePassword);
app.post("/validate", site.validateUserCredentials);
app.post("/authenticate", site.simpleAuth);

app.get("/public_key", [
	function(req,res,next){
		var pubKeyFile = config.get('signing_public_PEM');
		if (!pubKeyFile) { console.log("pubKeyFile found"); next("route"); }
		fs.readFile(pubKeyFile,"utf-8", function(err,data){
			if (err) { return next(err); }
			console.log("Pub Key: ", data);		
			res.write(JSON.stringify({"pubkey":data,"valid":1}));
			console.log("JSON Written");
			res.end();
			console.log("After end");
		});
	}
]);

app.use(engine(DataModel));

//app.get("/dialog/authorize", oauth2.authorization);
//app.post("/dialog/authorize/decision", oauth2.decision);
//app.post("/oauth2/token", oauth2.token);

//app.get("/api/userinfo", userView.info);
//app.get("/api/clientinfo", clientView.info);

app.get("/$", site.index)
app.use(express.static(path.join(__dirname, 'public')));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});


module.exports = app;

require("replify")({name: "p3api", path: "./REPL"},app,{});
