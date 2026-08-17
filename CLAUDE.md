# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

BV-BRC User Service (p3_user) - A Node.js/Express REST API for managing BV-BRC user accounts, authentication, and authorization. Uses MongoDB for persistence and RSA key pairs for JWT-style token signing.

## Commands

```bash
# Start the server
npm start                    # Runs: node app.js

# Build singularity container
npm run build-image          # Runs: ./buildImage.sh

# Lint
./node_modules/.bin/eslint . # ESLint 8 with eslint-config-standard 17
```

There is **no test suite**. `npm test` is not defined, and there are no test
files. Verify changes by exercising the affected path directly — see
"Verifying changes without a test suite" below.

**Lint is not a gate.** `eslint .` reports ~850 errors, essentially all
pre-existing style debt (`semi`, `quotes`, `space-before-function-paren`).
Judge a change by whether it adds *new* errors on the files it touches, not by
the total. One known pre-existing error in `validateToken.js:2` (`no-useless-escape`
on the user-id regex) is deliberately left alone — editing that regex changes
token parsing.

Production runs under **pm2**, not `forever` (removed). The singularity
container starts it with `pm2-runtime`; see `singularity/default_pm2_config.js`.

## Configuration

The service uses `nconf` for configuration with this precedence: CLI args > env vars > config file > defaults.

- Config file: `p3-user.conf` (or set `P3_USER_CONFIG` env var)
- Example config: `p3-user.conf.example`
- Required: MongoDB connection, RSA key pair (private.pem/public.pem), `sha_salt` for legacy password migration

Generate signing keypair:
```bash
openssl genrsa -out private.pem 2056
openssl rsa -in private.pem -pubout -out public.pem
```

## Architecture

### Core Components

- **app.js** - Express application entry point, middleware setup, route registration, graceful shutdown with request draining
- **dataModel.js** - Initializes dactic data models with MongoDB stores and facets (public/user/admin privilege levels)
- **config.js** - Configuration management via nconf

### Authentication Flow

1. **Token Generation** (`generateToken.js`) - Creates RSA-SHA1 signed bearer tokens with format: `un=user@realm|tokenid=...|expiry=...|sig=...`
2. **Token Validation** (`validateToken.js`) - Checks the token's `SigningSubject` against the configured `signingSubjectURL`, then fetches that public key and verifies the signature. **The subject check must happen before the fetch** — see "Token SigningSubject" under Security Considerations.
3. **Token Middleware** (`middleware/token.js`) - Extracts and validates Authorization header, sets `req.user` and `req.apiPrivilegeFacet`

Token fields are parsed by splitting each `|`-separated pair on its **first**
`=`, not `split('=')[1]`. `SigningSubject` is a URL and contains `=` whenever it
carries a query string; the naive split truncates it, which silently breaks both
the subject match and signature verification.

### Data Model Layer (dactic framework)

