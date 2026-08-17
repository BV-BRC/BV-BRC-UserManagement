// var userIdRegex = /un=([\w\-.@]+@\w+(\.\w+))/
var userIdRegex = /un=([\w\-.@]+@\w+[\.\w]+)/
var crypto = require('crypto')
var request = require('request')
var Defer = require('promised-io/promise').defer
var when = require('promised-io/promise').when
var withUserAgent = require('./userAgent').withUserAgent

var ssCache = {}

var getSigner = function (signer) {
  var def = new Defer()
  if (ssCache[signer]) {
    def.resolve(ssCache[signer])
    return def.promise
  }
  // The User-Agent is required: Cloudflare answers UA-less clients with a 403
  // challenge page, which would make `body` an HTML string rather than JSON.
  // See userAgent.js.
  request.get({url: signer, json: true, headers: withUserAgent()}, function (err, response, body) {
    if (err) { return def.reject(err) }
    if (!body) { return def.reject('Empty Signature') }
    // Guard against a non-JSON response (a challenge/error page). Without this
    // the failure surfaces later as a generic "invalid token" with no clue that
    // the key fetch is what broke.
    if (typeof body !== 'object' || !body.pubkey) {
      return def.reject('Signer did not return JSON (blocked or challenged?): ' +
        String(body).slice(0, 80))
    }
    // console.log("body: ", body);
    // console.log("Signature: ", body.pubkey);
    ssCache[signer] = body.pubkey
    def.resolve(body.pubkey)
  })
  return def.promise
}

var validateToken = function (token,signingSubject) {
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

  if (parsedToken.SigningSubject!==signingSubject){
    new Error("Invalid Signing Subject: " + signingSubjectURL)
  }

  return when(getSigner(parsedToken.SigningSubject), function (signer) {
    // console.log("Got Signer Cert: ", signer);
    // console.log("Signature: ", parsedToken.sig);
    var verifier = crypto.createVerify('RSA-SHA1')
    // console.log("data: ", baseToken.join('|'));
    verifier.update(baseToken.join('|'))
    var success = verifier.verify(signer.toString('ascii'), parsedToken.sig, 'hex')
    // console.log("validation success: ", success);
    return success
  }, function (err) {
    // Log the reason, not just the URL: a key-fetch failure rejects every token
    // and otherwise looks identical to a genuinely bad signature.
    console.log('Error retrieving SigningSubject: ', parsedToken.SigningSubject, err)
    return false
  })
}

module.exports = function (token,signingSubject) {
  return when(validateToken(token,signingSubject), function (valid) {
    if (!valid) {
      console.log('Invalid Token')
      return false
    }

    var user = {}
    var matches = token.match(userIdRegex)
    if (matches && matches[1]) {
      user.id = matches[1]
    }

    // console.log('User from Token: ', user);
    if (user && user.id) {
      return user
    }
    return false
  },function(err){
    return false;
  })
}
