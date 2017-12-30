var when = require("promised-io/promise").when;
var defer = require("promised-io/promise").defer;
var config = require("../config");
var email = require("nodemailer");
var bcrypt = require("bcrypt");
var randomstring=require("randomstring");
var smtpTransport = require("nodemailer-smtp-transport");
var ModelBase = require("./base");
var config = require("../config");
var errors = require("dactic/errors");
var util = require("util");
var Result = require("dactic/result");



function resetMessage(resetCode,email) {
        console.log("Generate Reset Message");
	var siteUrl = config.get("siteURL");
        console.log("Reset Code: ", resetCode);
     	var msg = "Click the following link or paste into your browser to Reset Your Password \n\n\t"+ siteUrl + "/reset/" + email +"/"  + resetCode 
        return msg;
}

var Model = module.exports = function(store,opts){
        ModelBase.apply(this,arguments);
}

util.inherits(Model, ModelBase);

Model.prototype.primaryKey="id";
Model.prototype.maxLimit=999999;
Model.prototype.defaultLimit=25;
Model.prototype.schema={
	"description": "User Schema",
	"properties": {
		id: {
			type: "string",
			description: "Id of User"	
		},
		first_name: {
			type: "string",
			description: ""
		},
		last_name: {
			type: "string",
			description: ""
		},

		affiliation: {
			type: "string",
			description: ""
		},
		organisms: {
			type: "string",
			description: ""
		},

		interests: {
			type: "string",
			description: ""
		},

		creationDate: {
			type: "string",
			description: ""
		},
		updateDate: {
			type: "string",
			description: ""
		},
		mailingList: {
			type: "boolean",
			description: ""
		},
		registrationDate: {
			type: "string",
			description: ""
		},

		lastLogin: {
			type: "string",
			description: ""
		},
		createdBy: {
			type: "string",
			description: ""
		},
		updatedBy: {
			type: "string",
			description: ""
		},

		roles: {
			type: "string",
			description: ""
		}
	},
	required: ["id","email", "first_name", "last_name"],
}

Model.prototype.registerUser = function(user){
		var _self=this;
		console.log("registerUser this: ");
		var siteUrl = config.get("siteURL");
		var newUser = user; //{name: user.name, email: user.email}
		var username = user.username;
		delete user.username;

		var q = ["or(eq(id,",encodeURIComponent(username), "),eq(email,", encodeURIComponent(user.email),"))&limit(1)"].join("");

		return when(this.query(q), function(res){
			var results = res.getData()
			if (results && results.length>0) {
				var msg;
				if (results[0].email == user.email){
					msg="User with the provided email address already exists.";
				}else{
					msg="The requested username is already in use.";
				}
				var err =  new errors.Conflict(msg);
				throw err;
			}else{
				return when(_self.post(newUser, {id: username}), function(u){
					console.log("User Registered: ", newUser, " Resetting Account: ",newUser.id);
					return when(_self.resetAccount(newUser.id,{mail_user: false}), function(resetResults){
						var resetUser=resetResults.getData();
						console.log("resetUser: ", resetUser);
						return when(_self.mail(newUser.id,"Click the following link or paste into your browser to Complete Registration\n\n\t " + siteUrl + "/reset/" + encodeURIComponent(newUser.email) +"/" + resetUser.resetCode ,"PATRIC Registration",{}), function(){
							console.log("Registration Complete: ", resetUser);
							return resetUser;
						});
					});
				});
			}
		});
}

Model.prototype.get = function(id, opts){
	console.log("GET(",id,")");
	return when(this.query("or(eq(id," + encodeURIComponent(id) +"),eq(email,"+encodeURIComponent(id)+"))&limit(1)"), function(res){
		//console.log("get user res: ", res)
		var user = res.getData()[0];
		if (user){
			return new Result(user);
		}else{
			return new errors.NotFound("User Not Found");
		}
	});
}

