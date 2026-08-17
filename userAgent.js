/**
 * User-Agent for outbound HTTP requests.
 *
 * Every request this module makes to another host must identify itself.
 * Cloudflare fronts the BV-BRC hosts and answers clients whose User-Agent it
 * does not recognize with a 403 challenge page. The `request` library sends no
 * User-Agent at all, so the signing-key fetch in validateToken.js received an
 * HTML challenge instead of JSON, getSigner rejected, and *every* token was
 * refused -- authenticated requests silently degraded to anonymous with no
 * error logged anywhere.
 *
 * The `bvbrc-<component>/<version>` form is allowlisted in the BV-BRC
 * Cloudflare rules. Keep that prefix; an arbitrary UA may be challenged.
 * (Measured: bare `Mozilla/5.0` is blocked.)
 *
 * Version resolution, in order:
 *   1. BVBRC_USER_VERSION env var
 *   2. package.json version
 *
 * Note this module is consumed both as a standalone service and as an npm
 * dependency of p3_api, so it deliberately does not shell out to `git
 * describe` the way p3_api's lib/userAgent.js does -- inside node_modules that
 * would report the *host* repository's version, not this one.
 *
 * Resolved once at module load.
 */

var COMPONENT = 'bvbrc-user'

/**
 * Strip anything that cannot appear in a User-Agent token.
 *
 * RFC 9110 product-version is a `token`; whitespace and separators would split
 * the header or invalidate it. Also guards against header injection, since the
 * value reaches a remote host.
 *
 * @param {String} value
 * @return {String}
 */
function sanitizeVersion (value) {
  return String(value).replace(/[^A-Za-z0-9._+-]/g, '-')
}

/**
 * Resolve the version string.
 *
 * @return {String}
 */
function resolveVersion () {
  var fromEnv = process.env.BVBRC_USER_VERSION
  if (fromEnv && fromEnv.trim()) {
    return sanitizeVersion(fromEnv.trim())
  }

  try {
    return sanitizeVersion(require('./package.json').version || 'unknown')
  } catch (err) {
    // Never let versioning break startup.
    return 'unknown'
  }
}

var VERSION = resolveVersion()
var USER_AGENT = COMPONENT + '/' + VERSION

/**
 * The User-Agent string for outbound requests.
 *
 * @return {String} e.g. 'bvbrc-user/2.0.1'
 */
function userAgent () {
  return USER_AGENT
}

/**
 * Merge the User-Agent into an existing headers object without clobbering an
 * explicit caller-supplied one.
 *
 * @param {Object} [headers] - Existing headers
 * @return {Object} New headers object including User-Agent
 */
function withUserAgent (headers) {
  headers = headers || {}
  var hasUA = Object.keys(headers).some(function (k) {
    return k.toLowerCase() === 'user-agent'
  })
  var merged = {}
  Object.keys(headers).forEach(function (k) { merged[k] = headers[k] })
  if (!hasUA) { merged['User-Agent'] = USER_AGENT }
  return merged
}

module.exports = {
  userAgent: userAgent,
  withUserAgent: withUserAgent,
  USER_AGENT: USER_AGENT,
  VERSION: VERSION,
  COMPONENT: COMPONENT,
  // exported for tests
  sanitizeVersion: sanitizeVersion,
  resolveVersion: resolveVersion
}
