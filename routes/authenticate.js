var express = require('express')
var router = express.Router()
var bodyParser = require('body-parser')
var DataModel = require('../dataModel')
var when = require('promised-io/promise').when
var errors = require('dactic/errors')
var UserModel = DataModel.get('user')
var generateToken = require('../generateToken')
var validateToken = require('../validateToken')
var bcrypt = require('bcrypt')

/* Basic Password auth */
router.post('/', [
  bodyParser.urlencoded({extended: true}),
  function (req, res, next) {
    if (!req.body.username || !req.body.password) {
      return next(new errors.Unauthorized('Missing Username or Password'))
    }

    when(UserModel.validatePassword(req.body.username, req.body.password), function (ruser) {
      var user = ruser.getData()
      if (user) {
        var token = generateToken(user, 'user')
        res.status(200)
        res.send(token)
        res.end()
      } else {
        next(errors.Unauthorized('Invalid username, email, or password'))
      }
    }, function (err) {
      next(errors.Unauthorized('Invalid username, email, or password'))
    })
  }
])

/* Superuser Login */
router.post('/sulogin', [
  bodyParser.urlencoded({extended: true}),
  function (req, res, next) {
    console.log('Authenticate User Token: ', req.body)

    if (!req.body.username || !req.body.password || !req.body.targetUser) {
      return next(new errors.Unauthorized('Missing Username, Password, or Target User'))
    }

    console.log('Get User: ', req.body.username)
    when(UserModel.get(req.body.username), function (ruser) {
      var user = ruser.getData()
      console.log('Got Login User: ', user)
      if (!user || !user.roles || (user.roles.length < 1) || (user.roles.indexOf('admin') < 0)) {
        return next(errors.Unauthorized())
      }

      bcrypt.compare(req.body.password, user.password, function (err, response) {
        console.log('Authenticated')
        if (err) { console.log('Invalid Password'); next(errors.Unauthorized(err)) }
        when(UserModel.get(req.body.targetUser), function (tres) {
          if (!tres) {
            return next(errors.NotAcceptable('Invalid Target User'))
          }
          var tuser = tres.getData()

          console.log('Target User: ', tuser)
          var token = generateToken(tuser, 'user')
          res.status(200)
          res.send(token)
          res.end()
        }, function () {
          next(errors.NotAcceptable('Invalid Target User'))
        })
      })
    })
  }
])

/* Refresh a valid token */
router.get('/refresh',
  function (req, res, next) {
    if (!req.user) {
      return next(new errors.Unauthorized('Invalid Token'))
    }

    console.log('Refresh Token: ', req.user)
    when(UserModel.get(req.user.id), function (ruser) {
      var user = ruser.getData()
      // var u = {
      //   id: user.id,
      //   roles: user.roles || []
      // }
      var token = generateToken(user, 'user')
      res.status(200)
      res.send(token)
      res.end()
    })
  }
)

/* get a 'service' token with a valid user and application token */
router.post('/service', [
  bodyParser.urlencoded({extended: true}),
  function (req, res, next) {
    console.log('Authenticate Service Token: ', req.user)
    if (!req.user || !req.user.id) {
      return next(new errors.Unauthorized('Invalid Application Token'))
    }

    if (!req.user.scope || (req.user.scope !== 'application')) {
      return next(new errors.Unauthorized('Application Scoped Token Required'))
    }

    if (!req.body.token) {
      return next(new errors.Unauthorized('Missing User Token'))
    }

    // TODO validate body.token
    when(validateToken(req.body.token), function (tuser) {
      console.log('Body Token Data: ', tuser)
      when(UserModel.get(tuser.id), function (ruser) {
        var user = ruser.getData()
        if (user) {
          var token = generateToken(user, 'service')
          res.status(200)
          res.send(token)
          res.end()
        }
      }, function (err) {
        return next(new errors.NotAcceptable(err))
      })
    })
  }
])

module.exports = router
