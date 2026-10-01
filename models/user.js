var When = require('promised-io/promise').when
var Defer = require('promised-io/promise').defer
var config = require('../config')
var email = require('nodemailer')
var bcrypt = require('bcrypt')
var crypto = require("crypto");
var randomstring = require('randomstring')
var ModelBase = require('./base')
var errors = require('dactic/errors')
var util = require('util')
var Result = require('dactic/result')
var utils = require('../utils')
var log = require('../log')

function resetMessage (resetCode, email) {
  // console.log('Generate Reset Message')
  var siteUrl = config.get('siteURL')
  // console.log('Reset Code: ', resetCode)
  var msg = 'Click the following link or paste into your browser to Reset Your Password \n\n\t' + siteUrl + '/reset/' + encodeURIComponent(email) + '/' + resetCode
  log.log('Reset URL: '+ siteUrl + '/reset/' + encodeURIComponent(email) + '/' + resetCode)
  return msg
}

function validateMessage (verificationCode, email) {
  // console.log('Generate Reset Message')
  var siteUrl = config.get('siteURL')
  // console.log('Reset Code: ', resetCode)
  var msg = 'Click the following link or paste into your browser to verify your email address. \n\n\t' + siteUrl + '/verify/' + encodeURIComponent(email) + '/' + verificationCode
  log.log('Verification URL: '+ siteUrl + '/verify/' + encodeURIComponent(email) + '/' + verificationCode)
  return msg
}

var Model = module.exports = function (store, opts) {
	this.salt=config.get("sha_salt")
	if (!this.salt){
		throw Error("Missing sha_salt in config file");
	}
  ModelBase.apply(this, arguments)
}

util.inherits(Model, ModelBase)

Model.prototype.primaryKey = 'id'
Model.prototype.maxLimit = 999999
Model.prototype.defaultLimit = 25
Model.prototype.schema = {
  'description': 'User Schema',
  'properties': {
    id: {
      type: 'string',
      description: 'Id of User'
    },
    l_id: {
      "type": "string",
      "description": "lower case id"
    },
    first_name: {
      type: 'string',
      description: ''
    },
    last_name: {
      type: 'string',
      description: ''
    },


    affiliation: {
      type: 'string',
      description: ''
    },
    organisms: {
      type: 'string',
      description: ''
    },

    interests: {
      type: 'string',
      description: ''
    },

    creationDate: {
      type: 'string',
      description: ''
    },
    updateDate: {
      type: 'string',
      description: ''
    },
    lastLogin: {
      type: 'string',
      description: ''
    },
    createdBy: {
      type: 'string',
      description: ''
    },
    updatedBy: {
      type: 'string',
      description: ''
    },

    /*
     * Which frontend property the account was registered from. Absent on
     * every record created before this field existed, and that absence is
     * truthful -- there is no backfill.
     *
     * NO `enum` here, deliberately. Model.patch does get -> apply -> put, and
     * put runs AJV over the entire document (dactic/model.js:233-257), so a
     * record holding a value later dropped from the enum would fail
     * validation on every subsequent write: no password reset, no email
     * verification, no profile edit. Retiring a site would silently brick
     * those accounts. The allowed set lives in config and is enforced at
     * registration, where a bad value is rejected before it is ever stored
     * and can never poison an existing record.
     */
    registration_site: {
      type: 'string',
      description: 'Slug of the frontend property this account was registered from'
    },
    registration_site_url: {
      type: 'string',
      description: 'Normalized origin the registration request declared, retained so slugs can be re-derived'
    },

    roles: {
      type: 'array',
      description: '',
      items: {
        type: 'string'
      },
      "default": []
    }
  },
  required: ['id','email', 'first_name', 'last_name',"l_id","roles"]
}

