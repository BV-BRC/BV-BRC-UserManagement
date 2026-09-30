/*
 * Registration behavior as it stands today.
 *
 * The cpProps allowlist (models/user.js:118) is the real gate on what a
 * client can put into a user record -- see dactic-contract.test.js for why
 * the schema is not. These tests pin both the allowlist's contents and its
 * deny-by-default effect, which is the property the registration_site work
 * depends on.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var when = require('promised-io/promise').when
var buildModel = require('../helpers/model')
var fixture = buildModel.userFixture

test('registerUser persists only the allowlisted properties', function (t, done) {
  var h = buildModel()
  when(h.model.registerUser(fixture({
    username: 'alice',
    password: 'hunter2hunter2',
    // Not in cpProps -- must not reach the document.
    roles: ['admin'],
    email_verified: true,
    injected_field: 'nope'
  })), function () {
    var doc = h.store.docs.alice
    assert.ok(doc, 'the user must exist')
    assert.deepStrictEqual(doc.roles, [], 'roles must not be settable at registration')
    assert.notStrictEqual(doc.injected_field, 'nope',
      'an unlisted client field must not be persisted')
    done()
  }, done)
})

test('client-supplied roles cannot escalate privilege at registration', function (t, done) {
  // The highest-stakes case of the above, called out separately so a failure
  // reads as a security regression rather than a field-mapping nit.
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'mallory', password: 'hunter2hunter2', roles: ['admin'] })),
    function () {
      assert.deepStrictEqual(h.store.docs.mallory.roles, [])
      done()
    }, done)
})

test('registerUser lowercases the email and sets l_id', function (t, done) {
  // models/user.js:477-478. l_id backs case-insensitive lookup; if it drifts
  // from id.toLowerCase() the duplicate-username check stops working.
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'MixedCase', email: 'Alice@EXAMPLE.com', password: 'hunter2hunter2' })),
    function () {
      var doc = h.store.docs.MixedCase
      assert.strictEqual(doc.email, 'alice@example.com')
      assert.strictEqual(doc.l_id, 'mixedcase')
      assert.strictEqual(doc.id, 'MixedCase', 'the display id keeps its case')
      done()
    }, done)
})

test('registerUser stamps creation metadata and the default source', function (t, done) {
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    var doc = h.store.docs.alice
    assert.strictEqual(doc.source, 'bvbrc', 'source comes from config default_source')
    assert.strictEqual(doc.createdBy, 'system')
    assert.ok(doc.creationDate, 'creationDate must be set')
    assert.doesNotThrow(function () { return new Date(doc.creationDate).toISOString() })
    done()
  }, done)
})

test('a duplicate username is rejected and does not overwrite the existing user', function (t, done) {
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    when(h.model.registerUser(fixture({
      username: 'alice',
      email: 'someone-else@example.com',
      password: 'hunter2hunter2'
    })), function () {
      done(new Error('expected a Conflict for the duplicate username'))
    }, function (err) {
      assert.match(err.message, /already in use|already exists/i)
      assert.strictEqual(h.store.docs.alice.email, 'alice@example.com',
        'the original record must be untouched')
      done()
    })
  }, done)
})

test('a duplicate email is rejected', function (t, done) {
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    when(h.model.registerUser(fixture({ username: 'bob', password: 'hunter2hunter2' })), function () {
      done(new Error('expected a Conflict for the duplicate email'))
    }, function (err) {
      assert.match(err.message, /email address already exists/i)
      assert.strictEqual(h.store.count(), 1, 'no second user may be created')
      done()
    })
  }, done)
})

test('the password is stored as a bcrypt hash, never in cleartext', function (t, done) {
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    var doc = h.store.docs.alice
    assert.ok(doc.password, 'a password must be stored')
    assert.notStrictEqual(doc.password, 'hunter2hunter2', 'never cleartext')
    assert.match(doc.password, /^\$2[aby]\$/, 'must be a bcrypt hash')
    done()
  }, done)
})

test('registering without a password issues a reset code instead', function (t, done) {
  // The invite flow: no password -> resetAccount + a "complete registration"
  // mail (models/user.js:145-158).
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice' })), function () {
    var doc = h.store.docs.alice
    assert.match(doc.resetCode, /^[A-Z0-9]{5}$/, 'a valid reset code must be generated')
    assert.strictEqual(h.model.sent.length, 1, 'exactly one mail must be sent')
    assert.match(h.model.sent[0].message, /Complete Registration/i)
    done()
  }, done)
})

test('the generated reset code passes isValidCode', function (t, done) {
  // Closes the loop with rql-injection.test.js: the validator must accept
  // what the generator produces, or password reset breaks for everyone.
  var utils = require('../../utils')
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice' })), function () {
    assert.ok(utils.isValidCode(h.store.docs.alice.resetCode))
    done()
  }, done)
})

test('setPassword clears the reset code', function (t, done) {
  /*
   * models/user.js:433. If the code survived a password change it would stay
   * valid for a second reset -- an account-takeover window after the
   * legitimate owner has already recovered the account.
   */
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice' })), function () {
    assert.ok(h.store.docs.alice.resetCode, 'precondition: a code exists')
    when(h.model.setPassword('alice', 'brand-new-password'), function () {
      assert.strictEqual(h.store.docs.alice.resetCode, '', 'the code must be cleared')
      done()
    }, done)
  }, done)
})

