/*
 * Facet field control: what a user may modify, and what leaks to strangers.
 *
 * Both facets validate PATCH paths against a whitelist and throw Forbidden on
 * anything else (facets/user-user.js:38-62, facets/user-admin.js:27-42). That
 * default-deny is what makes new fields immutable without extra code -- the
 * property these tests exist to pin, since a future refactor to a blacklist
 * would silently make every provenance field user-editable.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var when = require('promised-io/promise').when
var buildModel = require('../helpers/model')
var userFacet = require('../../facets/user-user')
var adminFacet = require('../../facets/user-admin')

function seeded () {
  var h = buildModel()
  h.store.seed({
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    affiliation: 'ANL',
    organisms: 'E. coli',
    interests: 'genomics',
    roles: [],
    source: 'bvbrc',
    password: '$2b$10$notarealhash',
    resetCode: 'AB12C',
    creationDate: '2020-01-01T00:00:00.000Z',
    updateDate: '2020-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system'
  })
  return h
}

function asUser (id) {
  return { req: { user: { id: id } } }
}

test('user facet rejects a PATCH to an undeclared field', function () {
  var h = seeded()
  var facet = userFacet(h.model)
  assert.throws(function () {
    facet.patch('alice', [{ op: 'add', path: '/source', value: 'evil' }], asUser('alice'))
  }, /Cannot modify field/, 'default-deny must reject unknown paths')
})

test('user facet rejects a PATCH to roles (privilege escalation)', function () {
  var h = seeded()
  var facet = userFacet(h.model)
  assert.throws(function () {
    facet.patch('alice', [{ op: 'add', path: '/roles', value: ['admin'] }], asUser('alice'))
  }, /Cannot modify field/, 'a user must never grant themselves a role')
})

test('user facet rejects a mixed patch if ANY operation is disallowed', function () {
  // The loop validates every operation before applying any (user-user.js:50).
  // A partially-valid batch must be rejected whole, not applied in part.
  var h = seeded()
  var facet = userFacet(h.model)
  assert.throws(function () {
    facet.patch('alice', [
      { op: 'replace', path: '/first_name', value: 'Alicia' },
      { op: 'add', path: '/roles', value: ['admin'] }
    ], asUser('alice'))
  }, /Cannot modify field/)
  assert.strictEqual(h.store.writes().length, 0,
    'a rejected batch must perform no write at all')
})

test('user facet allows a whitelisted field', function () {
  var h = seeded()
  var facet = userFacet(h.model)
  assert.doesNotThrow(function () {
    facet.patch('alice', [{ op: 'replace', path: '/first_name', value: 'Alicia' }], asUser('alice'))
  })
})

test('user facet allows nested paths under a whitelisted prefix', function () {
  // /settings is whitelisted and the check permits nested paths beneath it
  // (user-user.js:53-55), which is how profile settings are stored.
  var h = seeded()
  h.store.docs.alice.settings = {}
  var facet = userFacet(h.model)
  assert.doesNotThrow(function () {
    facet.patch('alice', [{ op: 'add', path: '/settings/theme', value: 'dark' }], asUser('alice'))
  })
})

test('a nested patch fails when the parent object does not exist', function (t, done) {
  /*
   * Not a facet rule -- the whitelist passes /settings/theme. dactic's
   * jsonpatch (Model.patch, dactic/model.js:286-298) raises
   * PatchConflictError because `settings` is absent on the document.
   *
   * Pinned because it is a trap for any new nested field: a user who has
   * never saved a setting has no `settings` object, so the first write must
   * add the parent. Caught by writing this suite, not by reading the code.
   *
   * Note this arrives as a REJECTION, not a synchronous throw: the throw
   * happens inside a when() callback on the store's get. Facet-level whitelist
   * violations above throw synchronously because they never reach the store.
   */
  var h = seeded()
  var facet = userFacet(h.model)

  when(facet.patch('alice', [{ op: 'add', path: '/settings/theme', value: 'dark' }], asUser('alice')),
    function () {
      done(new Error('expected the patch to fail with no parent object'))
    }, function (err) {
      assert.match(err.message, /out of bounds|not an instance property/)
      assert.strictEqual(h.store.writes().length, 0, 'nothing may be written')
      done()
    })
})

test('admin facet whitelist does NOT permit nested paths', function () {
  /*
   * A real asymmetry between the two facets, not a bug being introduced here:
   * user-user.js uses a prefix test, admin uses indexOf equality
   * (user-admin.js:39). Pinned so the difference is deliberate and visible.
   */
  var h = seeded()
  var facet = adminFacet(h.model)
  assert.throws(function () {
    facet.patch('alice', [{ op: 'add', path: '/organisms/0', value: 'x' }], asUser('alice'))
  }, /Cannot modify field/)
})

test('third-party profile reads expose a fixed field list only', function (t, done) {
  /*
   * When the requester is NOT the profile owner, user-user.js:22-29 returns a
   * hand-built projection. Anything not listed there cannot leak, which is
   * what keeps new fields (including provenance) private by default.
   */
  var h = seeded()
  var facet = userFacet(h.model)

  when(facet.get('alice', asUser('bob')), function (res) {
    var u = res.getData()
    assert.deepStrictEqual(Object.keys(u).sort(),
      ['affiliation', 'first_name', 'id', 'last_name', 'organisms', 'realm'].sort())
    assert.ok(!('email' in u), 'email must not leak to a third party')
    assert.ok(!('password' in u), 'password must never leak')
    assert.ok(!('resetCode' in u), 'resetCode must never leak -- it is a credential')
    done()
  }, done)
})

test('self reads include the full record but never password or resetCode', function (t, done) {
  var h = seeded()
  var facet = userFacet(h.model)

  when(facet.get('alice', asUser('alice')), function (res) {
    var u = res.getData()
    assert.strictEqual(u.email, 'alice@example.com', 'own email is visible')
    assert.ok(!('password' in u), 'password is deleted on self-read')
    assert.ok(!('resetCode' in u), 'resetCode is deleted on self-read')
    done()
  }, done)
})

test('admin reads strip password and resetCode', function (t, done) {
  var h = seeded()
  var facet = adminFacet(h.model)

  when(facet.get('alice', asUser('admin')), function (res) {
    var u = res.getData()
    assert.ok(!('password' in u), 'password must be stripped even for admins')
    assert.ok(!('resetCode' in u), 'resetCode must be stripped even for admins')
    assert.strictEqual(u.realm, 'bvbrc', 'admin view resolves source -> realm')
    done()
  }, done)
})
