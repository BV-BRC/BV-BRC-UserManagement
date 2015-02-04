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

exports.loginForm = function(req, res) {
	console.log("Render Login Form");
	console.log('req: ', req);
  	res.render('login', {title: "Login Form", request: req});
};

function generateBearerToken(user,req){
	var name = user.username || user.id;
	var tokenid = uuid.v4().toString()
	var exp = new Date(); exp.setDate(exp.getDate()+1);
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

exports.login = [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		passport.authenticate('local', function(err,user,info){
			console.log("local auth: ", user, info, req.query);
			if (err) { return next(err); }
			if (!user) { return res.redirect('/login'); }

			req.logIn(user, function(err) {
				if (err) { return next(err); }
				console.log("req.logIn user: ", user, "Session: ", req.session);

				if (user && req.session) {
					delete user.password;
					req.session.userProfile = user;
					req.session.authorizationToken = generateBearerToken(user,req);
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
		res.render("reset_password",{title: "PATRIC Registration", request:req});
	}

];
exports.resetPassword = [
	function(req,res,next) {
                var UserModel = dataModel.get("user");
		if (req.body.email) {
	                return when(UserModel.resetAccount(req.body.email,{mail_user:true}), function(user){
				res.render("reset_complete", {title: "Reset Complete", request: req});
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

exports.validateUserCredentials = [
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
