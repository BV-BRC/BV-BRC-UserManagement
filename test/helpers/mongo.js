/*
 * Scratch-mongo plumbing for the integration layer.
 *
 * Activated by P3_USER_TEST_MONGO_URL. When it is unset every integration
 * test SKIPS rather than fails -- the unit layer must stay runnable with no
 * infrastructure at all, or nobody runs it.
 *
 *   P3_USER_TEST_MONGO_URL=mongodb://127.0.0.1:27017 npm run test:integration
 *
 * SAFETY: the database name is generated per run (p3_user_test_<pid>_<n>) and
 * dropped afterwards. Supply a URL WITHOUT a database path -- if the URL
 * carries one it is ignored, since dactic-store-mongodb takes the db name from
 * options.db (index.js:33-40). A scratch server is still strongly preferred:
 * these tests create and drop databases.
 *
 * Note 127.0.0.1:27017 may be the stub TCP listener from CLAUDE.md's
 * "Verifying changes without a test suite", which accepts connections and
 * never replies. That is indistinguishable from a slow mongod at connect
 * time, so available() applies a short timeout and reports unavailable rather
 * than hanging the suite.
 */

var MongoStore = require('dactic-store-mongodb')
var MongoClient = require('mongodb').MongoClient

var URL = process.env.P3_USER_TEST_MONGO_URL
var CONNECT_TIMEOUT_MS = 3000
var counter = 0

var DRIVER_OPTS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
  connectTimeoutMS: CONNECT_TIMEOUT_MS
}

/*
 * node:test skips a test when the `skip` option is a truthy string, so this
 * doubles as both the predicate and the human-readable reason.
 */
function skipReason () {
  if (!URL) {
    return 'P3_USER_TEST_MONGO_URL is not set -- integration tests need a scratch mongod'
  }
  return false
}

function dbName () {
  counter += 1
  return 'p3_user_test_' + process.pid + '_' + counter
}

/*
 * Builds a connected store against a fresh scratch database. Returns a
 * teardown that drops it, so a failed run leaves nothing behind.
 *
 * DO NOT call store.connect() here. dactic/store.js:18 calls init(), which
 * calls connect(), from the Store *constructor* -- so `new MongoStore(...)`
 * has already opened a MongoClient by the time this function returns. Calling
 * connect() again opens a SECOND client; closing only the second leaves the
 * first's sockets open and the node process never exits. That is what hung the
 * first real-mongod run of this suite: every test reported, then the runner sat
 * there forever.
 *
 * Wait on store.initialized (dactic/store.js:13,36) instead, and reach the
 * driver through the Db the store is actually using. There is no back-pointer
 * from Db to MongoClient in driver 3.5, so teardown closes the topology --
 * db.s.topology.close() -- which is the shared connection pool. Verified: zero
 * active handles afterwards.
 */
function connect (collection) {
  var db = dbName()
  var store = new MongoStore(collection || 'user', {
    url: URL,
    db: db,
    primaryKey: 'id',
    opts: DRIVER_OPTS
  })

  return Promise.resolve(store.initialized.promise).then(function () {
    var handle = store.client // a Db, not a MongoClient
    return {
      store: store,
      db: db,
      dbHandle: handle,
      teardown: function () {
        // Drop first, then close -- the reverse order silently leaves the
        // scratch database behind on the server.
        return Promise.resolve(handle.dropDatabase())
          .then(function () { return handle.s.topology.close() })
      }
    }
  })
}

/*
 * Probes the configured URL once. Cached, so N test files do not each pay the
 * connect timeout when the server is absent.
 *
 * Uses the raw driver rather than store.connect() deliberately.
 * dactic-store-mongodb/index.js:44-47 rejects its deferred on a connect error
 * and then falls through to resolve the SAME deferred -- there is no return
 * -- so promised-io throws "This deferred has already been resolved" out of
 * the driver callback, after the failure has already been handled. Against an
 * unreachable endpoint that async throw crashes the run even though the skip
 * logic worked. Probing directly keeps a clean skip; the store's own connect
 * is still used for real connections, where that path is not taken.
 */
var probe = null
function available () {
  if (!URL) { return Promise.resolve(false) }
  if (!probe) {
    probe = MongoClient.connect(URL, DRIVER_OPTS).then(function (client) {
      return client.close().then(function () { return true })
    }).catch(function () { return false })
  }
  return probe
}

/*
 * Runs `fn` and resolves to the error it produces, whether that error arrives
 * as a rejection or as an uncaught exception.
 *
 * Needed because dactic-store-mongodb/index.js:300 does
 *
 *     deferred.reject(id + " exists, and can't be overwritten");
 *
 * where `id` was never declared in that scope. Evaluating the argument throws
 * a ReferenceError *before* reject() is called, inside a driver callback, on a
 * later tick -- so the rejection never happens and the process dies with an
 * uncaught exception instead. A plain try/catch around an await cannot see it.
 *
 * The refusal itself is correct and load-bearing (the document is not
 * clobbered); only its reporting is broken. Capturing it here lets the test
 * assert the behavior that matters without the crash taking the runner down.
 * If this ever starts arriving as an ordinary rejection, dactic-store-mongodb
 * has been fixed and the test still passes.
 *
 * setUncaughtExceptionCaptureCallback, not process.on('uncaughtException'):
 * node:test installs its own uncaughtException listener and attributes
 * whatever it catches to the currently-running test, so an ordinary listener
 * loses the race and the test fails anyway. The capture callback takes
 * precedence over all listeners, including the runner's. It is process-wide
 * and cannot nest, so this is scoped as tightly as possible and always
 * cleared.
 */
function captureError (fn) {
  return new Promise(function (resolve, reject) {
    var done = false
    var timer = null

    function finish (err) {
      if (done) { return }
      done = true
      if (timer) { clearTimeout(timer) }
      try {
        process.setUncaughtExceptionCaptureCallback(null)
      } catch (e) { /* already cleared */ }
      resolve(err)
    }

    try {
      process.setUncaughtExceptionCaptureCallback(finish)
    } catch (e) {
      return reject(new Error('captureError cannot nest: ' + e.message))
    }

    Promise.resolve()
      .then(fn)
      .then(
        // Resolving is not proof of success -- the throw we are hunting
        // happens on a later tick than the promise settles. Give it one.
        function () { timer = setTimeout(function () { finish(null) }, 250) },
        function (err) { finish(err || new Error('rejected with a falsy value')) }
      )
  })
}

module.exports = {
  URL: URL,
  skipReason: skipReason,
  connect: connect,
  available: available,
  captureError: captureError
}
