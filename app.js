var express = require('express')
var path = require('path')
var logger = require('morgan')
var config = require('./config')
var cors = require('cors')
var fs = require('fs-extra')
var app = express()
var DataModel = require('./dataModel')
var engine = require('dactic')
var packageJson = require('./package.json')
const token = require('./middleware/token')
var site = require('./site')
var authenticate = require('./routes/authenticate')
var register = require('./routes/register')
var reset = require('./routes/reset')

require('dactic/media/')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

if (config.get('signing_PEM')) {
  var f = config.get('signing_PEM')
  if (f.charAt(0) !== '/') {
    f = path.join(__dirname, f)
  }
  try {
    console.log('Filename: ', f)
    var SigningPEM = fs.readFileSync(f)
    if (SigningPEM) { console.log('Found Signing Provate Key File') }
  } catch (err) {
    console.log('Could not find Private PEM File: ', f, err)
  }
}

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
app.use(logger('dev'))
app.use(cors({origin: true, methods: ['GET', 'PUT', 'patch', 'PATCH', 'POST', 'PUT', 'DELETE'], allowHeaders: ['accept', 'content-type', 'authorization'], exposedHeaders: ['Content-Range', 'X-Content-Range', 'Content-type'], credential: true, maxAge: 8200}))

app.use(function (req, res, next) {
  req.config = config
  req.production = config.get('production') || false
  req.package = packageJson
  next()
})

app.use('/js/' + packageJson.version + '/', [
  express.static(path.join(__dirname, 'public/js/release/'), {
    maxage: '356d',
    /* etag:false, */
    setHeaders: function (res, path) {
      var d = new Date()
      d.setYear(d.getFullYear() + 1)
      res.setHeader('Expires', d.toGMTString())
    }
  })
])

app.use(token)

// app.post("/validate", site.validateUserCredentials);
app.use('/register', register)
app.use('/reset', reset)
app.use('/authenticate', authenticate)
app.get('/public_key', [
  function (req, res, next) {
    var pubKeyFile = config.get('signing_public_PEM')
    if (!pubKeyFile) { console.log('pubKeyFile found'); next('route') }
    fs.readFile(pubKeyFile, 'utf-8', function (err, data) {
      if (err) { return next(err) }
      res.write(JSON.stringify({'pubkey': data, 'valid': 1}))
      res.end()
    })
  }
])

app.use(engine(DataModel))
app.get('/$', site.index)
app.use(express.static(path.join(__dirname, 'public')))

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  if (req.error) {
    next(req.error)
  } else {
    var err = new Error('Not Found')
    err.status = 404
    next(err)
  }
})

// error handlers

// development error handler
// will print stacktrace
app.use(function (err, req, res, next) {
  var edata = {message: err.message, error: {status: err.status}}
  res.status(err.status || 500)
  if (!config.get('production')) {
    edata.error = err
    console.error(err)
  }
  res.format({
    'application/json': function () {
      res.json(edata)
    },
    'text/html': function () {
      res.render('error', edata)
    },
    'default': function () {
      res.send(edata.message)
    }
  })
})

module.exports = app
