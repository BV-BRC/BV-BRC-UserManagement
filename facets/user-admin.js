var config = require("../config");
var when = require('promised-io/promise').when;
var errors = require("dactic/errors");
var RestrictiveFacet = require("dactic/facet/restrictive");
var Result=require("dactic/result");

module.exports = function(model, opts){
        return new RestrictiveFacet({
                model: model,
		get: function(id, opts) {
			return when(this.model.get(id,opts), function(response){
				console.log("Facet returning response: ", response);
				console.log("opts.req.user.id:", opts.req.user.id);
				var user = response.getData();
				delete user.resetCode;
				delete user.password
				return  new Result(user);
			}, function(err){
				return new errors.NotFound(err);
			});
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
	
		query: function(query,opts){
			return when(this.model.query(query,opts), function(response){
				var users = response.getData();
				if (users && users.length>0){
					users = users.map(function(user){
						delete user.resetCode;
						delete user.password;
						return user;
					});
				}else{
					users = [];
				}

				return new Result(users,response.getMetadata());
			});
		},

                setPassword: function(id,currentPW,password,opts){
                        if (!opts || !opts.req || !opts.req.user || !opts.req.user.id){
                                throw new errors.Unathorized();
                        }

                        if (!id || (id != opts.req.user.id)){
                                throw new errors.Unauthorized();
                        }

                        if (!currentPW){
                                throw new errors.NotAcceptable("Must Include current password");
                        }

                        if (!password){
                                throw new errors.NotValid("Invalid Password");
                        }

			var _self=this;
                        return when(this.model.validatePassword(id,currentPW), function(vres){
                                var valid = vres.getData();
                                if (valid){
                                        return when(_self.model.setPassword(id,password,opts), function(R){
                                                return R
                                        }, function(err){
                                                return err;
                                        })
                                }else{
                                        throw new errors.Unauthorized("Invalid Curent Password");
                                }
                        });
                }
        });
}





