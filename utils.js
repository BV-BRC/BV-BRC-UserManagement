/**
 * Return a unique identifier with the given `len`.
 *
 *     utils.uid(10);
 *     // => "FDaS435D2z"
 *
 * @param {Number} len
 * @return {String}
 * @api private
 */
exports.uid = function (len) {
  var buf = []
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  var charlen = chars.length

  for (var i = 0; i < len; ++i) {
    buf.push(chars[getRandomInt(0, charlen - 1)])
  }

  return buf.join('')
}

/**
 * Return a random int, used by `utils.uid()`
 *
 * @param {Number} min
 * @param {Number} max
 * @return {Number}
 * @api private
 */

function getRandomInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Validate that a code parameter is safe for use in RQL queries.
 * Reset/verification codes are 5-character uppercase alphanumeric strings.
 * This prevents RQL injection attacks (e.g., "re:.*" regex patterns).
 *
 * @param {String} code - The code to validate
 * @return {Boolean} - true if valid, false otherwise
 */
exports.isValidCode = function (code) {
  if (!code || typeof code !== 'string') {
    return false
  }
  // Codes are generated with randomstring.generate(5).toUpperCase()
  // They should be exactly 5 uppercase alphanumeric characters
  return /^[A-Z0-9]{5}$/.test(code)
}

/**
 * Longest registration_site_url we will even attempt to parse. The value is
 * stored in a user document and there is no legitimate 2KB base URL; bounding
 * it before new URL() keeps a hostile caller from handing the parser
 * something enormous.
 */
var MAX_SITE_URL_LENGTH = 2048

/**
 * Reduce a frontend's appBaseURL to a bare origin, or null if it is not a
 * usable http(s) URL.
 *
 * The frontends pass appBaseURL verbatim and it is not guaranteed to be a
 * bare origin -- trailing slash, path, query, case and explicit default port
 * all vary by deployment, and all mean the same site. Normalizing here is
 * what makes the config map a simple exact-match lookup.
 *
 * Returns null rather than throwing so callers can distinguish "malformed"
 * from "absent" and choose their own error; registerUser turns null into a
 * 400.
 *
 * Only http and https are accepted. javascript: is the one that matters --
 * the value is persisted and may later be rendered in an admin view, so a
 * scheme that can execute must never reach the database. The others cannot
 * be produced by a real frontend, so rejecting them costs nothing and keeps
 * the stored data trustworthy.
 *
 * @param {String} url - a site base URL, e.g. 'https://www.bv-brc.org/'
 * @return {String|null} - the normalized origin, e.g. 'https://www.bv-brc.org'
 */
exports.normalizeSiteUrl = function (url) {
  if (!url || typeof url !== 'string') {
    return null
  }
  if (url.length > MAX_SITE_URL_LENGTH) {
    return null
  }

  var parsed
  try {
    parsed = new URL(url)
  } catch (err) {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }
  if (!parsed.hostname) {
    return null
  }

  /*
   * parsed.origin, not protocol + host: it already drops a default port
   * (https://x.org:443 -> https://x.org) and lowercases the host, so
   * https://X.ORG:443/p?q and https://x.org are the same key.
   */
  return parsed.origin
}

/**
 * Map a normalized origin to its site slug.
 *
 * An origin that is well-formed but absent from the map resolves to
 * 'unknown', NOT an error. That is deliberate: a new property that launches
 * before this service's map is updated must still be able to register users.
 * Failing here would turn a config omission into a launch-blocking outage.
 * The normalized URL is stored alongside the slug, so 'unknown' records can
 * be backfilled once the map catches up.
 *
 * Accepts either shape:
 *   [{url: 'https://x.org', site: 'x'}, ...]   <- what config must use
 *   {'https://x.org': 'x', ...}                <- convenient for callers
 *
 * The list is the one config uses, because nconf splits keys on `:` and
 * would shred a URL-keyed object -- see the comment on
 * registration_site_map in config.js. The object form is still accepted so
 * anything holding a real in-memory map need not convert it.
 *
 * @param {String} origin - a normalized origin from normalizeSiteUrl()
 * @param {Array|Object} siteMap - from config registration_site_map
 * @return {String} - the slug, or 'unknown'
 */
exports.resolveSiteSlug = function (origin, siteMap) {
  if (!origin || typeof origin !== 'string') {
    return 'unknown'
  }
  if (!siteMap || typeof siteMap !== 'object') {
    return 'unknown'
  }

  // Config authors may be sloppy about case; normalizeSiteUrl already
  // lowercased the host, so compare on a lowercased key.
  var wanted = origin.toLowerCase()

  var entries = Array.isArray(siteMap)
    ? siteMap.map(function (e) { return [e && e.url, e && e.site] })
    : Object.keys(siteMap).map(function (k) { return [k, siteMap[k]] })

  var match = entries.filter(function (pair) {
    return typeof pair[0] === 'string' && pair[0].toLowerCase() === wanted
  })[0]

  return (match && match[1]) ? match[1] : 'unknown'
}

/**
 * Resolve the originating client IP from a request.
 *
 * x-forwarded-for first: this service sits behind the same nginx/Cloudflare
 * front door as p3_api (see p3_api/app.js's :remote-ip morgan token), so
 * req.connection.remoteAddress alone would log the proxy's address for every
 * request, not the client's. x-forwarded-for can carry a comma-separated
 * chain when multiple proxies are involved; the first entry is the original
 * client.
 *
 * @param {http.IncomingMessage} req
 * @return {String|undefined}
 */
exports.clientIp = function (req) {
  var forwarded = req.headers && req.headers['x-forwarded-for']
  if (forwarded) { return forwarded.split(',')[0].trim() }
  return req.connection && req.connection.remoteAddress
}
