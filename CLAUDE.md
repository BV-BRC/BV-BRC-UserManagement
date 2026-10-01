# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

BV-BRC User Service (p3_user) - A Node.js/Express REST API for managing BV-BRC user accounts, authentication, and authorization. Uses MongoDB for persistence and RSA key pairs for JWT-style token signing.

## Commands

```bash
# Start the server
npm start                    # Runs: node app.js

# Test
npm test                     # unit tests: no mongo, no network, ~1s
npm run test:integration     # needs a scratch mongod; skips cleanly without one
npm run test:all             # both

# Build singularity container
npm run build-image          # Runs: ./buildImage.sh

# Lint
./node_modules/.bin/eslint . # ESLint 8 with eslint-config-standard 17
```

There **is** a test suite now, under `test/` — see [`test/README.md`](test/README.md).
It uses node's built-in `node:test` runner, so it added no dependencies. It is
**not** comprehensive: it pins the invariants that were expensive to discover
(the dactic behaviors below, the `source`/realm coupling, facet default-deny,
RQL validation) rather than aiming at coverage. For anything it does not
cover, the manual harnesses in "Verifying changes without a test suite" below
are still the method — and are still how the suite's own fixtures were
derived.

Two things to know before adding to it: the unit layer needs no
infrastructure and must stay that way, and pending tests for unimplemented
work are marked `todo` (they run and report without failing the build) rather
than commented out.

The integration layer is verified against **mongod 3.4.24** (production's
version). Homebrew cannot supply a server that old — `homebrew-core` has no
`mongod` and the `mongodb/brew` tap starts at 7.0, outside `mongodb@3.5.9`'s
supported 2.6–4.2 range. `test/README.md` has the tarball recipe; the
x86_64 build runs under Rosetta.

### Registration fails when an optional profile field is omitted

Found by the integration layer, **not yet fixed**. `registerUser` copies its
allowlist unconditionally (`models/user.js:118-121`):

```js
cpProps.forEach((prop)=>{ newUser[prop]=user[prop] })   // undefined for omitted keys
```

An omitted `affiliation`/`organisms`/`interests` therefore lands as
`undefined`. Plain JS hides this — AJV skips `undefined` and a JSON clone
drops the key — but **BSON serializes it to `null`**, and the schema's
`type: 'string'` rejects null on the *next* write:

```
data.affiliation should be string, data.organisms should be string, data.interests should be string
```

Failure is delayed, and the damage differs by path:

- **with a password** — `setPassword`'s error handler deletes the account
  (`models/user.js:165`); the caller gets an error and no account
- **without a password** (the invite flow) — the account is **left behind**
  and can never be written to again: no password reset, no email
  verification, no profile edit

Reachable only from a client that omits the keys entirely. An HTML form always
sends `""`, which passes — which is why this has gone unnoticed. A JSON API
caller posting just the documented required fields hits it. The fix is to skip
`undefined` in that loop. `test/integration/store.test.js` pins the current
behavior, so fixing it fails that test on purpose.

This is also the general warning: **`undefined` is not `absent` once mongo is
involved.** Any future optional field with a `type` in the schema inherits the
same trap.

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

### nconf splits every key on `:` — never key a config object by URL

`{'https://www.bv-brc.org': 'bvbrc'}` is silently rewritten to
`{https: {'//www.bv-brc.org': 'bvbrc'}}`, so every lookup misses. This happens
in `defaults` in `config.js`, in `p3-user.conf`, and via `.set()` alike —
**arrays are the only shape that survives all three**. That is why
`registration_site_map` is a list of `{url, site}` rather than the map it
obviously wants to be.

The failure is quiet: nothing errors, the source still looks right, and every
origin just resolves to `unknown`. Pinned in
`test/unit/registration-site.test.js` both as the nconf behavior itself and as
an assertion that the *shipped* config resolves the real production origins.

## Architecture

### Core Components

- **app.js** - Express application entry point, middleware setup, route registration, graceful shutdown with request draining
- **dataModel.js** - Initializes dactic data models with MongoDB stores and facets (public/user/admin privilege levels)
- **config.js** - Configuration management via nconf
- **corsOptions.js** - CORS policy: reflected origin, credentials gated on the `cors_origins` allowlist. See "CORS" below before editing.

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

### Registration provenance: `registration_site`, not `source`

Which frontend property an account was created from (BV-BRC, MAAGE, DXKB,
LDKB) is recorded in two fields on the user record: `registration_site` (the
slug) and `registration_site_url` (the normalized origin it was derived
from). The client declares it by passing `registration_site_url` —
`window.App.appBaseURL` — to `POST /register`. It is optional, so existing
clients keep working; frontends sending it are a follow-up PR per repo.

