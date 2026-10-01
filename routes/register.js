const express = require('express')
const router = express.Router()
const bodyParser = require('body-parser')
const DataModel = require('../dataModel')
const when = require('promised-io/promise').when
const errors = require('dactic/errors')
const UserModel = DataModel.get('user')
var generateToken = require('../generateToken')
var utils = require('../utils')
var log = require('../log')
var audit = require('../audit')

/* Register a new user */
router.post('/', [
  bodyParser.urlencoded({extended: true}),
  bodyParser.json({type: 'application/json'}),
  function (req, res, next) {
    // check for missing fields
    /*
     * Boolean, never the password itself. This was previously
     * `req.body.password || false`, which put the plaintext password in
     * `hasPassword` -- and the log line below passed it straight to
     * console.log. Confirmed the password was reaching the log file
     * unredacted on every password-registration request.
     */
    var hasPassword = !!req.body.password
    if (!req.body || !req.body.username || !req.body.email || !req.body.first_name || !req.body.last_name) {
      return next(new errors.BadRequest('Missing required fields'))
    }
    // check for user id rule
    if (req.body.username.match(/[\w.-]+/)[0] !== req.body.username) {
      return next(new errors.BadRequest('Username contains unacceptable characters. Use letters, numbers, underscore(_), dot(.), and dash(-)'))
    }

    var ip = utils.clientIp(req)
    var declaredSiteUrl = req.body.registration_site_url || null
    /*
     * Captured before registerUser() runs, for the same reason ip and
     * declaredSiteUrl are: registerUser() mutates its argument object
     * (models/user.js deletes username/password off of it in place), so
     * req.body.username is gone by the time the error handler below runs for
     * every failure except the malformed-URL case, which returns earlier.
     * Without this, registration_failed silently lost the username on
     * conflicts, password-set failures and mail failures -- the cases that
     * matter most for abuse monitoring.
     */
    var username = req.body.username

    log.log('Registering New User: ', username, req.body.email, 'has password: ', hasPassword, 'ip: ', ip, 'declared site url: ', declaredSiteUrl || '(none)')
    audit.record('registration_attempt', {
      username: username,
      email: req.body.email,
      ip: ip,
      declared_registration_site_url: declaredSiteUrl
    })

    UserModel.registerUser(req.body).then((registerResp)=>{
      // console.log("registerResp: ", registerResp)
      var user = registerResp.getData()
      // console.log("user: ", user)
      // console.log('req.body: ', req.body)

      /*
       * Audit record: who registered, from where, and which site the
       * provenance fields resolved to -- registration_site is derived
       * server-side (models/user.js), so this is the first point the
       * resolved slug is known, not just what the caller declared.
       */
      audit.record('registration_complete', {
        id: user.id,
        email: user.email,
        ip: ip,
        registration_site: user.registration_site,
        registration_site_url: user.registration_site_url || null
      })

      if (hasPassword && user){
        // console.log("Generate token for registration with pass")
        var token = generateToken(user, 'user')
        // console.log("Token: ", token)
        var patch = {op: user.lastLogin?"replace":"add",path: "/lastLogin", value: new Date().toISOString()}
        return when(UserModel.patch(user.id, [patch]), function(pathRes){
          // console.log("Write token to output: ", token)
          res.status(200)
          res.send(token)
        })
      }else{
        res.status(201)
      }
      res.end()
    },(err)=>{
      audit.record('registration_failed', {
        username: username,
        email: req.body.email,
        ip: ip,
        error: err && err.message
      })
      next(err)
    })
  }
])

module.exports = router
