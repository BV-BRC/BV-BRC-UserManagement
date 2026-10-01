/*
 * An in-memory dactic store, so models can be exercised without mongod.
 *
 * WHY THIS EXISTS
 *
 * The interesting logic in models/user.js runs *above* the store: mixinObject
 * property filtering, the AJV validation in Model.put, the cpProps allowlist,
 * the get -> patch -> put cycle. All of that is store-agnostic. Requiring a
 * database to test it would mean nobody runs the tests.
 *
 * The store surface dactic/model.js actually calls is small -- get, put,
 * query, delete, setSchema, getSchema (model.js:225,231,260,304,36,57) -- so
 * implementing it over a plain object is faithful for those paths.
 *
 * WHERE THIS IS *NOT* FAITHFUL -- do not assert on these here, use the
 * integration tests (test/integration/) against a real mongod instead:
 *
 *   - Duplicate-key errors. Mongo raises E11000 via a unique index; this
 *     store has no indexes. models/user.js:491 and :464 branch on that error,
 *     so those branches are integration-only.
 *   - RQL `re:` semantics. Queries run through rql/js-array, whose regex
 *     handling differs from the mongo store's parse(). Verified: the injection
 *     string `re:.*` matches nothing under js-array, but that is an artifact
 *     of js-array, NOT proof the injection is harmless against mongo. The
 *     RQL-injection tests therefore assert that utils.isValidCode() rejects
 *     the input *before* it reaches any query -- which is the actual defense
 *     (see CLAUDE.md, "RQL Injection Prevention") -- and the store-level
 *     behavior is covered against real mongo.
 *   - ObjectID coercion and the _id field.
 *
 * Queries use rql/js-array, the same RQL implementation dactic-store-mongodb
 * falls back on, so the query *strings* the model builds are genuinely parsed
 * rather than pattern-matched. Note RQL requires values to be URI-encoded --
 * an unencoded '@' throws URIError in the parser. Production code already
 * encodes (models/user.js:128,181), so a test that trips this has found a
 * real missing encodeURIComponent, not a harness limitation.
 */

var jsArray = require('rql/js-array')
var Defer = require('promised-io/promise').defer
var Result = require('dactic/result')
var errors = require('dactic/errors')

/*
 * Every store method returns a PROMISE, as dactic-store-mongodb does
 * (index.js:244-312). This is not cosmetic. promised-io's when() invokes its
 * callback inline when handed a non-promise, so a throw inside a model's
 * when() callback escapes synchronously instead of rejecting. registerUser
 * (models/user.js:130-140) throws Conflict from exactly such a callback: with
 * a synchronous store the caller sees a raw throw, with a real store it sees a
 * rejected promise. Returning promises here keeps the error semantics honest.
 */
function resolved (value) {
  var def = new Defer()
  def.resolve(value)
  return def.promise
}

function rejected (err) {
  var def = new Defer()
  def.reject(err)
  return def.promise
}

function MemStore (id, options) {
  this.id = id
  this.options = options || {}
  this.docs = Object.create(null)
  this.schema = null
  // Call log, so tests can assert a code path hit the store at all -- e.g.
  // that a rejected registration performed no write.
  this.calls = []
}

MemStore.prototype.setSchema = function (schema) {
  this.schema = schema
  return true
}

MemStore.prototype.getSchema = function () {
  return this.schema || {}
}

MemStore.prototype.get = function (id, opts) {
  this.calls.push(['get', id])
  var doc = this.docs[id]
  if (!doc) {
    return rejected(new errors.NotFound(id + ' Not Found'))
  }
  return resolved(new Result(clone(doc)))
}

MemStore.prototype.put = function (obj, opts) {
  this.calls.push(['put', obj.id])
  opts = opts || {}
  // Mirror the one store behavior the model depends on: overwrite:false must
  // not clobber an existing document. dactic-store-mongodb enforces this with
  // an insert rather than an upsert.
  if (opts.overwrite === false && this.docs[obj.id]) {
    var err = new Error('E11000 duplicate key error')
    err.code = 11000
    return rejected(err)
  }
  this.docs[obj.id] = clone(obj)
  return resolved(new Result(clone(obj)))
}

MemStore.prototype.query = function (query, opts) {
  this.calls.push(['query', query])
  var all = Object.keys(this.docs).map(function (k) { return clone(this.docs[k]) }, this)
  var matched = jsArray.query(query, {}, all)
  // js-array tags matches with internal __rqlId* keys; strip them so tests
  // compare against clean documents.
  var cleaned = matched.map(function (doc) {
    Object.keys(doc).forEach(function (k) {
      if (k.indexOf('__rql') === 0) { delete doc[k] }
    })
    return doc
  })
  return resolved(new Result(cleaned, { count: cleaned.length }))
}

MemStore.prototype.delete = function (id, opts) {
  this.calls.push(['delete', id])
  delete this.docs[id]
  return resolved(new Result(true))
}

/* Test conveniences -- not part of the dactic store contract. */

MemStore.prototype.seed = function (doc) {
  this.docs[doc.id] = clone(doc)
  return this
}

MemStore.prototype.count = function () {
  return Object.keys(this.docs).length
}

MemStore.prototype.writes = function () {
  return this.calls.filter(function (c) { return c[0] === 'put' })
}

function clone (o) {
  return JSON.parse(JSON.stringify(o))
}

module.exports = MemStore