**`source` looks like the field for this and is not — it is auth-bearing.**
`generateToken.js:40` derives the token realm from `realm_map[user.source]`,
so writing `maage` there mints `un=alice@undefined` tokens that then fail
their own realm check in `middleware/token.js:9-11`. The separation is
deliberate; keep provenance out of anything in the auth path.

Three rules the implementation rests on, each with a test:

- **The slug is derived, never copied.** Only `registration_site_url` is in
  the `cpProps` allowlist; `registerUser` resolves the slug from it. A client
  that sends its own `registration_site` is ignored — otherwise anyone could
  self-attribute to any property.
- **No `enum` on the schema properties.** `Model.patch` does get → apply →
  `put`, and `put` runs AJV over the *whole* document, so a record holding a
  value later dropped from the enum would fail validation on every subsequent
  write — no password reset, no verification, no profile edit. Retiring a
  site would silently brick those accounts. The allowed set lives in config
  and is enforced at registration only.
- **An unmapped-but-well-formed origin is `unknown`, not an error.** A
  property launching before this service's map is updated must still be able
  to register users; the stored URL lets slugs be backfilled. Only a
  *malformed* value (unparseable, or non-`http(s)`) is a 400.

Omission is handled by `delete`, not by leaving `undefined` — see the
optional-field trap above; `undefined` would become BSON `null` and break the
next write.

### Outbound User-Agent

**Every outbound HTTP request must send a `User-Agent`.** Use the shared helper in `userAgent.js`:

```js
var withUserAgent = require('./userAgent').withUserAgent
https.get({hostname: h, path: p, headers: withUserAgent({Accept: 'application/json'})}, cb)
```

- Produces `bvbrc-user/<version>`; version from `BVBRC_USER_VERSION` env var, else `package.json`.
- **The `bvbrc-<component>/<version>` shape is allowlisted in the BV-BRC Cloudflare rules.** Keep the prefix.
- Unlike p3_api's equivalent helper, this one does *not* shell out to `git describe` — this module is consumed as an npm dependency, where that would report the host repo's version.

Why it matters: Cloudflare fronts the BV-BRC hosts and answers clients it doesn't recognize with a 403 challenge page. The `request` library (since removed) sent no UA by default, so `validateToken.js`'s fetch of `/public_key` got HTML instead of JSON, `getSigner` rejected, and **every token was refused** — callers silently fell through to anonymous and just got less data, with no error. This was patched downstream in `p3_api/node_modules/p3-user/` for months, where `npm install` kept wiping it. That patch is now obsolete: p3_api pins this repo as a dependency and the fix is upstream here, so **do not re-apply it** to `node_modules`.

Note the challenge is currently **path-scoped, not UA-scoped**: measured against production, `/` challenges every UA including none, while `/public_key` is exempt for all of them. The UA is still required — that exemption is a Cloudflare config someone can change — but do not assume the allowlist is what keeps token validation working today.

Diagnose with a **Node** request, not curl — curl's default UA passes:

```bash
node -e "require('https').get('https://user.patricbrc.org/public_key', r => console.log(r.statusCode))"   # 403 => blocked
```

`getSigner` also rejects any non-JSON signer response, so a challenge page surfaces as a specific error rather than a generic "invalid token".

`validateToken.js` uses node's built-in `http`/`https`, not the `request` package. `request` is deprecated and unmaintained, and was this module's largest source of npm audit advisories. **Do not add it back.** `dactic` still declares it as a dependency (and so still pulls it into the tree) but never actually requires it — a phantom dependency worth removing if `dactic` is ever forked or updated.

## CORS

`corsOptions.js`. p3_user is reached **cross-origin** by the website (`bv-brc.org` →
`user.patricbrc.org`, different registrable domains) for login, token refresh, SU
login, registration, password reset and profile reads. The origin is therefore
*reflected*, and only **credentials** are gated on the `cors_origins` allowlist —
the same split p3_api uses. Gating the origin itself would break login for any
property not listed, and that does not show up until deploy.

### Adding a header: diff against p3_api first

`ALLOWED_HEADERS` has been patched **three times in a row**, each time for a header
`p3_api/util/corsOptions.js` already allowed, each found by a user hitting a broken
feature rather than by comparing the two files:

| PR | header | in p3_api already? |
|---|---|---|
| #46 | `x-requested-with` | yes |
| #48 | `range` | yes |
| #49 | `x-range` | yes |

