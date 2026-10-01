/*
 * Timestamped stdout/stderr logging.
 *
 * Every console.log/console.error call in this service writes to stdout with
 * no timestamp, relying entirely on whatever wraps the process (pm2's
 * log_file, or a terminal) to add one. pm2 does not by default -- see
 * singularity/default_pm2_config.js, which just redirects stdout/stderr to a
 * flat file -- so lines in production have no time information at all and
 * cannot be correlated against anything else (a report of abuse at a given
 * time, another service's logs, a mongo oplog entry).
 *
 * log.log()/log.error() are drop-in replacements for console.log/
 * console.error that prefix an ISO-8601 timestamp. They do not replace
 * console.log everywhere in one pass -- callers are migrated incrementally --
 * so both forms coexist during that migration.
 */

function timestamp () {
  return new Date().toISOString()
}

function log () {
  var args = Array.prototype.slice.call(arguments)
  console.log.apply(console, ['[' + timestamp() + ']'].concat(args))
}

function error () {
  var args = Array.prototype.slice.call(arguments)
  console.error.apply(console, ['[' + timestamp() + ']'].concat(args))
}

module.exports = {
  log: log,
  error: error
}
