/*
 * Characterization tests for dactic@0.8.12 behavior this service depends on.
 *
 * These assert on a THIRD-PARTY library, deliberately. dactic is pinned and
 * unmaintained (0.8.12 is the newest published release -- see CLAUDE.md
 * "Dependencies"), and two of its behaviors are load-bearing in ways that are
 * not obvious from reading models/user.js. Both were discovered by probing the
 * installed library while planning the registration_site field, and both would
 * have caused a production defect if assumed the other way.
 *
 * If dactic is ever forked or upgraded, these are the tests that tell you what
 * silently changed.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var AJV = require('ajv')
var ModelBase = require('dactic/model')
var UserModel = require('../../models/user')

test('mixinObject copies properties that are NOT declared in the schema', function () {
  /*
   * This is the real gate on persistence, and it is counter-intuitive:
   * mixinObject iterates schema.properties (dactic/model.js:118), but then
   * dactic/model.js:196-215 copies every *undeclared* property through as
   * well. So declaring a field in the schema is documentation, not plumbing.
   *
   * Consequence for adding any new user field: the schema entry is optional,
   * but the cpProps allowlist in registerUser is NOT. See
   * registration-site.test.js.
   *
   * `source` proves the point in shipped code -- models/user.js:485 writes it
   * and it persists, despite never appearing in schema.properties.
   */
  var m = Object.create(ModelBase.prototype)
  m.schema = UserModel.prototype.schema

  var out = m.mixinObject({}, {
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    roles: [],
    creationDate: 'x',
    updateDate: 'x',
    createdBy: 'system',
    updatedBy: 'system',
    source: 'bvbrc',
    undeclared_field: 'survives'
  })

  assert.strictEqual(out.undeclared_field, 'survives',
    'an undeclared property must survive mixinObject')
  assert.strictEqual(out.source, 'bvbrc',
    'source is undeclared in the schema yet is shipped and must persist')
})

test('mixinObject drops properties whose names begin with underscore', function () {
  // dactic/model.js:210 treats these as transient. Worth pinning: a field
  // named _foo would silently never persist.
  var m = Object.create(ModelBase.prototype)
  m.schema = UserModel.prototype.schema

  var out = m.mixinObject({}, {
    id: 'alice',
    l_id: 'alice',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson',
    roles: [],
    creationDate: 'x',
    updateDate: 'x',
    createdBy: 'system',
    updatedBy: 'system',
    _transient: 'dropped'
  })

  assert.ok(!('_transient' in out), 'underscore-prefixed properties are transient')
})

test('an enum in the schema makes stale records permanently unsaveable', function () {
  /*
   * THE HAZARD. Model.patch (dactic/model.js:286-298) is
   * get -> apply patch -> put, and Model.put (dactic/model.js:233-247) runs
   * AJV over the ENTIRE document, not just the changed fields.
   *
   * So if a field carries an `enum` and a stored record holds a value later
   * removed from that enum, every subsequent write to that user fails:
   * no password reset, no email verification, no profile edit. The account is
   * bricked, and nothing surfaces until that user tries to do something.
   *
   * This is why registration_site must NOT use a schema enum, and validates
   * in application code against config instead. Retiring a site from the
   * config list is then a no-op for existing users.
   */
  var schema = {
    description: 'probe',
    properties: {
      id: { type: 'string' },
      site: { type: 'string', enum: ['bvbrc', 'maage'] }
    },
    required: ['id']
  }
  var ajv = new AJV({ v5: true, allErrors: true, verbose: true, useDefaults: true })

  assert.strictEqual(ajv.validate(schema, { id: 'a' }), true,
    'absent enum field is valid -- so an optional field is safe to add')
  assert.strictEqual(ajv.validate(schema, { id: 'a', site: 'maage' }), true,
    'a current value is valid')
  assert.strictEqual(ajv.validate(schema, { id: 'a', site: 'retired-site' }), false,
    'a RETIRED value fails -- this is the bricking case')
  assert.strictEqual(ajv.validate(schema, { id: 'a', site: '' }), false,
    'empty string also fails an enum, so a blank write would brick too')
})

test('the shipped user schema declares no enum on any property', function () {
  // A regression guard on the above: if someone adds an enum to the user
  // schema, this fails and points them at the reasoning.
  var props = UserModel.prototype.schema.properties
  Object.keys(props).forEach(function (name) {
    assert.ok(!props[name].enum,
      "property '" + name + "' declares an enum; see the bricking test above " +
      '-- validate in application code against config instead')
  })
})
