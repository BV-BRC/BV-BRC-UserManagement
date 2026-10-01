/*
 * Dedicated audit trail, separate from the general request/debug log.
 *
 * The general log (log.js, console.log/console.error) is unstructured prose
 * interleaved with request counts, mail URLs and driver deprecation
 * warnings -- adequate for debugging, useless for "who registered, from
 * where, when" after the fact without grepping and hand-parsing free text.
 * Security-relevant events get their own newline-delimited JSON file instead:
 * one event per line, fixed fields, parseable without knowing this service's
 * log prose.
 *
 * Where it goes: config key `audit_log_file`, an absolute path. Unset by
 * default -- local/dev runs still see every event, just via the timestamped
 * console logger with an AUDIT tag, so nothing requires extra setup to work.
 * Production sets `audit_log_file` (see p3-user.conf.example) to a path
 * outside the container filesystem, e.g. /logs/audit.log, matching the
 * `/logs` mount singularity.def already creates for pm2's combined log.
 *
 * A write failure (missing directory, read-only filesystem) falls back to
 * the console logger rather than throwing -- an audit entry that fails to
 * persist should not take the request down with it, but it must still be
 * visible somewhere.
 */

var fs = require('fs')
var path = require('path')
var config = require('./config')
var log = require('./log')

var auditFile = config.get('audit_log_file')
var stream = null

if (auditFile) {
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true })
    stream = fs.createWriteStream(auditFile, { flags: 'a' })
    stream.on('error', function (err) {
      log.error('Audit log write failed, falling back to console: ', err)
      stream = null
    })
  } catch (err) {
    log.error('Could not open audit log file ' + auditFile + ', falling back to console: ', err)
  }
}

/**
 * Record a single audit event.
 *
 * @param {String} event - short event name, e.g. 'registration_complete'
 * @param {Object} fields - event-specific data (ip, registration_site, ...).
 *   Merged with a timestamp and the event name; never includes secrets --
 *   callers must not pass passwords, tokens, or reset/verification codes.
 */
function record (event, fields) {
  var entry = Object.assign({ timestamp: new Date().toISOString(), event: event }, fields)
  var line = JSON.stringify(entry)

  if (stream) {
    stream.write(line + '\n')
  } else {
    log.log('AUDIT', line)
  }
}

/**
 * Flush and close the audit stream. Called from app.js's SIGINT handler so
 * the final event of a shutdown is not lost to an unflushed write buffer --
 * process.exit() does not wait for pending stream writes on its own.
 *
 * @return {Promise}
 */
function close () {
  return new Promise(function (resolve) {
    if (!stream) { return resolve() }
    stream.end(resolve)
  })
}

module.exports = {
  record: record,
  close: close
}
