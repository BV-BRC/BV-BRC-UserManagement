var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var DataModel = require("../dataModel");
var when = require("promised-io/promise").when;
var errors = require("dactic/errors");
var UserModel = DataModel.get("user");
var generateToken = require("../generateToken");
var validateToken = require("../validateToken");
var bcrypt = require("bcrypt");



router.use(function(req,res,next){
	console.log("Reset Route Start");
	next();
});


/* Reset An account with a Reset Code */
router.get('/:email/:code', [
	function(req, res, next) {
		if (!req.params || !req.params.email|| !req.params.code) {
			return next(new errors.InvalidRequest("Missing Data in Reset URL"));
		}

		console.log("Resetting Account: ", req.params.email, req.params.code);
		when(UserModel.query("and(eq(email," + encodeURIComponent(req.params.email) + "),eq(resetCode," + req.params.code + "))&limit(1)"), function(results){
			var r = results.getData();
			if (r.length<1){
				return next(new errors.InvalidRequest("Invalid Reset Code"));
			}

			req.resetUser = r[0];
			console.log('reset user: ', req.resetUser);
			res.render("change_password",{title: "Set New Password", request:req});
		}, function(err){
			next(err);
		});
	}
]);


router.post('/:email/:code', [
	bodyParser.urlencoded(),
	function(req, res, next) {
		if (!req.params || !req.params.email|| !req.params.code || !req.body || !req.body.password) {
			return next(new errors.InvalidRequest("Missing Data form or URL based data"));
		}
		console.log("Resetting Account: ", req.params.email, req.params.code);
		when(UserModel.query("and(eq(email," + encodeURIComponent(req.params.email) + "),eq(resetCode," + req.params.code + "))&limit(1)"), function(results){
			var r = results.getData();
			if (r.length<1){
				return next(new errors.InvalidRequest("Invalid Reset Code"));
			}

			req.resetUser = r[0];

                        when(UserModel.setPassword(req.resetUser.id, req.body.password),function(){
                                res.redirect("/");
                        },next);
					
		}, function(err){
			next(err);
		});


	}
]);

module.exports = router;
