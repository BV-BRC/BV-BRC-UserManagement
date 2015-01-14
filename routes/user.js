/**
 * Module dependencies.
 */
var passport = require('passport')
var login = require('connect-ensure-login');

exports.info = [
 // passport.authenticate('bearer', { session: false }),
  login.ensureLoggedIn(),
  function(req, res) {
	console.log('authInfo: ', req.authInfo);
	console.log('req.user: ', req.user);
    // req.authInfo is set using the `info` argument supplied by
    // `BearerStrategy`.  It is typically used to indicate scope of the token,
    // and used in access control checks.  For illustrative purposes, this
    // example simply returns the scope in the response.
    res.json({ user_id: req.user.id, name: req.user.name, scope: (req.authInfo&&req.authInfo.scope)?req.authInfo.scope:"*" })
  }
]
