var nconf = require('nconf')

var defaults = {
  'http_port': 3002,

  'mongo': {
    'url': ''
  },
  'siteURL': 'http://user.patric.local:3002',
  'p3Home': 'http://patricbrc.org',
  'signing_PEM': 'private.pem',
  'signing_public_PEM': 'public.pem',
  'realm': 'patricbrc.org',
  'email': {
    'localSendmail': false,
    'defaultFrom': 'PATRIC <do-not-reply@patricbrc.org>',
    'defaultSender': 'PATRIC <do-not-reply@patricbrc.org>',
    'host': '',
    'port': 587
  },
  'userTokenDuration': 24,
  'serviceTokenDuration': 24 * 31
}

module.exports = nconf.argv().env().file('./p3-user.conf').defaults(defaults)
