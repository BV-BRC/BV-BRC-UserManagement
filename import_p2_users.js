#!/usr/bin/env node

var conf = require("./config");
var readline = require('readline');
var fs = require('fs');
var Store = require("dme/store/mongodb");

if (!conf.get("import")){
	throw new Error('Missing file to import (--import <FILE>)');
}


var User = new Store("user",{url: conf.get("mongo").url});
User.init();
setTimeout(function(){
var readline = require('readline');
var firstRow = true;
var rl = readline.createInterface({
      input : fs.createReadStream(conf.get('import')),
      output: process.stdout,
      terminal: false
})
rl.on('line',function(line){
   if (firstRow) { firstRow=false; return; }
  
    var parts = line.split("\t");
    var user = {
	id: parts[0],
	first_name: parts[1],
	last_name: parts[2],
	email: parts[3],
	affiliation: parts[4],
	organisms: parts[5],
	interests: parts[6],
	creationDate: new Date();
	updateDate: new Date();
    } 
  //  console.log("User: ", JSON.stringify(user));
    User.put(user,{overwrite: true}).then(function(u){
         console.log("Stored User: ", u.id);
    },function(err){
         console.log("Error importing user: ", user.id, err);
    });
})
},2000);
