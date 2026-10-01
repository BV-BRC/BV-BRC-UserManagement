var nconf = require('nconf')

var defaults = {
  'http_port': 3002,

  'mongo': {
    'url': ''
  },
  'siteURL': 'http://user.patric.local:3002',
  'p3Home': 'http://patricbrc.org',
  'signing_PEM': 'private.pem',
  'signing_public_PEM': 'public.pem',
  'default_source': 'bvbrc',

  'realm_map': {
    'patricbrc.org': "patricbrc.org",
    "viprbrc": "bvbrc",
    "bvbrc": "bvbrc"
  },

  /*
   * Which frontend property a user registered from. `url` is a normalized
   * origin (what utils.normalizeSiteUrl() produces from a frontend's
   * appBaseURL); `site` is the slug stored on the user record. Matching is
   * case-insensitive, so config authors need not be careful about case.
   *
   * A LIST, not the object-keyed-by-origin this obviously wants to be:
   * **nconf splits every key on `:`**, so `{'https://x.org': 'slug'}` is
   * silently rewritten to `{https: {'//x.org': 'slug'}}` and every lookup
   * misses. That happens in `defaults` here, in p3-user.conf, and via
   * `.set()` alike; arrays are the only shape that survives all three. The
   * failure is quiet -- every origin resolves to 'unknown' and registration
   * still succeeds -- so do not "clean this up" into a map.
   *
   * Deliberately separate from realm_map/default_source. `source` looks like
   * the field for this and is not -- it is auth-bearing: generateToken.js:40
   * derives the token realm from realm_map[user.source], so writing 'maage'
   * there mints un=alice@undefined tokens that fail their own realm check in
   * middleware/token.js. Provenance must be able to grow without touching
   * anything in the auth path.
   *
   * Same enumeration as cors_origins above -- keep the two in sync.
   *
   * Non-production tiers (alpha./beta./dev-N./dev./test.) are deliberately
   * omitted: they resolve to the slug 'unknown', which is the right default
   * posture, and deployments add their own. A well-formed origin that is not
   * listed never blocks registration -- see utils.resolveSiteSlug().
   */
  'registration_site_map': [
    { url: 'https://www.bv-brc.org', site: 'bvbrc' },
    { url: 'https://alpha.bv-brc.org', site: 'bvbrc' },
    { url: 'https://beta.bv-brc.org', site: 'bvbrc' },
    { url: 'https://bv-brc.org', site: 'bvbrc' },
    { url: 'https://www.patricbrc.org', site: 'bvbrc' },
    { url: 'https://maage-brc.org', site: 'maage' },
    { url: 'https://www.maage-brc.org', site: 'maage' },
    { url: 'https://dev.maage-brc.org', site: 'maage' },
    { url: 'https://maage-brc.org', site: 'maage' },
    { url: 'https://dxkb.org', site: 'dxkb' },
    { url: 'https://ldkb.org', site: 'ldkb' }
  ],

  /*
   * Slug recorded when the caller sends no registration_site_url at all --
   * an old client, which is every client until the frontend PRs land. This
   * is an assumption, not an observation, which is why no URL is stored
   * alongside it.
   */
  'default_registration_site': 'bvbrc',

  /*
   * Absolute path to a newline-delimited-JSON audit log of security-relevant
   * events (currently: registration attempts and completions). Separate from
   * the general console log, which is unstructured prose interleaved with
   * request counts and driver warnings -- see audit.js.
   *
   * Empty by default: local/dev runs still see every event, via the
   * timestamped console logger with an AUDIT tag (log.js), so nothing extra
   * is required to work. Production should set this to a path under /logs,
   * which singularity.def already creates and mounts for pm2's combined log.
   */
  'audit_log_file': '',
  'email': {
    'localSendmail': false,
    'defaultFrom': 'PATRIC <do-not-reply@patricbrc.org>',
    'defaultSender': 'PATRIC <do-not-reply@patricbrc.org>',
    'host': '',
    'port': 587
  },
  'userTokenDuration': 24,
  'serviceTokenDuration': 24 * 31,

  /*
   * Origins permitted to make *credentialed* cross-origin requests. Anonymous
   * cross-origin access stays open to every origin, which is load-bearing:
   * the website runs on a different registrable domain than this service and
   * calls it for login, refresh, registration and profile reads. See
   * corsOptions.js.
   *
   * Exact-match serialized origins, enumerated explicitly: BV-BRC uses
   * alpha./beta./dev-N. while the sibling properties use dev./test., so no
   * interpolation over a property name is correct for all of them. This is
   * the same list the OAuth2 redirect_uri registration needs; keep them in
   * sync (PLAN-oauth2-migration.md in bvbrc_website).
   *
   * Empty by default, which reproduces today's production behavior exactly:
   * Access-Control-Allow-Credentials is currently never sent by this service.
   */
  'cors_origins': []
}

module.exports = nconf.argv().env().file(process.env.P3_USER_CONFIG ||'./p3-user.conf').defaults(defaults)