Model.prototype.registerUser = function (user) {
  var _self = this
  // console.log("registerUser this: ");
  var siteUrl = config.get('siteURL')
  // var newUser = user // {name: user.name, email: user.email}

  var newUser = {}
  /*
   * registration_site_url is copied; registration_site is NOT. The slug is
   * derived below from the URL, so a caller that sends its own
   * registration_site is ignored rather than trusted -- otherwise anyone
   * could self-attribute to any property.
   */
  const cpProps=["email","first_name","last_name","affiliation","middle_name","organisms","interests","registration_site_url"]
  cpProps.forEach((prop)=>{
    newUser[prop]=user[prop]
  })

  /*
   * Resolve provenance here rather than in post(): post() is the generic
   * create path (admin user creation, imports), while registration is the
   * one place a frontend declares where it is. An absent parameter means an
   * old client, not an assertion about origin, so it gets the default slug
   * and no stored URL.
   */
  var declaredSiteUrl = user.registration_site_url
  if (declaredSiteUrl === undefined || declaredSiteUrl === null || declaredSiteUrl === '') {
    newUser.registration_site = config.get('default_registration_site')
    /*
     * delete, not leave-as-undefined. The cpProps loop above copies every
     * listed key unconditionally, so an omitted parameter is sitting there
     * as `undefined` right now -- and BSON serializes undefined to NULL,
     * which the schema's type:'string' then rejects on the *next* write to
     * this record. That is the live registration defect documented in
     * CLAUDE.md, and it is only invisible in plain JS. Verified against
     * mongod 3.4.24: with the delete the key is genuinely absent from the
     * stored document, and subsequent writes succeed.
     */
    delete newUser.registration_site_url
  } else {
    var origin = utils.normalizeSiteUrl(declaredSiteUrl)
    if (!origin) {
      /*
       * Only *malformed* is an error. No real frontend can produce one, and
       * silently storing garbage would make the field untrustworthy.
       *
       * Rejected, not thrown: registerUser's contract is a promise
       * (routes/register.js:28 chains .then), and a synchronous throw here
       * would escape the caller's error handler entirely -- it happens before
       * the When() below is ever entered.
       */
      var badUrl = Defer()
      badUrl.reject(new errors.BadRequest('Invalid registration site URL'))
      return badUrl.promise
    }
    newUser.registration_site = utils.resolveSiteSlug(origin, config.get('registration_site_map'))
    newUser.registration_site_url = origin
  }


  var username = user.username
  delete user.username
  var pw = user.password
  delete user.password

  var q = ['or(eq(id,', encodeURIComponent(username), '),eq(email,', encodeURIComponent(user.email.toLowerCase()), '))&limit(1)'].join('')

  return When(this.query(q), function (res) {
    var results = res.getData()
    if (results && results.length > 0) {
      var msg
      if (results[0].email === user.email) {
        msg = 'User with the provided email address already exists.'
      } else {
        msg = 'The requested username is already in use.'
      }
      var err = new errors.Conflict(msg)
      throw err
    } else {
      // console.log("post newUser: ", newUser)
      return When(_self.post(newUser, {id: username}), function (u) {
        // console.log('User Registered, Resetting Account: ', newUser.id)
        if (!pw){
          return When(_self.resetAccount(newUser.id, {mail_user: false}), function (resetResults) {
            var resetUser = resetResults.getData()
            // console.log("Mail User")
            return When(_self.mail(newUser.id, 'Click the following link or paste into your browser to Complete Registration\n\n\t ' + siteUrl + '/reset/' + encodeURIComponent(newUser.email) + '/' + resetUser.resetCode, 'BVBRC Registration', {}), function () {
              log.log('Registration Complete URL : '+ siteUrl + '/reset/' + encodeURIComponent(newUser.email) + '/' + resetUser.resetCode)
              /*
               * Must be a Result, not the bare resetUser object: this is what
               * registerUser() resolves to, and routes/register.js:30 calls
               * .getData() on it unconditionally. Returning resetUser directly
               * crashed every no-password registration with "registerResp.getData
               * is not a function" -- confirmed on unmodified master too, so this
               * predates the registration_site work.
               */
              return new Result(resetUser)
            }, function(err){
              log.log("Error Sending mail during registration: ", err, "Delete new account")
              return _self.delete(username).then(()=>{
                throw new Error("There was an error sending you notification of account creation.  Please try creating your account again.")
              }) 
            })
          })
        }else{
          return When(_self.setPassword(newUser.id,pw),function(setPWResults){
              return When(_self.sendVerificationEmail(newUser.id),function(resetResults){
                var resetUser = resetResults.getData();
                return new Result(resetUser)
              })
          }, function(err){
            return _self.delete(username).then(()=>{
              throw new Error("Password Set Error: " + err)
            }) 
          })
        }
      })
    }
  })
}

Model.prototype.get = function (id, opts) {
  // console.log("GET(",id,")");
  if (!id){
    throw new Error("Missing ID")
  }
  return When(this.query('or(eq(id,' + encodeURIComponent(id) + '),eq(email,' + encodeURIComponent(id.toLowerCase()) + '))&limit(1)'), function (res) {
    // console.log("get user res: ", res)
    var user = res.getData()[0]
    if (user) {
      return new Result(user)
    } else {
      throw new errors.NotFound('User Not Found')
    }
  })
}

