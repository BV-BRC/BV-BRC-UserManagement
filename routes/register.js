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


/* Register a new user */
router.post('/', [
	bodyParser.urlencoded({extended:true}),
	bodyParser.json({type: "application/json"}),
	function(req, res, next) {

		if (!req.body || !req.body.username || !req.body.email || !req.body.first_name || !req.body.last_name){
			return next(new errors.BadRequest("Missing required fields"));
		}

		console.log("Registering New User: ", req.body.username, req.body.email);

		when(UserModel.registerUser(req.body), function(results){
			res.status(201);
			res.end();
		}, function(err){
			next(err);
		});
	}
]);


module.exports = router;
