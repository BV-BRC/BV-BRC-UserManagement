/*
 * Test configuration.
 *
 * config.js is an nconf singleton evaluated at require() time, and it reads
 * P3_USER_CONFIG from the environment. So this must be required BEFORE
 * anything that pulls in ../../config -- which is nearly every module in the
 * service. Requiring it first in each test file is what keeps the tests from
 * reading a developer's real p3-user.conf (or failing outright when there
 * isn't one, since models/user.js throws without sha_salt).
 *
 * Nothing here talks to mongo. See memstore.js for why that is possible.
 */

var fs = require('fs')
var os = require('os')
var path = require('path')

var FIXTURE = {
  sha_salt: 'test-salt-not-a-real-secret',
  mongo: { url: 'mongodb://127.0.0.1:27017', db: 'p3_user_test' },
  siteURL: 'http://user.test.local:3002',
  p3Home: 'http://test.local',
  default_source: 'bvbrc',
  realm_map: {
    'patricbrc.org': 'patricbrc.org',
    viprbrc: 'bvbrc',
    bvbrc: 'bvbrc'
  },
  email: { localSendmail: false, defaultFrom: 'test@test.local', host: 'localhost', port: 25 },
  userTokenDuration: 24,
  serviceTokenDuration: 744,
  cors_origins: []
}

/*
 * Written to a temp file rather than injected, because config.js only accepts
 * a file path. Left on disk for the process lifetime; the OS reaps it.
 */
function install (overrides) {
  var conf = Object.assign({}, FIXTURE, overrides || {})
  var file = path.join(os.tmpdir(), 'p3-user-test-' + process.pid + '.conf')
  fs.writeFileSync(file, JSON.stringify(conf))
  process.env.P3_USER_CONFIG = file
  return file
}

module.exports = install
module.exports.FIXTURE = FIXTURE
