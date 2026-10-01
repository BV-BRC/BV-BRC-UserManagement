var express = require('express')
var path = require('path')
var logger = require('morgan')
var config = require('./config')
var cors = require('cors')
var corsOptions = require('./corsOptions')
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
var verify = require('./routes/verify')
var debug = require('debug')('app')
var sleep = require("sleep-promise");
var log = require('./log')

require('dactic/media/')


// Why is this still here?
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

if (config.get('signing_PEM')) {
  var f = config.get('signing_PEM')
  if (f.charAt(0) !== '/') {
    f = path.join(__dirname, f)
  }
  try {
    debug('Filename: ', f)
    var SigningPEM = fs.readFileSync(f)
    if (SigningPEM) { debug('Found Signing Provate Key File') }
  } catch (err) {
    log.log('Could not find Private PEM File: ', f, err)
    process.exit(1)
  }
}

var app = module.exports = express()

process.send = process.send || function(){}
const listener  = app.listen(config.get('http_port') || 3002, function(){
	log.log(`Listening on port ${listener.address().port}`)
	process.send("ready")
})

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
/*
 * morgan's 'dev' preset has no timestamp at all, so access log lines could
 * not be correlated against anything else (the audit trail, another
 * service's logs, a report of abuse at a given time). This is the same
 * fields as 'dev', with an ISO timestamp prefixed; it trades 'dev''s color
 * coding for that, since morgan has no supported way to add a token to a
 * named preset.
 */
app.use(logger(':date[iso] :method :url :status :response-time ms - :res[content-length]'))

var draining = false;
var stats = {
	active_requests: 0
}

app.use((req,res,next)=>{

  if (draining){
		res.status(503)
		res.send("Draining")
		res.end()
		return;
	}

	function fn(){
		log.log("Request Complete");
		stats.active_requests--
		res.removeListener("finish",fn)
	}
	stats.active_requests = stats.active_requests + 1
	log.log("New Request", stats.active_requests);
	res.on("finish", fn)
	next()
});

// See corsOptions.js. The previous inline configuration misspelled two keys
// (credential/allowHeaders), so credentials never worked and the header list
// was silently replaced by reflection of whatever the browser asked for.
app.use(cors(corsOptions(config)))

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
app.use("/verify", verify)
app.use('/authenticate', authenticate)
app.get('/public_key', [
  function (req, res, next) {
    var pubKeyFile = config.get('signing_public_PEM')
    if (!pubKeyFile) { debug('pubKeyFile found'); next('route') }
    fs.readFile(pubKeyFile, 'utf-8', function (err, data) {
      if (err) { return next(err) }
      res.write(JSON.stringify({'pubkey': data, 'valid': 1}))
      res.end()
    })
  }
])

app.use(engine(DataModel))

app.get("/tester", function(req,res,next){
	var delay = Math.random()*3000;
	setTimeout(function(){
		res.write("Delay: "+ delay)
		res.end()
	}, delay);
});

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
    log.error(err)
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

async function drain(count){
	draining=true;
	log.log("Draining. Active Requests: ", stats.active_requests);
	if (stats.active_requests<1){
		return true
	}

	if (count<1){
		throw new Error("Timed out waiting for drain");
	}

	await sleep(1000)

	return await drain(count-1)

}

process.on('SIGINT', async function() {
	log.log("Got SIGINT, Shutting down.");
  try {
		await drain(10)
		process.exit(0)
	}catch(err){
		log.log("Error Draining: ", err);
		process.exit(1)
	}
})

module.exports = app
