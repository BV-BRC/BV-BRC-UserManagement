/*
 * The registration_site feature, per PLAN-registration-site.md.
 *
 * These were written first, as `todo`, and turned green by the
 * implementation without being edited -- so they are the design as specified,
 * not a description of whatever the code happens to do.
 *
 * Deliberately written against the *behavior* (a URL in, a slug stored) rather
 * than against a particular helper signature, except where the plan names one.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var when = require('promised-io/promise').when
var utils = require('../../utils')
var buildModel = require('../helpers/model')
var fixture = buildModel.userFixture

/*
 * A list, matching config.js. It reads like it wants to be an object keyed
 * by origin, and it cannot be: nconf splits every key on `:`, so
 * {'https://x.org': 'slug'} becomes {https: {'//x.org': 'slug'}} and every
 * lookup misses. Using the real config shape here is the point -- an
 * object-shaped fixture would pass while production silently resolved
 * everything to 'unknown'.
 */
var SITE_MAP = [
  { url: 'https://www.bv-brc.org', site: 'bvbrc' },
  { url: 'https://bv-brc.org', site: 'bvbrc' },
  { url: 'https://www.patricbrc.org', site: 'bvbrc' },
  { url: 'https://www.maage-brc.org', site: 'maage' },
  { url: 'https://dxkb.org', site: 'dxkb' },
  { url: 'https://ldkb.org', site: 'ldkb' }
]

function withSiteMap () {
  return buildModel({
    config: {
      registration_site_map: SITE_MAP,
      default_registration_site: 'bvbrc'
    }
  })
}

/* ---- the URL normalizer, in isolation ---- */

test('normalizes URL variance to a bare origin', function () {
  /*
   * The frontends pass appBaseURL verbatim, and it is not guaranteed to be a
   * bare origin -- trailing slash, path, query and case all vary by
   * deployment. All of these are the same site and must map identically.
   */
  var same = [
    'https://www.bv-brc.org',
    'https://www.bv-brc.org/',
    'https://www.bv-brc.org/register',
    'HTTPS://WWW.BV-BRC.ORG/register?x=1',
    'https://www.bv-brc.org:443/'
  ]
  same.forEach(function (input) {
    assert.strictEqual(utils.normalizeSiteUrl(input), 'https://www.bv-brc.org',
      'must normalize: ' + input)
  })
})

test('rejects malformed and non-http(s) URLs rather than coercing them', function () {
  /*
   * javascript: is the one that matters -- the value is stored and may later
   * be rendered in an admin view, so a scheme that can execute must never be
   * persisted. The rest cannot be produced by a real frontend, so rejecting
   * them costs nothing and keeps the stored data trustworthy.
   */
  var bad = ['javascript:alert(1)', 'ftp://x.org', 'data:text/html,x', 'not a url',
    '', '   ', '//www.bv-brc.org', 'file:///etc/passwd', null, undefined, 42, ['https://x.org']]
  bad.forEach(function (input) {
    assert.strictEqual(utils.normalizeSiteUrl(input), null,
      'must reject: ' + JSON.stringify(input))
  })
})

test('rejects an over-long URL before parsing it', function () {
  // Bounded before new URL() sees it -- the stored value ends up in a user
  // document, and there is no legitimate 2KB base URL.
  assert.strictEqual(utils.normalizeSiteUrl('https://x.org/' + 'a'.repeat(3000)), null)
})

/* ---- origin -> slug resolution ---- */

test('maps a known origin to its slug', function () {
  assert.strictEqual(utils.resolveSiteSlug('https://www.maage-brc.org', SITE_MAP), 'maage')
  assert.strictEqual(utils.resolveSiteSlug('https://dxkb.org', SITE_MAP), 'dxkb')
  assert.strictEqual(utils.resolveSiteSlug('https://ldkb.org', SITE_MAP), 'ldkb')
  assert.strictEqual(utils.resolveSiteSlug('https://www.patricbrc.org', SITE_MAP), 'bvbrc')
})

