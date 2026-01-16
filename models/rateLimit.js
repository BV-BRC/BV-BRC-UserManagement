var ModelBase = require('./base')
var util = require('util')
var uuid = require('uuid')
var When = require('promised-io/promise').when

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
  var normalizedEmail = email.toLowerCase()

  // Query using the same pattern as other models in this codebase
  var query = 'and(eq(email,' + encodeURIComponent(normalizedEmail) + '),eq(endpoint,' + endpoint + '))'

  return When(this.query(query), function (result) {
    var data = result.getData ? result.getData() : result
    if (!Array.isArray(data)) {
      return 0
    }
    // Filter to only records within the time window
    var recentCount = data.filter(function (record) {
      return record.createdAt > windowStart
    }).length
    return recentCount
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
  var normalizedEmail = email.toLowerCase()

  // Query using the same pattern as other models in this codebase
  var query = 'and(eq(email,' + encodeURIComponent(normalizedEmail) + '),eq(endpoint,' + endpoint + '))'

  return When(this.query(query), function (result) {
    var data = result.getData ? result.getData() : result
    if (!Array.isArray(data) || data.length === 0) {
      return null
    }
    // Filter to only records within the time window and find the oldest
    var recentRecords = data.filter(function (record) {
      return record.createdAt > windowStart
    })
    if (recentRecords.length === 0) {
      return null
    }
    // Sort by createdAt ascending and return the oldest
    recentRecords.sort(function (a, b) {
      return a.createdAt - b.createdAt
    })
    return recentRecords[0].createdAt
  })
}

/**
 * Clean up expired rate limit records
 * @param {number} windowMs - Time window in milliseconds (records older than this are deleted)
 * @returns {Promise} - Resolves when cleanup is complete
 */
Model.prototype.cleanup = function (windowMs) {
  var windowStart = Date.now() - windowMs
  var self = this

  // Get all records and filter to expired ones
  return When(this.query(''), function (result) {
    var data = result.getData ? result.getData() : result
    if (!Array.isArray(data) || data.length === 0) {
      return true
    }

    var expiredRecords = data.filter(function (record) {
      return record.createdAt < windowStart
    })

    if (expiredRecords.length === 0) {
      return true
    }

    // Delete expired records
    var deletePromises = expiredRecords.map(function (record) {
      return self.delete(record.id)
    })
    return Promise.all(deletePromises)
  })
}
