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
var dataModel = require("./dataModel");
var when = require("promised-io/promise").when;
var bcrypt = require('bcrypt');

exports.index = [
	login.ensureLoggedIn(),
	function(req, res) {
		if (req.isAuthenticated() && req.user && req.user.roles && (req.user.roles.indexOf("admin")>=0)){
			return res.render("admin", { title: "User Administration", request:req });
		}
		res.redirect(302, "/user/" + req.user.id);
//		res.render('index', { title: 'User Service', request: req});
	}
]

exports.loginForm = [
	function(req, res) {
		console.log("Render Login Form");
		console.log('req.query: ', req.query);
		var callbackURL="/";
	
		if (req.query && req.query.application_id){
			if (req.query.application_id=="patric3"){
				callbackURL=config.get('patric3_webapp_callbackURL');
  				res.render('loginDialog', {title: "Login Form", request: req, callbackURL: callbackURL});
				return;
			}else{
				throw Error("Invalid Application ID");
			}
		}else{
			console.log("No Application ID, set call back to /");
		}
  		res.render('login', {title: "Login Form", request: req, callbackURL: callbackURL});
	}
];

exports.suloginForm = [
	function(req, res) {
		console.log("Render Login Form");
		console.log('req.query: ', req.query);
		var callbackURL="/";
		res.render('sulogin', {title: "SuperUser Login Form", request: req, callbackURL: callbackURL});
	}
];



function generateBearerToken(user,req){
	var name = user.username || user.id;
	var tokenid = uuid.v4().toString()
	var exp = new Date(); exp.setFullYear(exp.getFullYear()+1);
	var expiration=Math.floor(exp.valueOf()/1000);
	var realm = config.get('realm');
	
	var payload = [
		"un=" + name + "@" + realm, "tokenid=" + tokenid, 
		"expiry="+expiration,"client_id=" + name + "@" + realm,
		"token_type=" + "Bearer","realm=" + realm
	];
	
	payload.push("SigningSubject=" + config.get("signingSubjectURL"));
		
	var key = SigningPEM.toString('ascii');
        var sign = crypto.createSign("RSA-SHA1");
	sign.update(payload.join("|"));
	var signature = sign.sign(key,'hex');
	var token = payload.join("|") + "|sig=" + signature;
	console.log("New Bearer Token: ", token);
	return token; 
}

function generateJBOSSSession(req, user){


	req.session["portal.prinicipal" + user.id.replace("@patricbrc.org","") + "user"] = {
		"id": user.id.replace("@patricbrc.org",""),
		"name": user.name
	}

	req.session["portal.prinicipal" + user.id.replace("@patricbrc.org","") + "profile"] = {
		"user.name.family": user.name.split(" ")[1]||"",
		"user.name.nickName": user.name.split(" ")[0],
		"user.login.id": user.id.replace("@patricbrc.org",""),
		"portal.user.email.fake": null,
		"portal.user.last-login-date": new Date().valueOf(),
		"portal.user.enabled": true,
		"portal.user.email.view-real": false,
		"portal.user.registration-date": user.creationDate,
		"user.name.given": user.name.split(" ")[0],
		"user.business-info.online.email": user.email
	}

	req.session["PRINCIPAL_TOKEN"] = user.id.replace("@patricbrc.org","");

}

