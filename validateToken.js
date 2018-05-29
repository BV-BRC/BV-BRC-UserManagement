// var userIdRegex = /un=(\w+\@\w+(\.\w+))/
var path = require('path')
var crypto = require('crypto')
var request = require('request')
var Defer = require('promised-io/promise').defer
var when = require('promised-io/promise').when
var config = require('./config')
var fs = require('fs')
var ssCache = {}

var mySigningSubject = config.get('signingSubjectURL')

var getSigner = function (signer) {
  var def = new Defer()

  if (signer !== mySigningSubject) {
    console.log('Error: Signing Subject of Token is not My Signing Subject: ', signer, mySigningSubject)
    def.reject(new Error('Invalid Signing Subject'))
    return def.promise
  }

  console.log('getSigner: ', signer)

  if (ssCache[signer]) {
    def.resolve(ssCache[signer])
    return def.promise
  }

  request.get({url: signer, json: true}, function (err, response, body) {
    if (err) { return def.reject(err) }
    if (!body) { return def.reject('Empty Signature') }
    // console.log("body: ", body);
    // console.log("Signature: ", body.pubkey);
    ssCache[signer] = body.pubkey
    def.resolve(body.pubkey)
  })
  return def.promise
}

var validateToken = function (token) {
  var parts = token.split('|')
  var parsedToken = {}
  var baseToken = []
  parts.forEach(function (part) {
    var tuple = part.split('=')
    if (tuple[0] !== 'sig') {
      baseToken.push(part)
    }
    parsedToken[tuple[0]] = tuple[1]
  })

  return when(getSigner(parsedToken.SigningSubject), function (signer) {
    // console.log("Got Signer Cert: ", signer);
    var verifier = crypto.createVerify('RSA-SHA1')
    verifier.update(baseToken.join('|'))
    var success = verifier.verify(signer, parsedToken.sig, 'hex')

    return success
  }, function (err) {
    return false
  })
}

function decodeToken (token) {
  var parts = token.split('|')
  var parsedToken = {}
  parts.forEach(function (part) {
    var tuple = part.split('=')

    switch (tuple[0]) {
      case 'expiry':
        tuple[1] = new Date(tuple[1] * 1000)
        parsedToken[tuple[0]] = tuple[1]
        break
      default:
        parsedToken[tuple[0]] = tuple[1]
    }
  })
  return parsedToken
}

module.exports = function (token) {
  return when(validateToken(token), function (valid) {
    if (!valid) {
      console.log('Invalid Token')
      return false
    }

    var parsed = decodeToken(token)

    if (!parsed.expiry || (parsed.expiry && (parsed.expiry.valueOf() < new Date().valueOf()))) {
      return false
    }

    // console.log("parsedToken: ", parsed);

    var user = {
      id: parsed.un.replace('@' + config.get('realm'), ''),
      roles: parsed.roles || [],
      scope: parsed.scope
    }
    /*
      var matches = token.match(userIdRegex);
      if (matches && matches[1]) {
        user.id =  matches[1];
      }
    */
    console.log('User from Token: ', user)
    if (user && user.id) {
      return user
    }
    return false
  }, function (err) {
    return err
  })
}
