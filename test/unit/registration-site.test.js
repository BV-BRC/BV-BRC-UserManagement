/*
 * PENDING -- the registration_site feature is not implemented yet.
 *
 * These are marked `todo`, so they run and report but do not fail the suite.
 * They encode the design in PLAN-registration-site.md as executable
 * expectations: implement the plan and they turn green without being edited.
 * If one still fails after implementation, the implementation and the plan
 * have diverged.
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

var SITE_MAP = {
  'https://www.bv-brc.org': 'bvbrc',
  'https://bv-brc.org': 'bvbrc',
  'https://www.patricbrc.org': 'bvbrc',
  'https://www.maage-brc.org': 'maage',
  'https://dxkb.org': 'dxkb',
  'https://ldkb.org': 'ldkb'
}

function withSiteMap () {
  return buildModel({
    config: {
      registration_site_map: SITE_MAP,
      default_registration_site: 'bvbrc'
    }
  })
}

/* ---- the URL normalizer, in isolation ---- */

test('normalizes URL variance to a bare origin', { todo: true }, function () {
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

test('rejects malformed and non-http(s) URLs rather than coercing them', { todo: true }, function () {
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

test('rejects an over-long URL before parsing it', { todo: true }, function () {
  // Bounded before new URL() sees it -- the stored value ends up in a user
  // document, and there is no legitimate 2KB base URL.
  assert.strictEqual(utils.normalizeSiteUrl('https://x.org/' + 'a'.repeat(3000)), null)
})

/* ---- origin -> slug resolution ---- */

test('maps a known origin to its slug', { todo: true }, function () {
  assert.strictEqual(utils.resolveSiteSlug('https://www.maage-brc.org', SITE_MAP), 'maage')
  assert.strictEqual(utils.resolveSiteSlug('https://dxkb.org', SITE_MAP), 'dxkb')
  assert.strictEqual(utils.resolveSiteSlug('https://ldkb.org', SITE_MAP), 'ldkb')
  assert.strictEqual(utils.resolveSiteSlug('https://www.patricbrc.org', SITE_MAP), 'bvbrc')
})

test('an unmapped but well-formed origin resolves to "unknown", not an error', { todo: true }, function () {
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

test('registration stores both the slug and the normalized URL', { todo: true }, function (t, done) {
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

test('an omitted parameter falls back to the default slug and stores no URL', { todo: true }, function (t, done) {
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

test('an unmapped origin still creates the account', { todo: true }, function (t, done) {
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

test('a malformed URL is a 400 and creates no user', { todo: true }, function (t, done) {
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

test('a client cannot set the slug directly', { todo: true }, function (t, done) {
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

test('registration_site does not touch source, so the token realm is unchanged', { todo: true }, function (t, done) {
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
      registration_site_map: { 'https://www.bv-brc.org': 'bvbrc' },
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
