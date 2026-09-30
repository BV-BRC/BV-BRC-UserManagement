/*
 * Builds a user model backed by the in-memory store.
 *
 * Requires test/helpers/config.js first: models/user.js reads sha_salt at
 * CONSTRUCTION time (models/user.js:32-35) and throws without it.
 */

require('./config')()

var MemStore = require('./memstore')
var UserModel = require('../../models/user')

/*
 * A registration-shaped document. Only the fields dactic requires -- see
 * schema.required in models/user.js:108 -- plus whatever the test overrides.
 * l_id/creationDate/updateDate/createdBy/updatedBy/source are all set by
 * Model.post (models/user.js:473-496), so callers must not supply them.
 */
function userFixture (overrides) {
  return Object.assign({
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Anderson'
  }, overrides || {})
}

function build (opts) {
  opts = opts || {}

  /*
   * opts.config sets keys on the live nconf singleton. config.js is required
   * once per process, so this mutates shared state -- fine because each key
   * is set fresh on every build() and the tests that use it always pass the
   * keys they depend on. Anything reading config at require() time (e.g.
   * generateToken's signing key) is NOT affected by this and must be set up
   * before the require instead; see token-realm.test.js.
   */
  if (opts.config) {
    var config = require('../../config')
    Object.keys(opts.config).forEach(function (k) {
      config.set(k, opts.config[k])
    })
  }

  var store = new MemStore('user', {})
  var model = new UserModel(store, {})

  // The mail transport would otherwise try real SMTP. Tests that care about
  // mail assert on this log; tests that don't just need it not to hang.
  model.sent = []
  if (opts.stubMail !== false) {
    model.mail = function (userId, message, subject) {
      var id = (typeof userId === 'object') ? userId.id : userId
      model.sent.push({ to: id, subject: subject, message: message })
      return true
    }
  }

  return { model: model, store: store }
}

module.exports = build
module.exports.userFixture = userFixture