**When either list changes, diff both.** They are called by the same dojo client, so
a header one needs the other generally needs too:

```bash
node -e "
const a=require('./corsOptions.js').ALLOWED_HEADERS.map(s=>s.toLowerCase()).sort()
const b=require('../p3_api/util/corsOptions.js').ALLOWED_HEADERS.map(s=>s.toLowerCase()).sort()
console.log('only p3_user:', a.filter(h=>!b.includes(h)))
console.log('only p3_api :', b.filter(h=>!a.includes(h)))"
```

### Why headers go missing

The original config misspelled `allowHeaders` (cors reads `allowedHeaders`), so cors
fell through to **reflecting** `Access-Control-Request-Headers` — permitting whatever
the browser asked for. Correcting the spelling replaced that with an explicit list,
so every header the client sends but the list omits now fails preflight *before any
handler runs*.

The question for this list is **what the client sends**, not what the server reads.
p3_user implements no Range semantics and reads no `x-requested-with`, yet all three
headers above are required — dojo sends them on its own:

- `x-requested-with` — `dojo/request/xhr.js:278` sets it by default unless a call
  site passes the key with a falsy value.
- `range` **and** `x-range` — `dojo/store/JsonRest.js:191-200` sets both when a query
  carries `start`/`count`. `X-Range` is set **unconditionally**; `Range` only when
  `rangeParam` is falsy. They travel together, so allowing one without the other
  fixes nothing — that was #48.
- `if-match` / `if-none-match` — `JsonRest.put()` when a call passes
  `options.overwrite`. Nothing sends these today; they are listed as insurance.

### Symptoms

A blocked preflight is not an HTTP error you will find in the service log — the
request never arrives. It shows up in the browser as
`Request header field X is not allowed by Access-Control-Allow-Headers`, and often
as a *downstream* JS error: the workspace sharing dialog reported
`undefined is not an object (evaluating 'a.total')`, because JsonRest's
`QueryResults.total` never resolves. Don't chase the second error.

`Content-Range`/`X-Content-Range` are in `EXPOSED_HEADERS` and dactic sets
`Content-Range` (`dactic/datamodel.js:154`), so the total resolves once the request
is unblocked.

### Reproducing

Preflight against a running app.js — no browser needed:

```bash
curl -sD- -o/dev/null -X OPTIONS 'http://127.0.0.1:13099/user/' \
  -H 'Origin: https://www.bv-brc.org' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: range,x-range' | grep -i access-control
```

A 204 does **not** mean success — check that every requested header appears in
`Access-Control-Allow-Headers`. That is exactly what #48 got wrong.

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

**Validation and encoding cover different attacks — you need both.** Measured
against mongod 3.4.24 (`test/integration/store.test.js`):

- **`encodeURIComponent` handles the `re:` class.** Unencoded,
  `eq(resetCode,re:.*)` is compiled to an actual `RegExp` by
  `dactic-store-mongodb/rql.js` and matches every document. Encoded,
  `re%3A.*` survives as the literal string `re:.*` and matches nothing.
- **It does *not* handle structural injection.** `encodeURIComponent` leaves
  `!'()*-._~` unescaped, so a reset code of `X),eq(id,admin` closes the
  `eq()` early and injects an extra term into the surrounding `and()` —
  `{$and: [{email: …}, {resetCode: "X"}, {…}]}` instead of two terms. That
  extra term currently degrades into a clause matching nothing, so this is
  not a known live bypass; it is one parser change away from being one.
  `isValidCode()` is what closes it, and is **not** redundant with encoding.

So neither defense subsumes the other: keep the format check *and* the
encoding on every interpolation.

### Reset/Verification Codes

- Generated by `randomstring.generate(5).toUpperCase()`
- Format: exactly 5 uppercase alphanumeric characters (e.g., `A1B2C`)
- Validate with `utils.isValidCode()` before use in queries
- Always use `encodeURIComponent()` when embedding in RQL queries

## Verifying changes the test suite doesn't cover

`npm test` covers the model, facet, token and RQL-validation paths. It does
**not** boot the app, render templates, speak SMTP, or exercise HTTP routing,
so verification for those remains manual. These throwaway harnesses have each
caught a real defect and are worth rebuilding rather than skipping:

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
`validateToken.js`. This is how the SigningSubject bypass was confirmed. The
suite covers generation and the realm coupling
(`test/unit/token-realm.test.js`) but stops short of `validateToken.js`, which
makes a real HTTP fetch — that half still needs this harness.

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