Model.prototype.mail=function(userId,message,subject,options){
	        if (!message){throw Error("Message is required for mail()");}
	        var u;
	        if (typeof userId == "object"){
	                u = userId;
		}else{
			u = this.get(userId);
		}
		var transport;
		var _self = this;
		return when(u, function(gres){
			var user = gres.getData();
			console.log("user: ", user);
			console.log("Sending mail to : ", user.email);
			var mailconf = config.get("email");

			if (mailconf.localSendmail){
	                //        transport = email.createTransport("Sendmail");
				transport = email.createTransport();
//				email.sendmail=true;
			}else{
//	                        email.sendmail=false;
				email.SMTP = {
	                                host: mailconf.host || "localhost",
					port: mailconf.port || 25
				}
			}

			if (mailconf.username) {
	                        email.SMTP.use_authentication=true;
				email.SMTP.user=mailconf.username;
				email.SMTP.pass=mailconf.password;
			}

			if (!transport){
				var transportOpts = {
					host: mailconf.host || "localhost",
					port: mailconf.port || 25,
					debug: true
				}
				if (mailconf.username){
					transportOpts.auth = {
						user: mailconf.username,
						pass: mailconf.password
					}
				}
				var transport = email.createTransport(smtpTransport(transportOpts));
			}

	                var mailmsg = {
				debug: true,
	                        to: user.email,
				sender: mailconf.defaultFrom, //"responder@hapticscience.com", // mailconf.defaultFrom,
				from: mailconf.defaultFrom,
				subject: subject || "No Subject",
				text: message
			}

			console.log("Sending Email: ",mailmsg);

			var deferred = new defer();

			transport.sendMail(mailmsg, function(err, result){
				console.log("sendMail result: ", err, result);
				if (deferred.fired){return;}
				if (err) {
					deferred.reject(err);
					return;
				}

				deferred.resolve(result)
			});

			return deferred.promise;
		});
}


Model.prototype.resetAccount= function(id,opts){
	var _self=this;
	opts = opts || {}
	console.log("Reset Account: ", id);
	var patch = [{ "op": "add", "path": "/resetCode", "value": randomstring.generate(5).toUpperCase() }]
	return when(_self.patch(id,patch), function(){

		return when(_self.get(id), function(ruser){
			var user = ruser.getData();
			console.log("POST PATCH USER: ", user);

			var msg = resetMessage(user.resetCode,user.email);

			if (opts.mail_user){
				return (_self.mail(user, msg, "Password Reset"), function(){
					_self.emit("message",{action: "update", item: user});
					return new Result(user);
				})
			}else{
				return new Result(user);
			}
		})
	})
}

Model.prototype.setPassword = function(id, password, opts){
	var _self = this;
	opts = opts || {}
	if (!password) { throw Error("Password Required"); }
	if (!id) { throw Error("User ID Required"); }

	var def = new defer;
	console.log("Set Password for ", id)
	bcrypt.hash(password,10,function(err, pw){
		var patch = [
			{ "op": "add", "path": "/password", "value": pw},
			{ "op": "replace", "path": "/updatedBy", "value": "system" },
			{ "op": "remove", "path": "/resetCode"},
			{ "op": "replace", "path": "/updateDate", "value": new Date().toISOString() }
		]

		opts.overwrite=true
		when(_self.patch(id,patch, opts), function(res){
			console.log("User " + id + " changed password.");
			def.resolve(true);
		}, function(err){
			console.log("Errr Posting Updated Password to db: ", err);
			def.reject(err);
		});
	})
       	return def.promise;
}

Model.prototype.post = function(obj,opts){
	var _self=this;
        opts=opts||{}
        console.log("Model Post: ", obj);
	obj.id = opts.id
	opts.overwrite=false;
	
	var now = new Date().toISOString();
	obj.creationDate = now;
	obj.updateDate = now;
	obj.createdBy = (opts && opts.req && opts.req.user)?opts.req.user.id:"system";
	obj.updatedBy = obj.createdBy;
	var out = _self.mixinObject({},obj);
	console.log("Adding New User: ",out)
	return when(_self.store.put(out,opts), function(res){
		console.log("model post() self.store.put() results: ", res);
		return new Result(out);
	},function(err){
		console.log("Error Creating User: ", err);
	});

}

