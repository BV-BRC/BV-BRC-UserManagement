var ModelBase = require('./base')
var util = require('util')
var uuid = require('uuid')

var Model = module.exports = function (store, opts) {
  ModelBase.apply(this, arguments)
}

util.inherits(Model, ModelBase)

Model.prototype.primaryKey = 'id'
Model.prototype.maxLimit = 999999
Model.prototype.defaultLimit = 100
Model.prototype.schema = {
  'description': 'Rate Limit Schema',
  'properties': {
    id: {
      type: 'string',
      description: 'Unique identifier'
    },
    email: {
      type: 'string',
      description: 'Email address being rate limited'
    },
    endpoint: {
      type: 'string',
      description: 'Endpoint being rate limited (e.g., /reset, /verify)'
    },
    createdAt: {
      type: 'number',
      description: 'Timestamp when the request was made'
    }
  }
}

/**
 * Record a rate-limited request
 * @param {string} email - Email address
 * @param {string} endpoint - Endpoint name
 * @returns {Promise} - Resolves when record is created
 */
Model.prototype.recordRequest = function (email, endpoint) {
  var record = {
    id: uuid.v4(),
    email: email.toLowerCase(),
    endpoint: endpoint,
    createdAt: Date.now()
  }
  return this.post(record)
}

/**
 * Count requests within a time window
 * @param {string} email - Email address
 * @param {string} endpoint - Endpoint name
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<number>} - Resolves with count of requests
 */
Model.prototype.countRequests = function (email, endpoint, windowMs) {
  var windowStart = Date.now() - windowMs
  var query = 'and(eq(email,' + encodeURIComponent(email.toLowerCase()) + '),eq(endpoint,' + endpoint + '),gt(createdAt,' + windowStart + '))'
  return this.query(query, { select: 'id' }).then(function (result) {
    return result.length
  })
}

/**
 * Get the oldest request timestamp within a window (for Retry-After calculation)
 * @param {string} email - Email address
 * @param {string} endpoint - Endpoint name
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<number|null>} - Resolves with oldest timestamp or null
 */
Model.prototype.getOldestRequestTime = function (email, endpoint, windowMs) {
  var windowStart = Date.now() - windowMs
  var query = 'and(eq(email,' + encodeURIComponent(email.toLowerCase()) + '),eq(endpoint,' + endpoint + '),gt(createdAt,' + windowStart + '))'
  return this.query(query, { select: 'createdAt', sort: '+createdAt', limit: 1 }).then(function (result) {
    if (result.length > 0) {
      return result[0].createdAt
    }
    return null
  })
}

/**
 * Clean up expired rate limit records
 * @param {number} windowMs - Time window in milliseconds (records older than this are deleted)
 * @returns {Promise} - Resolves when cleanup is complete
 */
Model.prototype.cleanup = function (windowMs) {
  var windowStart = Date.now() - windowMs
  var query = 'lt(createdAt,' + windowStart + ')'
  var self = this
  return this.query(query, { select: 'id' }).then(function (result) {
    if (result.length === 0) {
      return Promise.resolve()
    }
    var deletePromises = result.map(function (record) {
      return self.delete(record.id)
    })
    return Promise.all(deletePromises)
  })
}
