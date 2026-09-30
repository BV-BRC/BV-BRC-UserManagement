/*
 * Integration tests against a real mongod.
 *
 * These cover exactly what test/helpers/memstore.js documents it CANNOT
 * model, and nothing else -- duplicating unit coverage here would just make
 * the suite slower and infrastructure-dependent for no gain:
 *
 *   - the overwrite:false refusal, which is a findOne+insert in the store
 *   - RQL semantics as the mongo store translates them (its own rql.js, not
 *     rql/js-array), notably whether `re:` really is a regex against the DB
 *   - ObjectID / _id handling
 *   - undefined-valued properties, which JS ignores and BSON does not
 *
 * Skipped entirely unless P3_USER_TEST_MONGO_URL is set. See
 * test/helpers/mongo.js for the safety notes -- this creates and drops
 * databases, so point it at a scratch server.
 *
 * Verified against mongod 3.4.24, the version BV-BRC runs in production.
 *
 * EVERY QUERY HERE CARRIES AN EXPLICIT limit(). That is not stylistic. A
 * query with no limit reaches the driver as limit:Infinity, which BSON
 * serializes to int64 min, and mongod rejects it:
 *
 *     Limit value must be non-negative, but received: -9223372036854775808
 *
 * dactic-store-mongodb/rql.js:13,15 defaults limit to Infinity, and index.js
 * :332-350 has the code that would have clamped it commented out. Production
 * never hits this because dactic/datamodel.js:80 appends a default limit(25)
 * to every HTTP query and models/user.js:181 hardcodes limit(1) -- so this is
 * a real constraint on callers, not a service bug. A test omitting limit() is
 * testing the driver's integer handling, not p3_user.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var mongo = require('../helpers/mongo')
var UserModel = require('../../models/user')

var unavailable = mongo.skipReason()

function userDoc (overrides) {
  return Object.assign({
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    roles: [],
    source: 'bvbrc',
    creationDate: '2020-01-01T00:00:00.000Z',
    updateDate: '2020-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system'
  }, overrides || {})
}

/*
 * A registration payload as routes/register.js forwards it. The optional
 * profile fields are present-but-empty because that is what a browser form
 * POST produces -- see the 'undefined' test below for why the distinction
 * between empty and absent decides whether registration succeeds.
 */
function registration (overrides) {
  return Object.assign({
    username: 'alice',
    password: 'hunter2hunter2',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    affiliation: '',
    middle_name: '',
    organisms: '',
    interests: ''
  }, overrides || {})
}