test('nconf cannot hold a map keyed by URL -- the config must be a list', function () {
  /*
   * Why registration_site_map is a list of {url, site} rather than the
   * obvious object. nconf treats `:` as a key-path separator, so a URL key
   * is silently split apart. This fails quietly -- every lookup misses,
   * every registration records 'unknown', nothing errors -- so pin it here
   * rather than rediscovering it.
   */
  var nconf = require('nconf')
  var probe = new nconf.Provider()
  probe.defaults({ shredded: { 'https://www.bv-brc.org': 'bvbrc' } })
  assert.deepStrictEqual(probe.get('shredded'), { https: { '//www.bv-brc.org': 'bvbrc' } },
    'if this ever stops being true, the list shape is no longer required')

  probe.defaults({ intact: [{ url: 'https://www.bv-brc.org', site: 'bvbrc' }] })
  assert.deepStrictEqual(probe.get('intact'), [{ url: 'https://www.bv-brc.org', site: 'bvbrc' }])
})

test('the shipped config map resolves the real production origins', function () {
  // Guards the config itself, not just the helper: a map that nconf has
  // shredded still *looks* fine in source.
  var config = require('../../config')
  var shipped = config.get('registration_site_map')
  assert.ok(Array.isArray(shipped), 'must survive nconf as a list')
  assert.strictEqual(utils.resolveSiteSlug('https://www.bv-brc.org', shipped), 'bvbrc')
  assert.strictEqual(utils.resolveSiteSlug('https://www.maage-brc.org', shipped), 'maage')
  assert.strictEqual(utils.resolveSiteSlug('https://dxkb.org', shipped), 'dxkb')
  assert.strictEqual(utils.resolveSiteSlug('https://ldkb.org', shipped), 'ldkb')
})

test('an unmapped but well-formed origin resolves to "unknown", not an error', function () {
  /*
   * The deployment-coupling guard. A property that launches before p3_user's
   * map is updated must still be able to register users; the stored URL lets
   * the slug be backfilled later.
   */
  assert.strictEqual(utils.resolveSiteSlug('https://brand-new.example.org', SITE_MAP), 'unknown')
  assert.strictEqual(utils.resolveSiteSlug('https://dev.dxkb.org', SITE_MAP), 'unknown',
    'non-production tiers are deliberately unmapped by default')
})

/* ---- registerUser end to end ---- */

test('registration stores both the slug and the normalized URL', function (t, done) {
  var h = withSiteMap()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    registration_site_url: 'HTTPS://WWW.MAAGE-BRC.ORG/register?ref=x'
  })), function () {
    var doc = h.store.docs.alice
    assert.strictEqual(doc.registration_site, 'maage')
    assert.strictEqual(doc.registration_site_url, 'https://www.maage-brc.org',
      'the normalized origin is stored, not the raw input')
    done()
  }, done)
})

test('an omitted parameter falls back to the default slug and stores no URL', function (t, done) {
  // An old client that has not been updated. Absence is not an assertion
  // about origin, so no URL may be invented for it.
  var h = withSiteMap()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    var doc = h.store.docs.alice
    assert.strictEqual(doc.registration_site, 'bvbrc')
    assert.ok(!doc.registration_site_url, 'no URL may be fabricated')
    done()
  }, done)
})

test('an unmapped origin still creates the account', function (t, done) {
  // The whole point of the "unknown" slug: assert the account EXISTS, not
  // merely that the call did not reject.
  var h = withSiteMap()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    registration_site_url: 'https://brand-new.example.org'
  })), function () {
    var doc = h.store.docs.alice
    assert.ok(doc, 'registration must not be blocked by an unmapped origin')
    assert.strictEqual(doc.registration_site, 'unknown')
    assert.strictEqual(doc.registration_site_url, 'https://brand-new.example.org')
    done()
  }, done)
})

