var DataModel = require('../dataModel')
var when = require('promised-io/promise').when
var debug = require('debug')('rateLimit')

/**
 * Rate limiting middleware factory
 * @param {Object} options - Configuration options
 * @param {number} options.maxRequests - Maximum requests allowed in the window (default: 3)
 * @param {number} options.windowMs - Time window in milliseconds (default: 1 hour)
 * @param {string} options.endpoint - Endpoint name for tracking (default: 'default')
 * @param {Function} options.keyFn - Function to extract rate limit key from request (default: req.body.email)
 * @param {string} options.message - Error message to return (default: 'Too many requests')
 * @returns {Function} Express middleware function
 */
module.exports = function (options) {
  options = options || {}
  var maxRequests = options.maxRequests || 3
  var windowMs = options.windowMs || (60 * 60 * 1000) // 1 hour default
  var endpoint = options.endpoint || 'default'
  var keyFn = options.keyFn || function (req) { return req.body && req.body.email }
  var message = options.message || 'Too many requests. Please try again later.'

  return function rateLimitMiddleware (req, res, next) {
    var RateLimitModel = DataModel.get('rateLimit')

    if (!RateLimitModel) {
      console.error('Rate limit model not found!')
      return next()
    }

    // Extract the key (email) from the request
    var key = keyFn(req)
    if (!key) {
      // No key to rate limit by, continue
      return next()
    }

    key = key.toLowerCase()

    console.log('Rate limit check for:', key, 'endpoint:', endpoint)

    // Count existing requests in the window
    when(RateLimitModel.countRequests(key, endpoint, windowMs), function (count) {
      console.log('Rate limit count:', count, 'max:', maxRequests)

      if (count >= maxRequests) {
        // Rate limited - calculate retry-after
        when(RateLimitModel.getOldestRequestTime(key, endpoint, windowMs), function (oldestTime) {
          var retryAfter = Math.ceil((oldestTime + windowMs - Date.now()) / 1000)
          if (retryAfter < 0) retryAfter = 60 // fallback to 1 minute

          console.log('Rate limit exceeded! Retry after:', retryAfter, 'seconds')

          res.set('Retry-After', retryAfter)
          res.status(429)
          res.json({
            error: 'Too Many Requests',
            message: message,
            retryAfter: retryAfter
          })
        }, function (err) {
          // Error getting oldest time, still return 429
          console.error('Error getting oldest request time:', err)
          res.set('Retry-After', 3600)
          res.status(429)
          res.json({
            error: 'Too Many Requests',
            message: message,
            retryAfter: 3600
          })
        })
      } else {
        // Record this request and continue
        when(RateLimitModel.recordRequest(key, endpoint), function () {
          console.log('Rate limit request recorded for:', key)
          next()
        }, function (err) {
          // Error recording request, log but continue (fail open)
          console.error('Error recording rate limit request:', err)
          next()
        })
      }
    }, function (err) {
      // Error checking rate limit, log but continue (fail open)
      console.error('Error checking rate limit:', err)
      next()
    })
  }
}