test('mongo integration', { skip: unavailable }, async function (t) {
  var up = await mongo.available()
  if (!up) {
    t.skip('P3_USER_TEST_MONGO_URL is set but not reachable: ' + mongo.URL)
    return
  }

  await t.test('put with overwrite:false refuses to clobber an existing id', async function () {
    var h = await mongo.connect('user')
    try {
      await h.store.put(userDoc(), { overwrite: false })

      /*
       * captureError, not try/catch. dactic-store-mongodb/index.js:300
       * references an undeclared `id` while building its rejection message,
       * so the ReferenceError is thrown inside a driver callback on a later
       * tick and the deferred is never rejected at all. An await cannot see
       * it; without capture it crashes the whole runner.
       *
       * What matters is that the write is refused and the original document
       * survives -- both hold. But a caller that branches on the rejection
       * message (models/user.js:464,491 branch on error contents) will get a
       * ReferenceError, not the message the source implies.
       */
      var err = await mongo.captureError(function () {
        return h.store.put(userDoc({ email: 'someone-else@example.com' }), { overwrite: false })
      })
      assert.ok(err, 'the second insert must be refused, not silently applied')

      var res = await h.store.get('alice')
      assert.strictEqual(res.getData().email, 'alice@example.com',
        'the original document must be intact')
    } finally {
      await h.teardown()
    }
  })

  await t.test('the store strips _id from returned documents', async function () {
    /*
     * memstore cannot model this. The store deletes _id on the way out
     * (index.js:252,295) unless dontRemoveMongoIds is set. If it ever stopped,
     * every user API response would start leaking a raw ObjectID, and the AJV
     * validation in Model.put would see an undeclared field on the next write.
     */
    var h = await mongo.connect('user')
    try {
      await h.store.put(userDoc(), { overwrite: false })
      var doc = (await h.store.get('alice')).getData()
      assert.ok(!('_id' in doc), '_id must not be exposed')

      var queried = (await h.store.query('eq(id,alice)&limit(10)')).getData()
      assert.strictEqual(queried.length, 1)
      assert.ok(!('_id' in queried[0]), '_id must not be exposed via query either')
    } finally {
      await h.teardown()
    }
  })

  await t.test('an unencoded re: value becomes a real regex against mongo', async function () {
    /*
     * THE REASON THIS FILE EXISTS.
     *
     * Under rql/js-array the injection string `re:.*` matches nothing, so a
     * unit test asserting "the injection is harmless" would pass for entirely
     * the wrong reason. Against the mongo store it is compiled to an actual
     * JavaScript RegExp -- dactic-store-mongodb/rql.js turns eq(f,re:.*) into
     * {f: /.*\/i} -- and matches every document.
     *
     * The subtlety worth recording: encodeURIComponent() ALONE defeats this
     * one. `re%3A.*` survives as the literal string "re:.*" and matches
     * nothing. So both defenses named in CLAUDE.md are real, and they cover
     * different things:
     *
     *   - encodeURIComponent stops `re:` being interpreted as an operator
     *   - isValidCode stops structural injection, which encoding does NOT
     *     stop: encodeURIComponent leaves ( ) and ' unescaped, so a code of
     *     "X),eq(id,admin" splits the RQL expression into extra terms (see
     *     the next test)
     *
     * This asserts the danger is real, not that the service is broken -- the
     * service never builds either query, because isValidCode() rejects the
     * input first (test/unit/rql-injection.test.js).
     */
    var h = await mongo.connect('user')
    try {
      await h.store.put(userDoc({ resetCode: 'AB12C' }), { overwrite: false })
      await h.store.put(userDoc({
        id: 'bob', l_id: 'bob', email: 'bob@example.com', resetCode: 'ZZ99Z'
      }), { overwrite: false })

      var exact = (await h.store.query('eq(resetCode,AB12C)&limit(10)')).getData()
      assert.strictEqual(exact.length, 1, 'an exact code matches one user')
      assert.strictEqual(exact[0].id, 'alice')

      var raw = (await h.store.query('eq(resetCode,re:.*)&limit(10)')).getData()
      assert.strictEqual(raw.length, 2,
        'an UNENCODED re: value matches every user -- it is compiled to a RegExp')

      var encoded = (await h.store.query(
        'eq(resetCode,' + encodeURIComponent('re:.*') + ')&limit(10)')).getData()
      assert.strictEqual(encoded.length, 0,
        'encoding alone neutralizes re: -- it survives as a literal string')
    } finally {
      await h.teardown()
    }
  })

  await t.test('encodeURIComponent does not stop structural RQL injection', async function () {
    /*
     * The half of the threat encoding does not cover, and the reason
     * isValidCode() is not redundant with it.
     *
     * encodeURIComponent leaves !'()*-._~ unescaped. A reset code of
     * "X),eq(id,admin" therefore closes the eq() early and injects a further
     * term into the and(), exactly as routes/reset.js:42 would build it. The
     * parse is confirmed against dactic-store-mongodb/rql.js:
     *
     *     and(eq(email,v%40x.com),eq(resetCode,X),eq(id,admin))
     *       => {$and: [{email: ...}, {resetCode: "X"}, {name: "%2Ceq", ...}]}
     *
     * Here the extra term happens to degrade into a junk clause that matches
     * nothing rather than a useful one -- so this asserts what is verified,
     * that the query STRUCTURE is altered, without overclaiming an
     * exploitable bypass. A parser change could turn that junk clause into a
     * live one; isValidCode() is what makes that irrelevant.
     */
    var RQ = require('dactic-store-mongodb/rql')
    var hostile = 'X),eq(id,admin'
    var q = 'and(eq(email,' + encodeURIComponent('alice@example.com') +
            '),eq(resetCode,' + encodeURIComponent(hostile) + '))'
    var parsed = new RQ(q).toMongo()[0]

    assert.ok(Array.isArray(parsed.$and), 'parses as a conjunction')
    assert.strictEqual(parsed.$and.length, 3,
      'the injected value added a THIRD term -- encoding did not contain it')
    assert.deepStrictEqual(parsed.$and[1], { resetCode: 'X' },
      'and truncated the code at the injected paren')

    var clean = new RQ('and(eq(email,' + encodeURIComponent('alice@example.com') +
                       '),eq(resetCode,AB12C))').toMongo()[0]
    assert.strictEqual(clean.$and.length, 2, 'a valid code yields exactly two terms')
  })

  await t.test('encodeURIComponent keeps an email query exact', async function () {
    // The other interpolation site (models/user.js:128,181) takes an email,
    // which is not format-validated. Encoding is the whole defense there.
    var h = await mongo.connect('user')
    try {
      await h.store.put(userDoc(), { overwrite: false })
      var q = 'eq(email,' + encodeURIComponent('alice@example.com') + ')&limit(10)'
      var found = (await h.store.query(q)).getData()
      assert.strictEqual(found.length, 1)
      assert.strictEqual(found[0].id, 'alice')
    } finally {
      await h.teardown()
    }
  })

  await t.test('an omitted optional profile field breaks registration', async function () {
    /*
     * A REAL DEFECT, found by running this layer for the first time. Pinned
     * as observed behavior, deliberately NOT worked around in the fixture --
     * if someone fixes models/user.js this test fails and tells them to
     * update it.
     *
     * registerUser (models/user.js:118-121) copies its allowlist
     * unconditionally:
     *
     *     cpProps.forEach((prop) => { newUser[prop] = user[prop] })
     *
     * An omitted field therefore lands as `undefined`. In plain JS that is
     * invisible -- AJV skips undefined, and memstore's JSON round trip drops
     * the key -- which is why the unit layer never caught it. BSON does not
     * skip it: the driver serializes undefined to NULL, so the document comes
     * back with affiliation:null, and AJV's `type: 'string'` rejects null on
     * the NEXT write:
     *
     *     data.affiliation should be string, data.organisms should be string,
     *     data.interests should be string
     *
     * Failure is delayed and the cleanup differs by path, which is the ugly
     * part:
     *   - with a password, setPassword's error handler deletes the account
     *     (models/user.js:165) -- the user gets an error and NO account
     *   - without a password (the invite flow), the account is left BEHIND in
     *     a state that cannot be written to: no password reset, no email
     *     verification, no profile edit
     *
     * Reachable in production only from a client that omits the keys
     * entirely -- an HTML form always sends them as "" and empty string
     * passes. A JSON API caller posting just the documented required fields
     * hits it. The one-line fix is to skip undefined in the cpProps loop.
     */
    var h = await mongo.connect('user')
    var model = new UserModel(h.store, {})
    model.mail = function () { return true }
    try {
      var payload = registration()
      delete payload.affiliation
      delete payload.organisms
      delete payload.interests

      var failed = false
      try {
        await model.registerUser(payload)
      } catch (err) {
        failed = true
        assert.match(String(err.message || err), /should be string/,
          'fails AJV validation on the null-valued optional fields')
      }
      assert.ok(failed, 'registration with omitted optional fields must be seen to fail')

      var rows = await h.dbHandle.collection('user').find({}).toArray()
      assert.strictEqual(rows.length, 0,
        'the password path rolls the account back (models/user.js:165)')
    } finally {
      await h.teardown()
    }
  })

  await t.test('empty-string optional fields register successfully', async function () {
    // The control for the test above: same payload, "" instead of absent.
    // This is what a browser form POST sends, and it works -- which is why
    // the defect above has gone unnoticed.
    var h = await mongo.connect('user')
    var model = new UserModel(h.store, {})
    model.mail = function () { return true }
    try {
      await model.registerUser(registration())
      var rows = await h.dbHandle.collection('user').find({}).toArray()
      assert.strictEqual(rows.length, 1, 'the account exists')
      assert.strictEqual(rows[0].id, 'alice')
      assert.strictEqual(rows[0].affiliation, '', 'empty string is stored as empty string')
    } finally {
      await h.teardown()
    }
  })

  await t.test('BSON stores undefined as null, unlike JSON', async function () {
    /*
     * The mechanism behind the defect above, isolated so it is obvious why
     * memstore cannot model it. memstore clones with JSON.parse(stringify),
     * which DROPS undefined-valued keys; the driver converts them to null and
     * keeps the key. Every AJV `type` on an optional field depends on this.
     */
    var h = await mongo.connect('user')
    try {
      await h.store.put(userDoc({ affiliation: undefined }), { overwrite: false })
      var doc = (await h.store.get('alice')).getData()
      assert.ok('affiliation' in doc, 'the key survives the round trip')
      assert.strictEqual(doc.affiliation, null, 'undefined came back as null')

      var viaJson = JSON.parse(JSON.stringify(userDoc({ affiliation: undefined })))
      assert.ok(!('affiliation' in viaJson),
        'a JSON clone drops it entirely -- this is the memstore blind spot')
    } finally {
      await h.teardown()
    }
  })

  await t.test('registerUser rejects a duplicate against the real store', async function () {
    /*
     * The same assertion as the unit test, re-run against mongo: the unit
     * version passes through memstore's query, so it proves the model's logic
     * but not that the or(eq(id),eq(email)) query actually finds the existing
     * user in a real database.
     */
    var h = await mongo.connect('user')
    var model = new UserModel(h.store, {})
    model.mail = function () { return true }
    try {
      await model.registerUser(registration())

      var conflicted = false
      try {
        await model.registerUser(registration({ email: 'different@example.com' }))
      } catch (err) {
        conflicted = true
        assert.strictEqual(err.status, 409, 'must be a Conflict')
      }
      assert.ok(conflicted, 'a duplicate username must be rejected')

      var all = (await h.store.query('eq(id,alice)&limit(10)')).getData()
      assert.strictEqual(all.length, 1, 'exactly one alice may exist')
    } finally {
      await h.teardown()
    }
  })

  await t.test('a user lookup by email finds the user case-insensitively via l_id', async function () {
    // models/user.js:181 queries id OR lowercased email. Confirms the stored
    // shape actually supports the lookup the service performs on every login.
    var h = await mongo.connect('user')
    var model = new UserModel(h.store, {})
    model.mail = function () { return true }
    try {
      await h.store.put(userDoc(), { overwrite: false })
      var byId = (await model.get('alice')).getData()
      assert.strictEqual(byId.id, 'alice')
      var byEmail = (await model.get('Alice@Example.com')).getData()
      assert.strictEqual(byEmail.id, 'alice', 'email lookup is case-insensitive')
    } finally {
      await h.teardown()
    }
  })
})
