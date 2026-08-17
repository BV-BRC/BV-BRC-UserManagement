// var userIdRegex = /un=([\w\-.@]+@\w+(\.\w+))/
var userIdRegex = /un=([\w\-.@]+@\w+[\.\w]+)/
var crypto = require('crypto')
var http = require('http')
var https = require('https')
var Defer = require('promised-io/promise').defer
var when = require('promised-io/promise').when
var withUserAgent = require('./userAgent').withUserAgent

var ssCache = {}

// Cap the signer response: the URL is validated against config before we fetch
// it, but a compromised or misbehaving signer should not be able to stream an
// unbounded body into memory.
var MAX_SIGNER_BODY = 64 * 1024
var SIGNER_TIMEOUT_MS = 15000

/**
 * Fetch the signing key from the signer URL.
 *
 * Uses node's built-in http/https rather than the `request` package, which is
 * deprecated, unmaintained, and the source of this module's only outstanding
 * npm audit advisories (SSRF in request itself, plus form-data, qs and
 * tough-cookie in its dependency tree).
 *
 * @param {String} signer - the SigningSubject URL; already checked by the
 *   caller to equal the configured signingSubjectURL
 * @return {Promise} resolves to the PEM public key
 */
var getSigner = function (signer) {
  var def = new Defer()
  if (ssCache[signer]) {
    def.resolve(ssCache[signer])
    return def.promise
  }

  // WHATWG URL rather than the legacy url.parse(), which node deprecates
  // specifically for its security implications.
  var parsed
  try {
    parsed = new URL(signer)
  } catch (e) {
    def.reject('Malformed SigningSubject URL: ' + signer)
    return def.promise
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    def.reject('Unsupported SigningSubject protocol: ' + parsed.protocol)
    return def.promise
  }

  var transport = parsed.protocol === 'https:' ? https : http
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    // The User-Agent is required: Cloudflare answers UA-less clients with a 403
    // challenge page, which would make the body HTML rather than JSON. See
    // userAgent.js.
    headers: withUserAgent({ Accept: 'application/json' })
  }

  var req = transport.get(opts, function (res) {
    var body = ''
    var aborted = false
    res.setEncoding('utf8')
    res.on('data', function (chunk) {
      if (aborted) { return }
      body += chunk
      if (body.length > MAX_SIGNER_BODY) {
        aborted = true
        req.destroy()
        def.reject('Signer response exceeded ' + MAX_SIGNER_BODY + ' bytes')
      }
    })
    res.on('end', function () {
      if (aborted) { return }
      if (res.statusCode !== 200) {
        return def.reject('Signer returned HTTP ' + res.statusCode + ': ' +
          body.slice(0, 80))
      }
      if (!body) { return def.reject('Empty Signature') }

      var parsedBody
      try {
        parsedBody = JSON.parse(body)
      } catch (e) {
        // A challenge or error page. Without this the failure surfaces later as
        // a generic "invalid token" with no clue that the key fetch is what
        // broke.
        return def.reject('Signer did not return JSON (blocked or challenged?): ' +
          body.slice(0, 80))
      }

      if (!parsedBody || !parsedBody.pubkey) {
        return def.reject('Signer response has no pubkey: ' + body.slice(0, 80))
      }

      ssCache[signer] = parsedBody.pubkey
      def.resolve(parsedBody.pubkey)
    })
  })

  req.setTimeout(SIGNER_TIMEOUT_MS, function () {
    req.destroy()
    def.reject('Signer request timed out after ' + SIGNER_TIMEOUT_MS + 'ms')
  })

  req.on('error', function (err) {
    def.reject(err)
  })

  return def.promise
}

var validateToken = function (token, signingSubject) {
  var parts = token.split('|')
  var parsedToken = {}
  var baseToken = []
  parts.forEach(function (part) {
    var idx = part.indexOf('=')
    if (idx < 0) { return }
    var key = part.slice(0, idx)
    if (key !== 'sig') {
      baseToken.push(part)
    }
    // slice rather than split('=')[1]: the SigningSubject value is a URL and
    // contains '=' whenever it carries a query string.
    parsedToken[key] = part.slice(idx + 1)
  })

  // This check must REJECT, not just report. It previously built an Error
  // without throwing it and referenced an undefined `signingSubjectURL`; the
  // resulting ReferenceError is what actually stopped the request, which was
  // fail-closed only by accident. Correcting the variable name alone would
  // have removed that accident and let a token name its own signer -- an
  // attacker could then publish their own keypair, sign a token as any user
  // including an admin, and have this service fetch that key and verify
  // against it. Verified reproducible against the pre-fix logic.
  if (parsedToken.SigningSubject !== signingSubject) {
    var def = new Defer()
    console.log('Rejecting token: SigningSubject ', parsedToken.SigningSubject,
      ' does not match configured ', signingSubject)
    def.resolve(false)
    return def.promise
  }

  return when(getSigner(parsedToken.SigningSubject), function (signer) {
    var verifier = crypto.createVerify('RSA-SHA1')
    verifier.update(baseToken.join('|'))
    return verifier.verify(signer.toString('ascii'), parsedToken.sig, 'hex')
  }, function (err) {
    // Log the reason, not just the URL: a key-fetch failure rejects every token
    // and otherwise looks identical to a genuinely bad signature.
    console.log('Error retrieving SigningSubject: ', parsedToken.SigningSubject, err)
    return false
  })
}

module.exports = function (token, signingSubject) {
  return when(validateToken(token, signingSubject), function (valid) {
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
  }, function (err) {
    // Any failure reaching here means the token could not be proven valid, so
    // it is refused. Log it: this is the last place the reason exists.
    console.log('Token validation failed: ', err)
    return false
  })
}
