var config = require('./config')
var uuid = require('node-uuid')
var crypto = require('crypto')
var moment = require('moment')

module.exports = function generateBearerToken (user, scope) {
  scope = scope || 'user'

  var duration = config.get(scope + 'TokenDuration')

  if (!duration) {
    throw Error('No Token Duration defined for this scope: ' + scope)
  }

  var name = user.username || user.id
  var tokenid = uuid.v4().toString()
  var exp = moment()
  exp.add(duration, 'hours')
  var expiration = Math.floor(exp.valueOf() / 1000)
  var realm = config.get('realm')

  var payload = [
    'un=' + name + '@' + realm, 'tokenid=' + tokenid,
    'expiry=' + expiration, 'client_id=' + name + '@' + realm,
    'token_type=' + 'Bearer', 'realm=' + realm, 'scope=' + scope
  ]

  if (user.roles && user.roles.length > 0) {
    payload.push('roles=' + (user.roles || []).join(','))
  }
  payload.push('SigningSubject=' + config.get('signingSubjectURL'))

  var key = SigningPEM.toString('ascii')
  var sign = crypto.createSign('RSA-SHA1')
  sign.update(payload.join('|'))
  var signature = sign.sign(key, 'hex')
  var token = payload.join('|') + '|sig=' + signature
  console.log('New Bearer Token: ', token)
  return token
}
