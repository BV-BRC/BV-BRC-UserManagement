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
	
	var restrictiveUserFacet = new RestrictiveFacet({model: model,
		get: function(id, opts) {
			return this.model.get(id,opts);
		},
		query: function(query,opts){
			return when(this.model.query(query,opts), function(response){
				if (response && response.results) {
					response.results = response.results.map(function(res){
						delete res.email
						delete res.password;
						return res;	
					});
				}

				console.log('response: ', response);
				return response
			});
		}
	});

	dataModel.set(modelId,model,{public:restrictiveUserFacet,user:restrictiveUserFacet,admin:new PermissiveFacet({model:model})});	
});

module.exports = dataModel;


