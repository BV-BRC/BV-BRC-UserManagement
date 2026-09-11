#!/usr/bin/env node
/*
 * Self-check for the CORS policy in corsOptions.js.
 *
 * Run: node bin/verify_cors.js     (exit 0 = pass, 1 = fail)
 *
 * This repo has no test framework -- adding one is out of scope for the change
 * that introduced corsOptions.js -- so this is a standalone script using only
 * express and cors, both already runtime dependencies, plus Node built-ins.
 * It follows the bin/verify_users.js convention.
 *
 * What it guards
 * --------------
 * The previous inline cors configuration misspelled two option keys:
 * `credential` (cors reads `credentials`) and `allowHeaders` (cors reads
 * `allowedHeaders`). Both were inert and failed in opposite directions:
 * Access-Control-Allow-Credentials was never sent, while the header list fell
 * through to reflecting whatever the browser asked for.
 *
 * Correcting only the spelling would be a security regression, not a fix:
 * `origin: true` reflects any origin, and a working `credentials: true`
 * beside it would grant any site on the internet credentialed access with a
 * victim's ambient authority. Nothing exercises that path today, so no
 * functional failure would reveal it. These checks make that specific mistake
 * loud instead of silent.
 *
 * The policy: the origin stays reflected (the website is on a different
 * registrable domain and would break otherwise), and only CREDENTIALS are
 * gated on the allowlist.
 */

const express = require('express')
const cors = require('cors')
const http = require('http')

const corsOptions = require('../corsOptions')

const ALLOWED = 'https://www.bv-brc.org'
const EVIL = 'https://evil.example.com'

let failures = 0

function check (name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  if (ok) {
    console.log('  ok   ' + name)
  } else {
    console.log('  FAIL ' + name)
    console.log('         expected: ' + JSON.stringify(expected))
    console.log('         actual:   ' + JSON.stringify(actual))
  }
}

function startServer (allowlist) {
  const app = express()
  app.use(cors(corsOptions({ get: () => allowlist })))
  app.get('/probe', (req, res) => res.json({ ok: true }))
  app.post('/probe', (req, res) => res.json({ ok: true }))
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server))
  })
}

function request (port, method, origin, requestHeaders) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (origin) headers.Origin = origin
    if (method === 'OPTIONS') {
      headers['Access-Control-Request-Method'] = 'POST'
      if (requestHeaders) headers['Access-Control-Request-Headers'] = requestHeaders
    }
    const req = http.request({ port, path: '/probe', method, headers }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.headers))
    })
    req.on('error', reject)
    req.end()
  })
}

async function main () {
  console.log('exact origin matching')
  const list = [ALLOWED]
  check('allowlisted origin matches', corsOptions.isAllowed(ALLOWED, list), true)
  // Exact match on the whole serialized origin, not a domain suffix test: a
  // suffix test for '.bv-brc.org' would also match both of these.
  check('evil-bv-brc.org rejected', corsOptions.isAllowed('https://evil-bv-brc.org', list), false)
  check('bv-brc.org.attacker.net rejected', corsOptions.isAllowed('https://bv-brc.org.attacker.net', list), false)
  check('scheme mismatch rejected', corsOptions.isAllowed('http://www.bv-brc.org', list), false)
  check('port mismatch rejected', corsOptions.isAllowed('https://www.bv-brc.org:8443', list), false)
  check('trailing slash rejected', corsOptions.isAllowed('https://www.bv-brc.org/', list), false)
  check('undefined origin rejected', corsOptions.isAllowed(undefined, list), false)
  check('empty allowlist rejects all', corsOptions.isAllowed(ALLOWED, []), false)

  console.log('\nconfiguration guard')
  let threw = false
  try { corsOptions({ get: () => ALLOWED }) } catch (e) { threw = true }
  check('non-array cors_origins throws', threw, true)

  console.log('\nemitted headers (allowlist = [' + ALLOWED + '])')
  const server = await startServer([ALLOWED])
  const port = server.address().port

  let h = await request(port, 'OPTIONS', ALLOWED, 'authorization,content-type')
  check('allowlisted: origin reflected', h['access-control-allow-origin'], ALLOWED)
  check('allowlisted: credentials granted', h['access-control-allow-credentials'], 'true')

  h = await request(port, 'OPTIONS', EVIL, 'authorization,content-type')
  // The core regression guard: if someone sets credentials unconditionally
  // alongside origin: true, this is what fails.
  check('non-allowlisted: NO credentials', h['access-control-allow-credentials'], undefined)
  check('non-allowlisted: origin still reflected', h['access-control-allow-origin'], EVIL)

  h = await request(port, 'OPTIONS', ALLOWED, 'x-totally-made-up')
  // The allowHeaders typo made cors reflect Access-Control-Request-Headers.
  check('arbitrary header not reflected',
    h['access-control-allow-headers'].indexOf('x-totally-made-up'), -1)

  h = await request(port, 'OPTIONS', ALLOWED, 'accept,content-type,authorization,x-requested-with')
  // Tightening from reflection to a fixed list can only break clients by
  // omission, so every header the client can send is asserted explicitly.
  //
  // x-requested-with is the one that actually bit: dojo/request/xhr.js:278
  // sends it by DEFAULT unless a call site passes the key with a falsy value.
  // An earlier version of this file asserted the opposite -- that dojo always
  // strips it -- because the three UserProfileForm sites do null it out. But
  // LoginForm.js:99 (POST /authenticate) passes no headers object at all, so
  // it sends the default, and omitting the header here broke production login.
  const allowHdrs = h['access-control-allow-headers'].toLowerCase()
  ;['accept', 'content-type', 'authorization', 'x-requested-with'].forEach((n) => {
    check('client header allowed: ' + n, allowHdrs.indexOf(n) !== -1, true)
  })

  // The dojo default reproduced end to end: a preflight carrying exactly what
  // LoginForm.js:99 sends must be allowed.
  h = await request(port, 'OPTIONS', ALLOWED, 'x-requested-with,content-type')
  const loginAllowed = h['access-control-allow-headers'].toLowerCase()
    .split(',').map(function (s) { return s.trim() })
  check('LoginForm.js:99 preflight passes',
    ['x-requested-with', 'content-type'].every(function (n) {
      return loginAllowed.indexOf(n) !== -1
    }), true)

  h = await request(port, 'GET', null)
  check('same-origin: no ACAO', h['access-control-allow-origin'], undefined)

  server.close()

  console.log('\nshipped default (empty allowlist)')
  const server2 = await startServer([])
  const port2 = server2.address().port
  h = await request(port2, 'OPTIONS', ALLOWED, 'authorization')
  // Verified against production: OPTIONS to https://user.patricbrc.org/authenticate
  // with Origin: https://www.bv-brc.org returns ACAO and no ACAC. So shipping
  // an empty allowlist is a no-op for existing deployments.
  check('matches production: origin reflected', h['access-control-allow-origin'], ALLOWED)
  check('matches production: no credentials', h['access-control-allow-credentials'], undefined)
  server2.close()

  console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL (' + failures + ')'))
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
