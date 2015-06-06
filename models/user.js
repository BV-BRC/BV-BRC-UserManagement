var ModelBase = require("dme/Model").Model;
var declare = require("dojo-declare/declare");
var when = require("promised-io/promise").when;
var defer = require("promised-io/promise").defer;
var config = require("../config");
var email = require("nodemailer");
var bcrypt = require("bcrypt");
var randomstring=require("randomstring");
var errors = require("dme/errors");
var smtpTransport = require("nodemailer-smtp-transport");

var Model = exports.Model = declare([ModelBase], {
	primaryKey: "id",

	schema: {
		"description": "Example Schema",
		"properties": {

		}
	},

	registerUser: function(user){
		var _self=this;
		console.log("registerUser this: ");
		var siteUrl = config.get("siteURL");
		var newUser = user; //{name: user.name, email: user.email}
		
		var q = ["or(eq(id,",encodeURIComponent(user.username), "),eq(email,", encodeURIComponent(user.email),"))"].join("");

		return when(this.query(q), function(res){
			if (res.results && res.results.length>0) {
				var msg;
				if (res.results[0].email == user.email){
					msg="User with the provided email address already exists.";
				}else{
					msg="The requested username is already in use.";
				}
				var err =  new errors.Conflict(msg);
				throw err;
			}else{
				return when(_self.post(newUser, {overwrite:false,id: user.username}), function(u){
					console.log("User Registered: ", u, " Resetting Account", arguments);
	
					return when(_self.resetAccount(u.id,{mail_user: false}), function(resetUser){
						console.log("Reset User: ", resetUser);
						return when(_self.mail(resetUser.id,"Click the following link or paste into your browser to Complete Registration\n\n\t " + siteUrl + "/reset/" + resetUser.email +"/" + resetUser.resetCode ,"PATRIC Registration",{}), function(){
							console.log("Registration Complete: ", resetUser);
							return resetUser;
						});
					});
				});
			}
		});
	},

	get: function(id, opts){
		return when(this.query("or(eq(id," + encodeURIComponent(id) +"),eq(email,"+encodeURIComponent(id)+"))"), function(res){
			if (res.results && res.results[0]) {
				return res.results[0];
			}else{
				return;
			}
		});
	},

	mail: function(userId,message,subject,options){
	        if (!message){throw Error("Message is required for mail()");}
	        var u;
	        if (typeof userId == "object"){
	                u = userId;
		}else{
			u = this.get(userId);
		}
		var transport;
		var _self = this;
		return when(u, function(user){
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
	},


	resetAccount: function(id,opts){
		var _self=this;
		opts = opts || {}
		console.log("Reset Account: ", id);
		return when(_self.get(id,opts), function(user) {	
			if (!user || !user.id) { throw Error("Unable to find user"); }
			var obj = {id: user.id, resetCode: randomstring.generate(5).toUpperCase()};
			return when(_self.post(obj,opts), function(res){
				console.log("resetAccount() post results: ", res);
				if (opts.mail_user) {
					var msg = resetMessage(obj.resetCode,user.email);
					console.log("mail ", id, msg);

					when (_self.mail(user.id,msg,"Password Reset"), function(){
						_self.emit("message",{action: "update", item: res});
					});
					return res;
				}
				return res;
		        });
		}, function(err){
			console.log("Invalid Account");
		});
	},

	setPassword: function(id, password, opts){
		var _self = this;
		opts = opts || {}
		if (!password) { throw Error("Password Required"); }
		if (!id) { throw Error("User ID Required"); }

		var def = new defer;
		console.log("Set Password for ", id)
		bcrypt.hash(password,10,function(err, pw){
			var obj = {id: id, password: pw, resetCode: null,updatedBy: "system"};
			console.log("Encrypted: ", obj)
			opts.overwrite=true
			when(_self.post(obj, opts), function(res){
				console.log("User " + id + " changed password.");
				def.resolve(res);
			}, function(err){
				console.log("Errr Posting Updated Password to db: ", err);
				def.reject(err);
			});
		})
        	return def.promise;
	},
	post: function(obj,opts){
		var _self=this;
	        opts=opts||{}
	        console.log("Model Post: ", obj);
	        if (obj && !obj.id){
			if (opts && opts.id) {
	                        obj.id = opts.id;
				opts.overwrite=true;
	                        //console.log("Generating New PatientUser with ID: ", obj.id);
	                }else if (obj.username) {
				obj.id = obj.username;
				delete obj.username;
				opts.overwrite=true;
                	}
		

	                obj.creationDate = new Date();
			obj.updateDate = new Date();
			obj.createdBy = (opts && opts.req && opts.req.user)?opts.req.user.id:"system";
			obj.updatedBy = obj.createdBy;
			var out = _self.updateObject({},obj);
			console.log("Posting New User: ",out)
			return when(_self.store.put(out,opts), function(res){
				console.log("model post() self.store.put() results: ", res);
				return res;
			},function(err){
				console.log("Error Creating User: ", err);
			});

		}else{
			console.log("Do Post to: ", obj.id, obj);
			return when(_self.store.get(obj.id), function(object) {
				console.log("Updating original UserObject: ", object);
				if (!object|| !object.id) {
					console.log("Object ID: ", object.id);
					throw errors.NotAcceptable();
				}
				obj.updateDate= new Date()
				if (!object.createdBy) {
					object.createdBy="system";
				}

				if (!object.updatedBy) {
					object.updatedBy="system";
				}

				if (!object.creationDate) {
					object.creationDate=new Date();
				}
				console.log("Update Object ", obj);
				var out = _self.updateObject(object, obj);
				console.log("Out: ", out);

				if (obj.resetCode===null) {
					console.log("delete resetCode");
					out.resetCode="";
				}

				opts.overwrite=true;

				return when(_self.put(out,opts), function(res){
					_self.emit("message",{action: "update", item: res});
					return res;
				});
			});
		}
	}
});

function resetMessage(resetCode,email) {
        console.log("Generate Reset Message");
	var siteUrl = config.get("siteURL");
        console.log("Reset Code: ", resetCode);
     	var msg = "Click the following link or paste into your browser to Reset Your Password \n\n\t"+ siteUrl + "/reset/" + email +"/"  + resetCode 

        return msg;
}

