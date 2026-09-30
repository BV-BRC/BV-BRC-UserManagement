/*
 * The `source` field is auth-bearing, not provenance.
 *
 * It is tempting to reuse `source` to record which frontend a user registered
 * on -- it is already there (models/user.js:485), already per-user, and the
 * name fits. It must not be reused, because it feeds the token realm:
 *
 *   generateToken.js:40    realm = realm_map[user.source]
 *   middleware/token.js:9  realms = Object.values(realm_map)
 *   middleware/token.js:22 a token whose realm is not in that list is rejected
 *
 * A source value with no realm_map entry yields realm `undefined`, minting a
 * token reading `un=alice@undefined` which then fails its own realm check.
 * These tests pin that coupling so the temptation fails loudly.
 */

require('../helpers/config')()

var test = require('node:test')
var assert = require('node:assert')
var fs = require('fs')
var os = require('os')
var path = require('path')
var crypto = require('crypto')

/*
 * generateToken reads the signing key at require() time, so a throwaway
 * keypair has to exist and be pointed at before the require. Generated here
 * rather than checked in -- *.pem is gitignored, and a committed private key
 * is a bad habit even for tests.
 */
var keydir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3user-test-keys-'))
var privPath = path.join(keydir, 'private.pem')
var pubPath = path.join(keydir, 'public.pem')
var pair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
fs.writeFileSync(privPath, pair.privateKey)
fs.writeFileSync(pubPath, pair.publicKey)

var config = require('../../config')
config.set('signing_PEM', privPath)
config.set('signing_public_PEM', pubPath)
config.set('signingSubjectURL', 'http://user.test.local:3002/public_key')

var generateToken = require('../../generateToken')

function fieldOf (token, name) {
  var hit = token.split('|').filter(function (p) { return p.indexOf(name + '=') === 0 })[0]
  // Split on the FIRST '=' only. SigningSubject is a URL and may contain '='
  // in a query string; split('=')[1] truncates it. See CLAUDE.md.
  return hit ? hit.slice(name.length + 1) : undefined
}

test('a known source maps to a valid realm', function () {
  var token = generateToken({ id: 'alice', source: 'bvbrc', roles: [] }, 'user')
  assert.strictEqual(fieldOf(token, 'un'), 'alice@bvbrc')
})

test('an unmapped source produces un=<user>@undefined', function () {
  /*
   * The exact failure that reusing `source` for site provenance would cause.
   * It is not a thrown error -- it is a structurally valid token carrying a
   * garbage realm, which then fails validation at middleware/token.js and
   * presents to the user as an unexplained login failure.
   */
  var token = generateToken({ id: 'alice', source: 'maage', roles: [] }, 'user')
  assert.strictEqual(fieldOf(token, 'un'), 'alice@undefined',
    'an unmapped source silently yields realm "undefined"')
})

test('the realm from an unmapped source is rejected by the middleware realm list', function () {
  // Mirrors middleware/token.js:9-11 and :22-25.
  var realmMap = config.get('realm_map')
  var realms = Object.keys(realmMap).map(function (k) { return realmMap[k] })

  var good = generateToken({ id: 'alice', source: 'bvbrc', roles: [] }, 'user')
  var bad = generateToken({ id: 'alice', source: 'maage', roles: [] }, 'user')

  assert.ok(realms.indexOf(fieldOf(good, 'un').split('@')[1]) >= 0,
    'a mapped source passes the realm check')
  assert.ok(realms.indexOf(fieldOf(bad, 'un').split('@')[1]) < 0,
    'an unmapped source fails the realm check -- the account cannot log in')
})

test('token signature verifies against the public key', function () {
  // Guards the payload assembly in generateToken.js:42-57: the signature
  // covers the joined payload, and sig is appended after.
  var token = generateToken({ id: 'alice', source: 'bvbrc', roles: ['admin'] }, 'user')
  var sig = fieldOf(token, 'sig')
  var payload = token.slice(0, token.length - ('|sig=' + sig).length)

  var verify = crypto.createVerify('RSA-SHA1')
  verify.update(payload)
  assert.ok(verify.verify(pair.publicKey, sig, 'hex'), 'signature must verify')
})

test('SigningSubject survives a value containing = (first-split parsing)', function () {
  /*
   * CLAUDE.md records this as a real defect class: SigningSubject is a URL,
   * and if it carries a query string, split('=')[1] truncates it, breaking
   * both the subject match and signature verification.
   */
  config.set('signingSubjectURL', 'http://user.test.local:3002/public_key?v=2')
  delete require.cache[require.resolve('../../generateToken')]
  var gen = require('../../generateToken')

  var token = gen({ id: 'alice', source: 'bvbrc', roles: [] }, 'user')
  assert.strictEqual(fieldOf(token, 'SigningSubject'),
    'http://user.test.local:3002/public_key?v=2',
    'the full URL including its query string must round-trip')

  var naive = token.split('|').filter(function (p) {
    return p.indexOf('SigningSubject=') === 0
  })[0].split('=')[1]
  assert.notStrictEqual(naive, 'http://user.test.local:3002/public_key?v=2',
    'demonstrates why split("=")[1] is wrong -- it truncates at the query string')

  config.set('signingSubjectURL', 'http://user.test.local:3002/public_key')
  delete require.cache[require.resolve('../../generateToken')]
})

test.after(function () {
  fs.rmSync(keydir, { recursive: true, force: true })
})
