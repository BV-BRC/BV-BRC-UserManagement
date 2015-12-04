var DataModel = require("dme/DataModel");
var RestrictiveFacet = require("dme/RestrictiveFacet");
var PermissiveFacet= require("dme/PermissiveFacet");
var models = require("./models");
var MongoStore = require("dme/store/mongodb");
var config = require("./config");
var when = require('promised-io/promise').when;
var dataModel = new DataModel({});

console.log("Found Models: ", models);

Object.keys(models).forEach(function(modelId){
	var mongoStore = new MongoStore(modelId,{url: config.get("mongo").url});
	var model = new models[modelId].Model(mongoStore,{});
	var publicFacet,userFacet;
	switch(modelId){
		case "user":
			publicFacet = new RestrictiveFacet({model: model,
				get: function(id, opts) {
					return this.model.get(id,opts);
				},
				query: function(query,opts){
					return when(this.model.query(query,opts), function(response){
						if (response && response.results) {
							response.results = response.results.map(function(res){
								delete res.resetCode;
								delete res.email;
								delete res.password;
								return res;	
							});
						}
	
						return response
					});
				}
			})
			userFacet = new RestrictiveFacet({model: model,
				get: function(id, opts) {
					return this.model.get(id,opts);
				},
				post: function(obj, opts) {
					return this.model.post(obj,opts);
				},
	
				query: function(query,opts){
					return when(this.model.query(query,opts), function(response){
						if (response && response.results) {
							response.results = response.results.map(function(res){
								delete res.resetCode;
								delete res.email
								delete res.password;
								return res;	
							});
						}
	
						console.log('response: ', response);
						return response
					});
				},

				notify: function(event,message,subject,opts){
					var req = opts.req || {};
					if (req.user && req.user.id) {
						console.log("Mail To: ", req.user.id);
						return when(this.model.mail(req.user.id.replace("@patricbrc.org",""),message, "[PATRIC-" + event + "] " + subject,opts), function(){
							return {results: "Notification Sent"}
						});
					}else{
						opts.res.status(403);
						throw Error("Forbidden");
					}
				}
			})
			break;	
		default: 
			publicFacet = new RestrictiveFacet({});
			userFacet = new RestrictiveFacet({});
			break;
	}
	dataModel.set(modelId,model,{public:publicFacet, user:userFacet ,admin:new PermissiveFacet({model:model})});	
});

module.exports = dataModel;


