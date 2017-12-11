var config = require("../config");
var when = require('promised-io/promise').when;
var errors = require("dactic/errors");
var RestrictiveFacet = require("dactic/facet/restrictive");

module.exports = function(model, opts){
        return new RestrictiveFacet({
                model: model,
		get: function(id, opts) {
			return when(this.model.get(id,opts), function(response){
				console.log("Facet returning response: ", response);
				console.log("opts.req.user.id:", opts.req.user.id);
				var user = response.getData();
				if (opts.req.user && opts.req.user.id && (opts.req.user.id==user.id)){
					delete response.resetCode;
					delete response.email;
					delete response.password
					return response;
				}
			});
			//return this.model.get(id,opts);
		},

		patch: function(id,patch,opts) {
			console.log("facet patch", id, patch);
			var _self=this;
			return when(this.model.get(id,opts), function(response){
				console.log("opts.req.user.id:", opts.req.user.id);
				var user = response.getData();
				if (opts.req.user && opts.req.user.id && (opts.req.user.id==user.id)){
					return when(_self.model.patch(user.id,patch,opts), function(){
						return true;
					}, function(err){
						return new errors.InvalidRequest(err);
					});
				}else{
					throw new errors.Unauthorized();
				}
			});
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
/*
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
*/

        });
}





