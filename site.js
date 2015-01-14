/**
 * Module dependencies.
 */
var passport = require('passport');
var login = require('connect-ensure-login');
var fs = require("fs-extra");
var bodyParser = require('body-parser');
var config = require("./config");
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

exports.login = [
	bodyParser.urlencoded({extended:true}),
	function(req,res,next){
		console.log("login()",req);
		passport.authenticate('local', function(err,user,info){
			console.log("local auth: ", user, info, req.query);
			if (err) { return next(err); }
//			if (!user) { return res.redirect('/login'); }

			req.logIn(user, function(err) {
				if (user) {
					delete user.password;
					req.session.userProfile = user;
				}
				
				if (err) { return next(err); }
				if (req.query.application_id){
					if (req.query.application_id=="patric3"){
						return res.redirect(302, config.get("patric3_webapp_callbackURL"));
					}
				}	
				return res.redirect('/'); // + user.username);
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
