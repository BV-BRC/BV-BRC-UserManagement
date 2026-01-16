var ModelBase = require('./base')
var util = require('util')
var uuid = require('uuid')
var When = require('promised-io/promise').when

var Model = module.exports = function (store, opts) {
  this.store = store  // Keep reference to the MongoDB store
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
 * Count requests within a time window using direct MongoDB query
 * @param {string} email - Email address
 * @param {string} endpoint - Endpoint name
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<number>} - Resolves with count of requests
 */
Model.prototype.countRequests = function (email, endpoint, windowMs) {
  var windowStart = Date.now() - windowMs
  var normalizedEmail = email.toLowerCase()
  var self = this

  return new Promise(function (resolve, reject) {
    // Access the underlying MongoDB collection directly
    self.store.getCollection(function (err, collection) {
      if (err) {
        console.error('Error getting collection:', err)
        return resolve(0) // Fail open
      }

      collection.countDocuments({
        email: normalizedEmail,
        endpoint: endpoint,
        createdAt: { $gt: windowStart }
      }, function (err, count) {
        if (err) {
          console.error('Error counting documents:', err)
          return resolve(0) // Fail open
        }
        resolve(count)
      })
    })
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
  var self = this

  return new Promise(function (resolve, reject) {
    // Access the underlying MongoDB collection directly
    self.store.getCollection(function (err, collection) {
      if (err) {
        console.error('Error getting collection:', err)
        return resolve(null)
      }

      collection.find({
        email: normalizedEmail,
        endpoint: endpoint,
        createdAt: { $gt: windowStart }
      }).sort({ createdAt: 1 }).limit(1).toArray(function (err, docs) {
        if (err) {
          console.error('Error finding oldest document:', err)
          return resolve(null)
        }
        if (docs && docs.length > 0) {
          resolve(docs[0].createdAt)
        } else {
          resolve(null)
        }
      })
    })
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

  return new Promise(function (resolve, reject) {
    self.store.getCollection(function (err, collection) {
      if (err) {
        console.error('Error getting collection for cleanup:', err)
        return resolve(true)
      }

      collection.deleteMany({
        createdAt: { $lt: windowStart }
      }, function (err, result) {
        if (err) {
          console.error('Error deleting expired records:', err)
        }
        resolve(true)
      })
    })
  })
}
