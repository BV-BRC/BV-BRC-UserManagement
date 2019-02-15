const express = require('express')
const router = express.Router()
const bodyParser = require('body-parser')
const DataModel = require('../dataModel')
const when = require('promised-io/promise').when
const errors = require('dactic/errors')
const UserModel = DataModel.get('user')

/* Register a new user */
router.post('/', [
  bodyParser.urlencoded({extended: true}),
  bodyParser.json({type: 'application/json'}),
  function (req, res, next) {
    // check for missing fields
    if (!req.body || !req.body.username || !req.body.email || !req.body.first_name || !req.body.last_name) {
      return next(new errors.BadRequest('Missing required fields'))
    }
    // check for user id rule
    if (req.body.username.match(/[\w.-]+/)[0] !== req.body.username) {
      return next(new errors.BadRequest('Username contains unacceptable characters. Use letters, numbers, underscore(_), dot(.), and dash(-)'))
    }

    console.log('Registering New User: ', req.body.username, req.body.email)

    when(UserModel.registerUser(req.body), function () {
      res.status(201)
      res.end()
    }, function (err) {
      next(err)
    })
  }
])

module.exports = router