test('a malformed URL is a 400 and creates no user', function (t, done) {
  var h = withSiteMap()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    registration_site_url: 'javascript:alert(1)'
  })), function () {
    done(new Error('expected BadRequest for a malformed registration_site_url'))
  }, function (err) {
    assert.strictEqual(err.status, 400, 'must be a 400, not a 500')
    assert.strictEqual(h.store.count(), 0,
      'no partial account may survive a rejected registration')
    done()
  })
})

/* ---- the field must not be client-controllable beyond the URL ---- */

test('a client cannot set the slug directly', function (t, done) {
  /*
   * registration_site is derived, never copied from input. If it were added
   * to cpProps alongside the URL, any client could claim any site and the
   * whole field would be worthless as provenance.
   */
  var h = withSiteMap()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    registration_site: 'dxkb',
    registration_site_url: 'https://www.bv-brc.org'
  })), function () {
    assert.strictEqual(h.store.docs.alice.registration_site, 'bvbrc',
      'the slug must come from the URL, not from the client-supplied slug')
    done()
  }, done)
})

test('registration_site does not touch source, so the token realm is unchanged', function (t, done) {
  // The separation the whole design rests on -- see token-realm.test.js for
  // what reusing `source` would have done.
  var h = withSiteMap()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    registration_site_url: 'https://www.maage-brc.org'
  })), function () {
    assert.strictEqual(h.store.docs.alice.source, 'bvbrc',
      'source stays the auth-bearing default')
    assert.strictEqual(h.store.docs.alice.registration_site, 'maage')
    done()
  }, done)
})

/*
 * ---- immutability, and the hazard the plan exists to avoid ----
 *
 * These two are NOT todo: they pass today and must keep passing. They hold
 * now because the facets are default-deny and the schema has no enum, which
 * is precisely why the plan needs no facet change. If a future refactor turns
 * the whitelist into a blacklist, or adds an enum, these fail immediately
 * rather than after the feature ships.
 */

test('neither field is user-patchable', function () {
  var userFacet = require('../../facets/user-user')
  var h = withSiteMap()
  h.store.seed({
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    roles: [],
    source: 'bvbrc',
    registration_site: 'bvbrc',
    creationDate: 'x',
    updateDate: 'x',
    createdBy: 'system',
    updatedBy: 'system'
  })
  var facet = userFacet(h.model)

  assert.throws(function () {
    facet.patch('alice', [{ op: 'replace', path: '/registration_site', value: 'dxkb' }],
      { req: { user: { id: 'alice' } } })
  }, /Cannot modify field/)
  assert.throws(function () {
    facet.patch('alice', [{ op: 'replace', path: '/registration_site_url', value: 'https://x.org' }],
      { req: { user: { id: 'alice' } } })
  }, /Cannot modify field/)
})

test('a user holding a retired slug can still be written', function (t, done) {
  /*
   * The regression the schema `enum` would have introduced. A record created
   * when `dxkb` was mapped must remain writable after the site is removed
   * from the config map -- otherwise that user cannot reset a password,
   * verify an email, or edit a profile, and nothing surfaces until they try.
   *
   * See dactic-contract.test.js for the AJV mechanism; this is the end-to-end
   * consequence.
   */
  var h = buildModel({
    config: {
      // dxkb deliberately absent
      registration_site_map: [{ url: 'https://www.bv-brc.org', site: 'bvbrc' }],
      default_registration_site: 'bvbrc'
    }
  })
  h.store.seed({
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    roles: [],
    source: 'bvbrc',
    registration_site: 'dxkb',
    registration_site_url: 'https://dxkb.org',
    creationDate: 'x',
    updateDate: 'x',
    createdBy: 'system',
    updatedBy: 'system'
  })

  when(h.model.setPassword('alice', 'a-brand-new-password'), function () {
    assert.match(h.store.docs.alice.password, /^\$2[aby]\$/,
      'the write must succeed despite the retired slug')
    assert.strictEqual(h.store.docs.alice.registration_site, 'dxkb',
      'and the retired value must be preserved, not scrubbed')
    done()
  }, done)
})