Model.prototype.mail = function (userId, message, subject, options) {
  if (!message) { throw Error('Message is required for mail()') }
  var u
  if (typeof userId === 'object') {
    u = userId
  } else {
    u = this.get(userId)
  }
  // var _self = this
  return When(u, function (gres) {
    var user = gres.getData()
    // console.log("user: ", user);
    // console.log('Sending mail to : ', user.email)
    var mailconf = config.get('email')
    var transport

    if (mailconf.localSendmail) {
      // nodemailer >= 2 dropped the no-argument createTransport() that meant
      // "pipe to the local sendmail"; it must be requested explicitly now.
      transport = email.createTransport({ sendmail: true })
    } else {
      // The old `email.SMTP = {...}` assignment here was nodemailer 0.x API and
      // had no effect on any version this service has shipped with -- the
      // transport below is what actually carried the host/port/auth. It also
      // threw a TypeError whenever localSendmail was set together with a
      // username, since email.SMTP was then never assigned.
      var transportOpts = {
        host: mailconf.host || 'localhost',
        port: mailconf.port || 25,
        debug: true
      }
      if (mailconf.username) {
        transportOpts.auth = {
          user: mailconf.username,
          pass: mailconf.password
        }
      }
      // nodemailer >= 2 accepts the SMTP options object directly, so the
      // separate nodemailer-smtp-transport shim is no longer needed.
      transport = email.createTransport(transportOpts)
    }

    var mailmsg = {
      debug: true,
      to: user.email,
      sender: mailconf.defaultFrom, // "responder@hapticscience.com", // mailconf.defaultFrom,
      from: mailconf.defaultFrom,
      subject: subject || 'No Subject',
      text: message
    }

    // console.log('Sending Email: ', mailmsg)

    var deferred = new Defer()

    transport.sendMail(mailmsg, function (err, result) {
      // console.log('sendMail result: ', err, result)
      if (deferred.fired) { return }
      if (err) {
        deferred.reject(err)
        return
      }

      deferred.resolve(result)
    })

    return deferred.promise
  })
}

Model.prototype.resetAccount = function (id, opts) {
  // console.log("Reset Account")
  var _self = this
  opts = opts || {}
  // console.log('Reset Account: ', id)
  var patch = [{ 'op': 'add', 'path': '/resetCode', 'value': randomstring.generate(5).toUpperCase() }]
  // console.log("Patches: ", patch)
  return When(_self.patch(id, patch), function () {
    // console.log("Reset Account Patch Completed");
    return When(_self.get(id), function (ruser) {
      // console.log("REGET User: ", ruser);
      var user = ruser.getData()
      if (!user) {
        throw new errors.NotFound(id + ' Not Found')
      }
     // console.log("POST PATCH USER: ", user);
      var msg = resetMessage(user.resetCode, user.email)
      if (opts.mail_user) {
        // console.log('Mail User Reset Link')
        return When(_self.mail(user.id, msg, 'Password Reset'), function () {
          _self.emit('message', {action: 'update', item: user})
          return new Result(user)
        }, function(err){
          log.log("Error sending email : ", err)
          return new Result(user)          
        })
      } else {
        // console.log("mail user false")
        return new Result(user)
      }
    }, function (err) {
      log.log("resetUser patch err: ",err)
      return err
    })
  })
}

Model.prototype.verifyEmail = function (id, opts) {
  var _self = this
  opts = opts || {}

  var patch = [
    {'op': 'add', 'path': '/verification_code', "value": ""},
    {"op": "add", "path": "/email_verified", "value": true},
    {"op": "add", "path": "/verification_date", "value": new Date().toISOString()},
    {"op": "add", "path": "/verification_error", "value": false},
    {"op": "add", "path": "/reverification", "value": false},
    { 'op': 'add', 'path': "/verification_send_date", 'value': ""}
  ]
  return When(_self.patch(id,patch), function(){
    return true
  });
}

Model.prototype.sendVerificationEmail = function (id, opts) {
  // console.log("Reset Account")
  var _self = this
  opts = opts || {}
  // console.log('Reset Account: ', id)
  var patch = [
    { 'op': 'add', 'path': '/verification_code', 'value': randomstring.generate(5).toUpperCase() },
    { 'op': 'add', 'path': '/email_verified', 'value': false},
    { 'op': 'add', 'path': "/verification_send_date", 'value': new Date().toISOString()},
    { "op": "add", "path": "/verification_date", "value": ""},
    { "op": "add", "path": "/verification_error", "value": ""},
    { "op": "add", "path": "/reverification", "value": opts.reverification?true:false}
  ]

  // console.log("Patches: ", patch)

  return When(_self.patch(id, patch), function () {
    // console.log("Reset Account Patch Completed");
    return When(_self.get(id), function (ruser) {
      // console.log("REGET User: ", ruser);
      var user = ruser.getData()
      if (!user) {
        throw new errors.NotFound(id + ' Not Found')
      }

     // console.log("POST PATCH USER: ", user);

      var msg = validateMessage(user.verification_code,user.email)
      // console.log("msg: ", msg)

      // console.log('Mail User Reset Link')
      return When(_self.mail(user.id, msg, "Email Verification"), function () {
        _self.emit('message', {action: 'update', item: user})
        return new Result(user)
      }, function(err){
        log.log("Error sending email : ", err)
        return _self.patch(id, [{'op': 'add','path': "/verification_error",'value': err}]).then(function () {
          user.verificaton_error=err
          log.log("rethrow error")
          throw err
        })
      })

    })
  })
}

