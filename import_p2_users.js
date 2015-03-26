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
    console.log("parts.length: ", parts.length);
//JBP_UID	JBP_UNAME	JBP_GIVENNAME	JBP_FAMILYNAME	JBP_REALEMAIL	AFFILIATION	ORGANISMS	INTERESTS	MAILINGLIST	JBP_PASSWORD
    var user = {
	id: parts[1],
	first_name: parts[2],
	last_name: parts[3],
	email: parts[4],
	affiliation: parts[5]?(parts[5].replace("/r","/r/n")):"",
	organisms: parts[6]?(parts[6].replace("/r","/r/n")):"",
	interests: parts[7]?(parts[7].replace("/r","/r/n")):"",
	creationDate: new Date(),
	updateDate: new Date(),
	mailingList: (parts[8]=="N")?false:true,
	password: parts[9]
    } 
   console.log("User: ", JSON.stringify(user));

    User.put(user,{overwrite: true}).then(function(u){
         console.log("Stored User: ", u.id);
    },function(err){
         console.log("Error importing user: ", user.id, err);
    });

})

rl.on('end', function(){
	process.exit();
});
},2000);