exports.login = [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		passport.authenticate('local', function(err,user,info){
			console.log("local auth: ", user, info, req.query);
			if (err) { return next(err); }
			if (!user) { 
				if (req.headers && req.headers["x-requested-with"] && (req.headers["x-requested-with"]=="XMLHttpRequest")){
                                        res.status(401);
                                        res.end();
                                        return;
                                }	
				return res.redirect('/login');
			 }

			req.logIn(user, function(err) {
				if (err) { return next(err); }

				console.log("req.logIn user: ", user, "Session: ", req.session);

				if (user && req.session) {
					delete user.password;
					delete user.reset_code;
					req.session.authorizationToken = generateBearerToken(user,req);
					user.id = user.id + "@patricbrc.org";
					req.session.userProfile = user;
				}else{
					console.log("NO Session");
				}

				if (req.headers && req.headers["x-requested-with"] && (req.headers["x-requested-with"]=="XMLHttpRequest")){
					req.session.save( function(){
						console.log("Session Saved: ", req.session);
						res.status(204);
						res.end();
					});
					return;
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

exports.sulogin = [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		passport.authenticate('local', function(err,user,info){
			console.log("local auth: ", user, info, req.query);
			if (err) { return next(err); }
			if (!user) { 
				if (req.headers && req.headers["x-requested-with"] && (req.headers["x-requested-with"]=="XMLHttpRequest")){
                                        res.status(401);
                                        res.end();
                                        return;
                                }	
				return res.redirect('/sulogin');
			 }

			if (user.isAdmin || (user.roles.indexOf("admin")>=0)){
				dataModel.get("user").get(req.body.suname).then(function(suser){
					req.logIn(suser, function(err){
		                                if (err) { return next(err); }

               			                 console.log("req.logIn user: ", user, "Session: ", req.session);

                               			 if (user && req.session) {
							delete suser.password;
							delete suser.reset_code;
							req.session.authorizationToken = generateBearerToken(suser,req);
							suser.id = suser.id + "@patricbrc.org";
							req.session.userProfile = suser;
		                                }else{
       							console.log("NO Session");
		                                }

		                                if (req.headers && req.headers["x-requested-with"] && (req.headers["x-requested-with"]=="XMLHttpRequest")){
               			                         req.session.save( function(){
                               			                 console.log("Session Saved: ", req.session);
		                                                res.status(204);
               			                                 res.end();
                               			         });
                                       			 return;
		                                }

						return res.redirect(302,'/'); 
						next();
					});

				}, function(err){
					console.log("Error Retrieving SU");
					res.status(500);
					res.write("Error Retreiving SU: ", err);
					res.end();
					return;
				});
			}else{
					res.status(403);
					res.write("Must be admin user to SU");
					res.end();
					return;
			}

		})(req,res,next);

	}
]



exports.logout = function(req, res) {
	console.log("Logout");
  req.session.destroy();
  req.logout();
  var redir = config.get("p3Home");
  if (redir) {
	res.redirect(redir);
  }else{
	  res.redirect('/');
  }
}
exports.register = [
	login.ensureLoggedOut({redirectTo: "/"}),
	function(req,res,next){
		res.render("registration",{title: "PATRIC Registration", request:req,error:false,formData:{}});
	}
]
exports.handleRegistration = [
	login.ensureLoggedOut(),
	function(req,res,next){
		//console.log("registration parameters: ", req.body);
		var UserModel = dataModel.get("user");
		when(UserModel.registerUser(req.body), function(user){
			res.render("registration_complete", {title: "Registration Complete", request: req});	
		}, function(err){
			console.log("Registration Error: ", err);
			res.render("registration",{title: "PATRIC Registration", request:req, error:err, formData: req.body});
		});
	}
];

exports.performResetWithCode = [
//	login.ensureLoggedOut({redirectTo: "/"}),
	function(req,res,next){
		console.log("req.params: ", req.params);
		if (!req.params.email || ! req.params.code) {		
			return res.render("do_reset", {title: "PASSWORD RESET", request:req});
		}

		var UserModel = dataModel.get('user');
		var query = "and(eq(resetCode," + encodeURIComponent(req.params.code) + "),eq(email," + encodeURIComponent(req.params.email) + "))";
		console.log("Query: ", query); 
		when(UserModel.query(query),function(results) {
			console.log("Perform Reset Search Results: ", results.results);;
			if (results.results && results.results.length==1) {
				var user = results.results[0];
				console.log("Change Password for User: ", user);
				res.render("change_password",{title: "Set New Password", request:req});
			}
		});
	}
];

exports.requestResetPassword = [
	login.ensureLoggedOut({redirectTo: "/"}),
	function(req,res,next){
		console.log("Render Reset Password Form");
		res.render("reset_password",{title: "PATRIC Registration", request:req, error: ""});
	}

];
exports.resetPassword = [
	function(req,res,next) {
                var UserModel = dataModel.get("user");
		if (req.body.email) {
	                return when(UserModel.resetAccount(req.body.email,{mail_user:true}), function(user){
				res.render("reset_complete", {title: "Reset Complete", request: req});
			}, function(err){
				res.render("reset_password", {title: "Reset Your Password", request: req, error: "Unable to reset the account with the provided id or email address"});
			});
                }

		next(new Error("Missing Email Address"));
	}

];
exports.changePasswordForm = [
	login.ensureLoggedIn({redirectTo: "/login"}),
	function(req,res,next){
		res.render("change_password",{title: "Change Password", request:req});
	}

];
exports.changePassword = [
	function(req,res,next){
		if (req.isAuthenticated && req.isAuthenticated()) {
			console.log("Change password for authenticated User");
			req.change_password_user = req.user;
			return next();
		}

		console.log("Req.body: ", req.body);
	
		if (req.body && req.body.code && req.body.email) {
			var UserModel = dataModel.get('user');
			var query = "and(eq(resetCode," + encodeURIComponent(req.body.code) + "),eq(email," + encodeURIComponent(req.body.email) + "))";
			console.log("Query: ", query);
			when(UserModel.query(query),function(results) {
	                        console.log("Perform Reset Search Results: ", results.results);;
				if (results && results.results && results.results.length>0) {
					req.change_password_user = results.results[0];
					return next();
				}
				next(new Error("Not Authorized"));
                	});

		}
	},

	function(req,res,next){
		if (req.change_password_user && req.body.password){
			console.log("SAVE NEW PASSWORD: ", req.body.password);
			var UserModel = dataModel.get("user");
			when(UserModel.setPassword(req.change_password_user.id, req.body.password),function(){
				res.redirect("/");			
			},next);
		}
	}
];
exports.validateUserCredentials= [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		when(dataModel.get("user").get(req.body.username),function(user){
			if (!user || !user.password){
				res.status(401);
				res.end();	
				return;
			}
			console.log("Login Check for: ", user, req.body.password);
			bcrypt.compare(req.body.password,user.password, function(err,results){
				if (err || !results) { 
					res.status(401)
					res.end();
					return;
				}

				res.status(204);	
				res.end();
			})
		}, function(err){
			res.status(401)
			res.end();
		});
	}
]
exports.simpleAuth= [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		when(dataModel.get("user").get(req.body.username),function(user){
			if (!user || !user.password){
				res.status(401);
				res.end();	
				return;
			}
			console.log("Login Check for: ", user, req.body.password);
			bcrypt.compare(req.body.password,user.password, function(err,results){
				if (err || !results) { 
					res.status(401)
					res.end();
					return;
				}

				var token = generateBearerToken(user,req);
				res.write(token);
				res.end();
			})
		}, function(err){
			res.status(401)
			res.end();
		});
	}
]
