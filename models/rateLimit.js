var ModelBase = require('./base')
var util = require('util')
var uuid = require('uuid')
var config = require('../config')
var MongoClient = require('mongodb').MongoClient

var Model = module.exports = function (store, opts) {
  ModelBase.apply(this, arguments)
  this._mongoClient = null
  this._collection = null
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
 * Get or create MongoDB collection connection
 */
Model.prototype._getCollection = function () {
  var self = this

  if (self._collection) {
    return Promise.resolve(self._collection)
  }

  var mongoConfig = config.get('mongo')
  var url = mongoConfig.url
  var dbName = mongoConfig.db

  return MongoClient.connect(url, { useUnifiedTopology: true })
    .then(function (client) {
      self._mongoClient = client
      var db = client.db(dbName)
      self._collection = db.collection('rateLimit')
      return self._collection
    })
    .catch(function (err) {
      console.error('Failed to connect to MongoDB for rate limiting:', err)
      return null
    })
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

  return this._getCollection()
    .then(function (collection) {
      if (!collection) return null
      return collection.insertOne(record)
    })
    .catch(function (err) {
      console.error('Error recording rate limit request:', err)
      return null
    })
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

  return this._getCollection()
    .then(function (collection) {
      if (!collection) return 0
      return collection.countDocuments({
        email: normalizedEmail,
        endpoint: endpoint,
        createdAt: { $gt: windowStart }
      })
    })
    .catch(function (err) {
      console.error('Error counting rate limit requests:', err)
      return 0 // Fail open
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

  return this._getCollection()
    .then(function (collection) {
      if (!collection) return null
      return collection.find({
        email: normalizedEmail,
        endpoint: endpoint,
        createdAt: { $gt: windowStart }
      }).sort({ createdAt: 1 }).limit(1).toArray()
    })
    .then(function (docs) {
      if (docs && docs.length > 0) {
        return docs[0].createdAt
      }
      return null
    })
    .catch(function (err) {
      console.error('Error getting oldest rate limit request:', err)
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

  return this._getCollection()
    .then(function (collection) {
      if (!collection) return true
      return collection.deleteMany({
        createdAt: { $lt: windowStart }
      })
    })
    .then(function () {
      return true
    })
    .catch(function (err) {
      console.error('Error cleaning up rate limit records:', err)
      return true
    })
}