test('validatePassword accepts the correct password and rejects a wrong one', function (t, done) {
  /*
   * A failed validation reads back as `undefined`, not `false`: models/user.js
   * resolves `new Result(false)`, and dactic's Result constructor
   * (dactic/result.js:12) only calls setData() when the value is truthy, so
   * `false` is never stored. Every caller tests truthiness
   * (routes/authenticate.js:24, user-user.js:125), so this is harmless -- but
   * it means a test asserting `=== false` fails against correct code, and any
   * future caller doing `if (v === false)` would silently never fire.
   */
  var h = buildModel()
  when(h.model.registerUser(fixture({ username: 'alice', password: 'hunter2hunter2' })), function () {
    when(h.model.validatePassword('alice', 'hunter2hunter2'), function (good) {
      assert.strictEqual(good.getData().id, 'alice', 'the correct password returns the user')
      when(h.model.validatePassword('alice', 'wrong-password'), function (bad) {
        assert.ok(!bad.getData(), 'a wrong password must not validate')
        assert.strictEqual(bad.getData(), undefined,
          'pinning the Result(false) quirk -- it is undefined, never false')
        done()
      }, done)
    }, done)
  }, done)
})

test('a legacy SHA1 password validates and is migrated to bcrypt', function (t, done) {
  /*
   * models/user.js:373-391. Legacy records hold sha1(password{salt}); a
   * successful login must re-encode them as bcrypt. Pinned because the
   * migration is silent -- if it broke, logins would keep working and the
   * legacy hashes would simply never go away.
   */
  var crypto = require('crypto')
  var config = require('../../config')
  var h = buildModel()
  var legacy = crypto.createHash('sha1')
    .update('legacy-password{' + config.get('sha_salt') + '}')
    .digest('hex')

  h.store.seed({
    id: 'oldtimer',
    l_id: 'oldtimer',
    email: 'old@example.com',
    first_name: 'Old',
    last_name: 'Timer',
    roles: [],
    source: 'bvbrc',
    password: legacy,
    creationDate: '2010-01-01T00:00:00.000Z',
    updateDate: '2010-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system'
  })

  when(h.model.validatePassword('oldtimer', 'legacy-password'), function (res) {
    assert.ok(res.getData(), 'the legacy password must validate')
    assert.match(h.store.docs.oldtimer.password, /^\$2[aby]\$/,
      'the stored hash must have been upgraded to bcrypt')
    done()
  }, done)
})
