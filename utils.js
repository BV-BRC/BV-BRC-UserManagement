/**
 * Return a unique identifier with the given `len`.
 *
 *     utils.uid(10);
 *     // => "FDaS435D2z"
 *
 * @param {Number} len
 * @return {String}
 * @api private
 */
exports.uid = function (len) {
  var buf = []
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  var charlen = chars.length

  for (var i = 0; i < len; ++i) {
    buf.push(chars[getRandomInt(0, charlen - 1)])
  }

  return buf.join('')
}

/**
 * Return a random int, used by `utils.uid()`
 *
 * @param {Number} min
 * @param {Number} max
 * @return {Number}
 * @api private
 */

function getRandomInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Validate that a code parameter is safe for use in RQL queries.
 * Reset/verification codes are 5-character uppercase alphanumeric strings.
 * This prevents RQL injection attacks (e.g., "re:.*" regex patterns).
 *
 * @param {String} code - The code to validate
 * @return {Boolean} - true if valid, false otherwise
 */
exports.isValidCode = function (code) {
  if (!code || typeof code !== 'string') {
    return false
  }
  // Codes are generated with randomstring.generate(5).toUpperCase()
  // They should be exactly 5 uppercase alphanumeric characters
  return /^[A-Z0-9]{5}$/.test(code)
}