- **models/** - Data models extending dactic's base model
  - `user.js` - User model with registration, password management (bcrypt + legacy SHA1 migration), email verification, password reset
- **facets/** - Access control layers wrapping models
  - `user-user.js` - Authenticated user access (can view/edit own profile, limited fields)
  - `user-admin.js` - Admin access with elevated privileges

### Routes

- `/authenticate` - POST for login, GET `/refresh` for token renewal, POST `/service` for service tokens, POST `/sulogin` for admin impersonation
- `/register` - User registration
- `/reset` - Password reset flow
- `/verify` - Email verification
- `/user` - CRUD operations via dactic engine (access controlled by facets)
- `/public_key` - Returns signing public key for token verification

### Key Patterns

- Uses `promised-io` for promise handling (`When`, `Defer`)
- Passwords stored as bcrypt hashes; legacy SHA1 passwords auto-migrated on successful login
- User lookups support both username and email via `or(eq(id,...),eq(email,...))` queries
- Realm mapping (`realm_map` config) maps sources to token realms (e.g., "bvbrc" -> "bvbrc")

### Outbound User-Agent

**Every outbound HTTP request must send a `User-Agent`.** Use the shared helper in `userAgent.js`:

```js
var withUserAgent = require('./userAgent').withUserAgent
https.get({hostname: h, path: p, headers: withUserAgent({Accept: 'application/json'})}, cb)
```

- Produces `bvbrc-user/<version>`; version from `BVBRC_USER_VERSION` env var, else `package.json`.
- **The `bvbrc-<component>/<version>` shape is allowlisted in the BV-BRC Cloudflare rules.** Keep the prefix.
- Unlike p3_api's equivalent helper, this one does *not* shell out to `git describe` — this module is consumed as an npm dependency, where that would report the host repo's version.

Why it matters: Cloudflare fronts the BV-BRC hosts and answers clients it doesn't recognize with a 403 challenge page. The `request` library (since removed) sent no UA by default, so `validateToken.js`'s fetch of `/public_key` got HTML instead of JSON, `getSigner` rejected, and **every token was refused** — callers silently fell through to anonymous and just got less data, with no error. This was patched downstream in `p3_api/node_modules/p3-user/` for months, where `npm install` kept wiping it.

Note the challenge is currently **path-scoped, not UA-scoped**: measured against production, `/` challenges every UA including none, while `/public_key` is exempt for all of them. The UA is still required — that exemption is a Cloudflare config someone can change — but do not assume the allowlist is what keeps token validation working today.

Diagnose with a **Node** request, not curl — curl's default UA passes:

```bash
node -e "require('https').get('https://user.patricbrc.org/public_key', r => console.log(r.statusCode))"   # 403 => blocked
```

`getSigner` also rejects any non-JSON signer response, so a challenge page surfaces as a specific error rather than a generic "invalid token".

`validateToken.js` uses node's built-in `http`/`https`, not the `request` package. `request` is deprecated and unmaintained, and was this module's largest source of npm audit advisories. **Do not add it back.** `dactic` still declares it as a dependency (and so still pulls it into the tree) but never actually requires it — a phantom dependency worth removing if `dactic` is ever forked or updated.

## Security Considerations

### Token SigningSubject must match the configured signer

`validateToken()` rejects any token whose `SigningSubject` differs from the `signingSubjectURL` in config, **before** fetching a key. This check is load-bearing:

```js
if (parsedToken.SigningSubject !== signingSubject) {
  // resolve(false) -- must actually reject
}
```

The original code built an error without throwing it, and referenced an undefined `signingSubjectURL`:

```js
// BROKEN -- do not restore
if (parsedToken.SigningSubject !== signingSubject) {
  new Error('Invalid Signing Subject: ' + signingSubjectURL)   // ReferenceError, never thrown
}
```

Two defects on one line. The service was fail-closed only *by accident*: the ReferenceError aborted the request, surfacing to clients as `500 {"message":"signingSubjectURL is not defined"}`.

**Correcting the variable name alone would have opened an authentication bypass.** With the ReferenceError gone and nothing thrown, execution falls through to `getSigner(parsedToken.SigningSubject)` — fetching the key from a URL *the token itself names*. An attacker publishes their own keypair, signs a token claiming any identity including an admin, points `SigningSubject` at their own server, and this service fetches that key and verifies the signature against it. Confirmed reproducible against the pre-fix logic before the fix landed.

`getSigner` additionally rejects non-`http(s)` protocols, caps the response at 64 KiB, and times out at 15s.

### RQL Injection Prevention

This service uses RQL (Resource Query Language) for database queries. **User input must never be directly interpolated into RQL queries** without proper validation and encoding.

**Vulnerable pattern:**
```javascript
// DANGEROUS - allows RQL injection (e.g., "re:.*" matches any value)
UserModel.query('eq(resetCode,' + req.params.code + ')')
```

**Safe pattern:**
```javascript
// SAFE - validate format AND encode
if (!utils.isValidCode(req.params.code)) {
  return next(new errors.NotAcceptable('Invalid Code'))
}
UserModel.query('eq(resetCode,' + encodeURIComponent(req.params.code) + ')')
```

RQL special syntax to watch for:
- `re:` - regex patterns (e.g., `re:.*` matches everything)
- `gt:`, `lt:`, `ge:`, `le:` - comparison operators
- `or()`, `and()` - logical operators

### Reset/Verification Codes

- Generated by `randomstring.generate(5).toUpperCase()`
- Format: exactly 5 uppercase alphanumeric characters (e.g., `A1B2C`)
- Validate with `utils.isValidCode()` before use in queries
- Always use `encodeURIComponent()` when embedding in RQL queries

## Verifying changes without a test suite

There are no tests, so verification is manual. These throwaway harnesses have
each caught a real defect and are worth rebuilding rather than skipping:

**Boot the app.** Needs a config, a keypair, and something on :27017. Without a
local mongod, a TCP server that accepts and never replies keeps the driver
hanging in connect instead of crashing, which is enough to exercise the HTTP
routes:

```bash
node -e "require('net').createServer(s=>s.on('error',()=>{})).listen(27017,'127.0.0.1')" &
P3_USER_CONFIG=/tmp/t.conf node app.js
# / renders index.ejs; /public_key returns the key. Both work without mongo.
```

**Token round trip.** Point `signingSubjectURL` at a local HTTP server that
serves `{"pubkey": "<PEM>"}`, then mint with `generateToken.js` and verify with
`validateToken.js`. This is the only way to test the auth path end to end, and
it is how the SigningSubject bypass was confirmed.

**Mail.** `models/user.js` `mail()` can be driven against a throwaway SMTP
server (a `net` server speaking enough of the protocol to reach `DATA`).
Asserting on the delivered message caught that the nodemailer upgrade needed
`{sendmail: true}` on the `localSendmail` path.

**Templates.** `ejs.compile()` every file in `views/` after any ejs change.
Note `p3header.ejs` requires `request.applicationOptions` and `request.package`,
which nothing in this repo supplies — rendering it standalone fails on *any*
ejs version, so that failure is pre-existing, not a regression you introduced.

Assert on **outcomes**, not on "it didn't throw": every bug found in this
service so far produced a plausible-looking success.

## Dependencies

Updated 2026-08-17 (PRs #40, #42): `npm audit` went 58 → 7. All 18 open
dependabot PRs were superseded and closed.

- **Do not re-add `request`.** It is deprecated and was the source of every
  remaining advisory. `validateToken.js` uses node's built-in `http`/`https`.
- The remaining 7 advisories are **`dactic@0.8.12`'s doing**: it declares
  `request` and so pulls it (plus `form-data`, `qs`, `tough-cookie`) into the
  tree, while never actually `require`-ing it — a phantom dependency. 0.8.12 is
  the newest published release, so clearing the rest needs dactic forked or
  updated. Do not chase these to zero any other way.
- **`npm audit fix --force` is unsafe here.** Its suggested "fix" for `dactic`
  is 0.0.9 — a downgrade from 0.8.12 that would wreck the data layer. Upgrade
  packages individually and verify each.
- `mongodb` is declared explicitly for `bin/verify_users.js`; it was previously
  only present transitively via `dactic-store-mongodb`.
- Removed as unused: `bson`, `md5`, `forever`, `csv`, `cli-progress`,
  `through2`, `nodemailer-smtp-transport`. `bin/import_vipr.js` was deleted
  (ViPR import no longer needed), which is what freed the last three.
