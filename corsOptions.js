/*
 * CORS policy for p3_user.
 *
 * The configuration this replaces had two misspelled keys:
 *
 *   credential:   true    -> cors reads options.credentials
 *   allowHeaders: [...]   -> cors reads options.allowedHeaders
 *
 * Both were therefore inert, and they failed in opposite directions:
 *
 *   - `credential` meant Access-Control-Allow-Credentials was never sent, so
 *     credentialed cross-origin requests have never worked. Verified against
 *     production: an OPTIONS to https://user.patricbrc.org/authenticate with
 *     Origin: https://www.bv-brc.org returns ACAO but no ACAC. Nothing can
 *     depend on credentialed cross-origin requests, because none have ever
 *     succeeded.
 *
 *   - `allowHeaders` meant cors fell through to *reflecting* the browser's
 *     Access-Control-Request-Headers, which is strictly MORE permissive than
 *     the list that was intended. Correcting the spelling tightens the policy.
 *
 * Correcting only the spelling would be a security regression, not a fix:
 * `origin: true` reflects any requesting origin, and combined with a working
 * `credentials: true` that would let any site on the internet make
 * credentialed requests against the user service with a victim's ambient
 * authority. Because nothing exercises the cross-origin path today, no test
 * would fail. So the allowlist lands in the same change as the spelling fix.
 *
 * IMPORTANT: p3_user is reached CROSS-ORIGIN by the live website. The site
 * runs on bv-brc.org and calls userServiceURL (https://user.patricbrc.org --
 * a different registrable domain) for login, token refresh, SU login,
 * registration, password reset and profile reads:
 *
 *   p3app.js:701      GET  /authenticate/refresh/
 *   p3app.js:804,893  GET  /user/:id
 *   LoginForm.js:99   POST /authenticate
 *   LoginForm.js:45   POST /reset
 *   SuLogin.js:49     POST /authenticate/sulogin
 *   UserProfileForm.js:86,143,284,370
 *
 * So this service, unlike its /user and /sulogin *page* routes, genuinely
 * depends on permissive anonymous cross-origin access. Gating the ACAO header
 * on the allowlist would break production login for any property not listed,
 * which is exactly the kind of failure that does not show up until a deploy.
 * The origin therefore stays reflected, as today, and only CREDENTIALS are
 * gated on the allowlist -- the same split p3_api uses.
 *
 * p3_user has no cookie or session authentication -- middleware/token.js reads
 * the Authorization header and nothing else. So a cross-origin attacker has no
 * ambient authority to ride even with the origin reflected. The allowlist
 * exists to keep that true as the OAuth2 migration introduces cookie-backed
 * sessions.
 *
 * The allowlist comes from config (`cors_origins`), never from interpolation
 * over a property name. BV-BRC uses alpha./beta./dev-N. while DXKB, LDKB and
 * MAAGE use dev./test., so no naming convention covers all four properties.
 * This is the same enumeration the OAuth2 redirect_uri registration needs and
 * the two must be kept in sync -- see PLAN-oauth2-migration.md in the
 * bvbrc_website repo, "Multi-Domain Rollout and CORS".
 */

/*
 * The first three are unchanged from the previous configuration; p3_user reads
 * no other request header, since the only one middleware/token.js touches is
 * authorization.
 *
 * x-requested-with is NOT optional, even though no server code reads it.
 * dojo/request/xhr.js:278 sends it by DEFAULT:
 *
 *     if(!headers || !('X-Requested-With' in headers)){
 *       _xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
 *     }
 *
 * It is suppressed only where a call site explicitly passes the key with a
 * falsy value (`'X-Requested-With': null`), which UserProfileForm.js does at
 * :86, :143 and :370 -- but LoginForm.js:99 (POST /authenticate) passes no
 * headers object at all and therefore sends it.
 *
 * Under the old `allowHeaders` typo cors reflected Access-Control-Request-
 * Headers, so this was allowed by accident. Omitting it from the fixed list
 * breaks login with:
 *
 *   Request header field X-Requested-With is not allowed by
 *   Access-Control-Allow-Headers
 *
 * Do not remove it on the grounds that nothing reads it server-side. The
 * question for this list is what the CLIENT SENDS, not what the server
 * consumes -- a header omitted here fails preflight before any handler runs.
 */
var ALLOWED_HEADERS = ['accept', 'content-type', 'authorization', 'x-requested-with']

var EXPOSED_HEADERS = ['Content-Range', 'X-Content-Range', 'Content-type']

/*
 * Unchanged from the previous configuration, minus its duplicate 'PUT' and
 * lowercase 'patch' -- cors does an exact join into Access-Control-Allow-
 * Methods, and the HTTP method token is case-sensitive, so the lowercase
 * entry only ever added noise to the header.
 */
var METHODS = ['GET', 'PUT', 'PATCH', 'POST', 'DELETE']

var MAX_AGE = 8200

/*
 * Exact string match on the serialized origin. No wildcards, no suffix
 * matching: a suffix test for '.bv-brc.org' would also match
 * 'evil-bv-brc.org' and 'bv-brc.org.attacker.net'.
 */
function isAllowed (origin, allowlist) {
  return Boolean(origin) && allowlist.indexOf(origin) !== -1
}

/*
 * Returns a cors options delegate. Reads the allowlist once at startup; the
 * service is restarted on config change, as documented for every other
 * p3-user.conf value.
 */
function corsOptionsDelegate (config) {
  var allowlist = config.get('cors_origins') || []

  if (!Array.isArray(allowlist)) {
    throw new Error('cors_origins must be an array of exact origin strings')
  }

  return function (req, callback) {
    var origin = req.headers.origin

    callback(null, {
      // Reflect the origin, as today. This is load-bearing: the website is on
      // a different registrable domain than this service, so tightening it
      // would break login. Reflecting is also required for credentialed
      // responses, since ACAO cannot be '*' when ACAC is true.
      origin: true,
      // ...but credentials only for the allowlist. For every other origin
      // this stays false, so the browser drops any credentialed response --
      // which is the behavior in production today, where ACAC is never sent.
      credentials: isAllowed(origin, allowlist),
      methods: METHODS,
      allowedHeaders: ALLOWED_HEADERS,
      exposedHeaders: EXPOSED_HEADERS,
      maxAge: MAX_AGE
    })
  }
}

module.exports = corsOptionsDelegate
module.exports.isAllowed = isAllowed
module.exports.ALLOWED_HEADERS = ALLOWED_HEADERS
module.exports.EXPOSED_HEADERS = EXPOSED_HEADERS
module.exports.METHODS = METHODS
