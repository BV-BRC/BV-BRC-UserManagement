/*
 * RQL injection defenses.
 *
 * Reset and verification codes are interpolated into RQL query strings
 * (routes/reset.js:41,71 and routes/verify.js:34). The defense is two-layer,
 * per CLAUDE.md "RQL Injection Prevention": validate the format with
 * utils.isValidCode(), THEN encodeURIComponent() before interpolating.
 *
 * These tests target the validator, deliberately. Asserting "the malicious
 * query returns no rows" against the in-memory store would be misleading:
 * rql/js-array's `re:` handling differs from the mongo store's, so a pass
 * there would say nothing about production. The validator is the layer that
 * is actually load-bearing and is storage-independent. Store-level behavior
 * is covered in test/integration/ against real mongo.
 */

var test = require('node:test')
var assert = require('node:assert')
var utils = require('../../utils')

test('isValidCode accepts exactly the generated format', function () {
  // randomstring.generate(5).toUpperCase() -- models/user.js:267,322
  assert.ok(utils.isValidCode('AB12C'))
  assert.ok(utils.isValidCode('00000'))
  assert.ok(utils.isValidCode('ZZZZZ'))
})

test('isValidCode rejects the RQL operator prefixes', function () {
  /*
   * `re:.*` is the dangerous one: as a regex it matches ANY stored code, so
   * an attacker could reset an arbitrary account without knowing its code.
   * The comparison operators would likewise widen the match set.
   */
  var attacks = ['re:.*', 're:^A', 'gt:0', 'lt:ZZZZZ', 'ge:0', 'le:Z',
    'or(eq(id,admin))', 'and(eq(id,admin))', '*', '.*']
  attacks.forEach(function (bad) {
    assert.strictEqual(utils.isValidCode(bad), false, 'must reject: ' + bad)
  })
})

test('isValidCode rejects lowercase, wrong length, and padding tricks', function () {
  var bad = ['ab12c', 'AB12', 'AB12CD', '', ' AB12C', 'AB12C ', 'AB 2C', 'AB-2C',
    'AB12C\n', '\nAB12C', 'AB12C%00']
  bad.forEach(function (v) {
    assert.strictEqual(utils.isValidCode(v), false, 'must reject: ' + JSON.stringify(v))
  })
})

test('isValidCode rejects non-string input without throwing', function () {
  /*
   * req.params values are strings, but body-parsed input is not guaranteed to
   * be -- an array or object reaching the validator must be rejected, not
   * crash it. Notably /^[A-Z0-9]{5}$/.test(x) coerces its argument, so an
   * array like ['AB12C'] would PASS a bare regex test. The typeof guard in
   * isValidCode is what stops that.
   */
  var bad = [undefined, null, 0, 12345, true, {}, [], ['AB12C'], { toString: function () { return 'AB12C' } }]
  bad.forEach(function (v) {
    assert.strictEqual(utils.isValidCode(v), false, 'must reject: ' + JSON.stringify(v))
  })
})

test('a bare regex test would accept an array -- the typeof guard is load-bearing', function () {
  // Demonstrates the above rather than asserting it indirectly, so the reason
  // for the typeof check survives future refactoring.
  assert.strictEqual(/^[A-Z0-9]{5}$/.test(['AB12C']), true,
    'JS coerces the array to its single element')
  assert.strictEqual(utils.isValidCode(['AB12C']), false,
    'isValidCode must still reject it')
})

test('encodeURIComponent neutralizes the RQL metacharacters that survive validation', function () {
  /*
   * Second layer. Email addresses are interpolated too (routes/reset.js:41)
   * and are NOT format-validated, so encoding is the only defense there.
   * An unencoded '(' or ',' would change the query's structure.
   */
  assert.strictEqual(encodeURIComponent('re:.*'), 're%3A.*')
  assert.strictEqual(encodeURIComponent('a@b.com'), 'a%40b.com')
  assert.strictEqual(encodeURIComponent('x),eq(id,admin'), 'x)%2Ceq(id%2Cadmin')
  // ',' and ':' are the structural separators; both get escaped.
  assert.ok(encodeURIComponent('a,b').indexOf(',') === -1, 'comma must be escaped')
})

test('an unencoded @ throws in the RQL parser -- encoding is not optional', function () {
  /*
   * Not merely a hardening measure: rql/parser.js:119 raises URIError on a
   * raw '@'. Since every email query interpolates an address, omitting
   * encodeURIComponent is an immediate 500, not a silent weakening. Pinned so
   * that a future "simplification" that drops the encoding fails here.
   */
  var jsArray = require('rql/js-array')
  assert.throws(function () {
    jsArray.query('eq(email,a@b.com)', {}, [])
  }, /Illegal character/)
  assert.doesNotThrow(function () {
    jsArray.query('eq(email,' + encodeURIComponent('a@b.com') + ')', {}, [])
  })
})
