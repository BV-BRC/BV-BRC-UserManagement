/**
 * Module dependencies.
 */
var passport = require('passport');
var login = require('connect-ensure-login');
var fs = require("fs-extra");
var bodyParser = require('body-parser');
var config = require("./config");
var uuid = require('node-uuid');
var crypto = require("crypto");

exports.index = [
	login.ensureLoggedIn(),
	function(req, res) {
		res.render('index', { title: 'User Service', request: req});
	}
]

exports.loginForm = function(req, res) {
	console.log("Render Login Form");
  	res.render('login', {title: "Login Form", request: req});
};

function generateBearerToken(user,req){
	var tokenid = uuid.v4().toString()
	var exp = new Date(); exp.setDate(exp.getDate()+1);
	var expiration=Math.floor(exp.valueOf()/1000);

	var payload = [
		"un=" + user.username, "tokenid=" + tokenid, 
		"expiry="+expiration,"client_id=" + user.username,
		"token_type=" + "Bearer"
	];
	
	payload.push("SigningSubject=" + config.get("signingSubjectURL"));
		
	var key = SigningPEM.toString('ascii');
        //var sign = crypto.createSign("RSA-SHA256");
        var sign = crypto.createSign("RSA-SHA1");
	sign.update(payload.join("|"));
	var signature = sign.sign(key,'hex');
	var token = payload.join("|") + "|sig=" + signature;

	console.log("New Bearer Token: ", token);
	return token; 
}

exports.login = [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		console.log("login()",req);
		passport.authenticate('local', function(err,user,info){
			console.log("local auth: ", user, info, req.query);
			if (err) { return next(err); }
			if (!user) { return res.redirect('/login'); }

			req.logIn(user, function(err) {
				if (err) { return next(err); }

				if (user && req.session) {
					delete user.password;
					req.session.userProfile = user;
					req.session.accessToken = generateBearerToken(user,req);
				}else{
					console.log("NO Session");
				}

				if (req.query.application_id){
					if (req.query.application_id=="patric3"){
						res.write("<html><body><script>window.location='" + config.get("patric3_webapp_callbackURL") + "';</script></body></html>");
						res.end();
						return;
//						return res.redirect(302, config.get("patric3_webapp_callbackURL"));
					}
				}	
				return res.redirect(302,'/'); // + user.username);
				next();
			});
		})(req,res,next);
	}
]

exports.logout = function(req, res) {
  req.logout();
  res.redirect('/');
}

 exports.account = [
   login.ensureLoggedIn(),
   function(req, res) {
     res.render('account', { user: req.user });
   }
 ]
