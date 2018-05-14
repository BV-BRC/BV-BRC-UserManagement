var validateToken = require('../validateToken')
// var DataModel = require('../dataModel')
var when = require('promised-io/promise').when
// var UserModel = DataModel.get('user')
var config = require('../config')

var realm = config.get('realm')

module.exports = function (req, res, next) {
  if (req.headers && req.headers['authorization']) {
    when(validateToken(req.headers['authorization']), function (valid) {
      if (valid) {
        req.user = valid
        if (req.user.id) {
          req.user.id = req.user.id.replace('@' + realm, '')
        }
        // console.log("Valid Login: ", valid);
        if (req.user && req.user.roles && (req.user.roles.indexOf('admin') >= 0)) {
          req.apiPrivilegeFacet = 'admin'
        } else {
          req.apiPrivilegeFacet = 'user'
        }
        console.log('req.user: ', req.user)
        next()
      } else {
        // console.log("Token Failed Validation");
        next(new Error('Token Failed Validation'))
      }
    }, function (err) {
      // console.log("Token Failed Validation: ", err);
      next(err)
    })
  } else {
    req.apiPrivilegeFacet = 'public'
    next()
  }
}