Model.prototype._validateBcrypt=function(password,encrypted,id,opts){
	var def = new Defer()
	bcrypt.compare(password, encrypted, function (err, response) {
		if (err) { return def.resolve(false) }
		if (response) { return def.resolve(true); }
  	def.resolve(false)
	})
	return def.promise
}

Model.prototype._validateSHA=function(password,encrypted,algo,iterations,id,opts){
	var def = new Defer()
	var content = `${password}{${this.salt}}`	
	// console.log("content: ", content);
	var hash = crypto.createHash(algo).update(content).digest('hex')
	for (i=1;i<iterations;i++){
		hash = crypto.createHash(algo).update(hash).digest('hex')
	}

	if (hash===encrypted){
		log.log("Re-encode sha1 password as bcrypt for user id: ", id);
		When(this.setPassword(id,password), function(){
			def.resolve(true);
		});
	}else{
		def.resolve(false);
	}
	return def.promise;
}

Model.prototype.validatePassword = function (id, password, opts) {
  // console.log("validate password: ", id)
	var _self=this;
	opts=opts||{}
  return When(this.get(id), function (ruser) {
    var user = ruser.getData()
    // console.log("user: ", user)
    var def = new Defer()
		var vdef;

		if (user.password.match(/\$2[ab]/)){
			vdef = _self._validateBcrypt(password,user.password,id,opts)
		}else{
			vdef = _self._validateSHA(password,user.password,"sha1",1,id,opts)
		}

		When(vdef, function(success){
			if (success) {
				return def.resolve(new Result(user))
			}
			def.resolve(new Result(false))
		}, function(err){
			def.resolve(new Result(false));
		});
    return def.promise
  })
}

Model.prototype.setPassword = function (id, password, opts) {
  var _self = this
  opts = opts || {}
  if (!password) { throw Error('Password Required') }
  if (!id) { throw Error('User ID Required') }

  var def = new Defer()
  // console.log('Set Password for ', id)
  bcrypt.hash(password, 10, function (err, pw) {
    var patch = [
      { 'op': 'add', 'path': '/password', 'value': pw },
      { 'op': 'replace', 'path': '/updatedBy', 'value': 'system' },
      { 'op': 'add', 'path': '/resetCode', 'value': '' },
      { 'op': 'replace', 'path': '/updateDate', 'value': new Date().toISOString() }
    ]

    opts.overwrite = true
    When(_self.patch(id, patch, opts), function (res) {
      log.log('User ' + id + ' changed password.')
      def.resolve(new Result('Password Changed'))
    }, function (err) {
      log.log('Errr Posting Updated Password to db: ', err)
      def.reject(err)
    })
  })
  return def.promise
}

Model.prototype.patch = function(id,patch,opts){
  var emailChanged=false
  var _self=this
  emailChanged = patch.some(function(p){
    return p.path === "/email"
  })

  return When(this.constructor.super_.prototype.patch.call(this,id,patch,opts), function(results){
    if (!emailChanged){
      return results
    }
    return When(_self.sendVerificationEmail(id),function(resetResults){
      return results
    })
  }, function(err){
    if (err.message.match(/^E11000*/)){
      throw errors.Conflict("An account with that email address already exists.")
    }else{
      throw errors.BadRequest(err)
    }
  })

}

Model.prototype.post = function (obj, opts) {
  var _self = this
  opts = opts || {}
  obj.id = opts.id
  obj.l_id = obj.id.toLowerCase()
  obj.email = obj.email.toLowerCase()
  opts.overwrite = false
  var now = new Date().toISOString()
  obj.creationDate = now
  obj.updateDate = now
  obj.createdBy = (opts && opts.req && opts.req.user) ? opts.req.user.id : 'system'
  obj.updatedBy = obj.createdBy
  obj.source = config.get("default_source")
  var out = _self.mixinObject({}, obj)
  // console.log("New User: ", out)
  return When(_self.put(out, opts), function (res) {
    return new Result(out)
  }, function (err) {
    if (err.code===11000){
      throw new errors.Conflict("An account with this username or email address already exists.")
    }
    return err
  })
}

Model.prototype.put = function (obj, opts) {
  if (typeof obj.creationDate !== 'string') {
    obj.creationDate = obj.creationDate.toISOString()
  }
 
  obj.updateDate = new Date().toISOString()
  return ModelBase.prototype.put.apply(this, [obj, opts])
}
