var ModelBase = require("dactic/model");
var config = require("../config");
var errors = require("dactic/errors");
var util = require("util");

var Model = module.exports = function(store,opts){
	ModelBase.apply(this,arguments);
}

util.inherits(Model, ModelBase);
