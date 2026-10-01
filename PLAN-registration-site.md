# Record the frontend site a user registered from

## Context

BV-BRC now fronts several web properties (BV-BRC, MAAGE, DXKB, LDKB) that all point at
the **same** user service — both `bvbrc_website` and `MAAGE-Web` ship
`"userServiceURL": "https://user.patricbrc.org"`. Once an account exists, nothing in the
record says which property it was created on, so registrations can't be attributed per
site.

p3_user cannot infer this. The only server-side signal is `Origin`, and `corsOptions.js`
deliberately *reflects* rather than matches it. So the site must be declared by the
caller. Registration already originates from browser JS
(`p3/widget/UserProfileForm.js` → `xhr POST userServiceURL + '/register'`), and the
frontends already hold the value in `appBaseURL` — a config key threaded into
`window.App` (both `config.js:14`; `app.js:140`/`:120` → `applicationOptions` →
`views/javascript.ejs:264`, which JSON-serializes the whole options object, so
`window.App.appBaseURL` is genuinely available even though it isn't in the explicit
`appOpts.*` list below it).

**Scope: p3_user only.** The parameter is optional, so frontends keep working unchanged;
sending it is a follow-up PR per repo.

### Why not reuse the existing `source` field

`models/user.js:485` already sets `obj.source = config.get("default_source")`. It looks
like the right field and is not — it is **auth-bearing**, not provenance:

- `generateToken.js:40` — `realm_map[user.source]` produces the realm in every token
  (`un=<name>@<realm>`).
- `middleware/token.js:9-11` — a token whose realm isn't a `realm_map` value is rejected
  with `Token Failed Validation: Invalid Realm`.
- `facets/user-user.js:28,94`, `facets/user-admin.js:17,67` expose it as `realm`.

Writing `maage`/`dxkb` into `source` gives `realm_map['maage'] === undefined`, minting
tokens reading `un=alice@undefined` that then fail their own realm check. Separate field
required.

## The parameter is a URL, not a slug

`appBaseURL` is the site's base URL (`https://www.bv-brc.org`), so the API takes a URL and
p3_user maps it to a site slug. Consequences:

- **Normalize to an origin before matching.** `new URL()` handles the variance —
  confirmed: `https://www.bv-brc.org/`, `HTTPS://WWW.BV-BRC.ORG/register?x=1` all reduce to
  `https://www.bv-brc.org`, while `javascript:alert(1)`, `ftp://x.org`, `not a url` and `''`
  reject.
- **Store both the slug and the normalized URL.** The slug (`bvbrc`) is what you group by;
  the URL distinguishes `dev.dxkb.org` from `dxkb.org`, letting test registrations be
  filtered out and letting slugs be re-derived later if the map is wrong. Dropping
  `registration_site_url` is easy if you'd rather have one field.
- **An unrecognized origin must not block registration.** A new property that launches
  before p3_user's map is updated would otherwise be unable to register anyone — a
  deployment coupling that breaks a launch. Well-formed-but-unmapped stores the URL with
  slug `unknown`; backfill slugs later from the stored URLs. Only a *malformed* value
  (unparseable, or non-`http(s)`) is a 400, since no real site can produce one.

## Verified constraints

Checked against the installed `dactic@0.8.12`, not assumed:

**1. `cpProps` is the actual gate, not the schema.** `dactic/model.js:196-215` copies *any*
undeclared property straight through `mixinObject`. Confirmed: an undeclared
`registration_site` survives intact. The field persists as soon as it's added to the
allowlist at `models/user.js:118`; the schema declaration is documentation and
type-checking, not persistence.

**2. Do NOT put an `enum` on the schema property.** `Model.prototype.patch`
(`dactic/model.js:286-298`) does get → apply patch → **`put`**, and `put`
(`dactic/model.js:233-247`) runs AJV over the *entire* document. Confirmed with AJV: a
record holding a value no longer in the enum fails validation, and since every write goes
through `put`, that user becomes permanently unsaveable — no password reset, no email
verification, no profile edit. Removing a retired site from the list would silently brick
those accounts. Validation lives in application code against config, where a bad value is
rejected at registration and can never poison an existing record. (Absent and valid both
pass a bare `type: 'string'`.)

## Changes

### `config.js` — origin → slug map

```js
'registration_site_map': {
  'https://www.bv-brc.org': 'bvbrc',
  'https://bv-brc.org': 'bvbrc',
  'https://www.patricbrc.org': 'bvbrc',
  'https://www.maage-brc.org': 'maage',
  'https://dxkb.org': 'dxkb',
  'https://ldkb.org': 'ldkb'
},
'default_registration_site': 'bvbrc',
```

Keys are normalized origins, lowercased at load so config authors can be sloppy. A plain
map rather than interpolation over property names: per
`PLAN-oauth2-migration.md:330-336`, BV-BRC uses `alpha.`/`beta.`/`dev-N.` while the other
three use `dev.`/`test.`, so no naming convention covers all four. **Non-production
origins are deliberately omitted from the default** — they'd land as `unknown`, which is
the correct default posture; deployments add their own tiers. This is the same enumeration
as `cors_origins`; note in the config comment that they should be kept in sync.

Kept separate from `realm_map`/`default_source` so provenance can grow without touching
anything auth-bearing.

### `models/user.js`

1. Declare both fields in `Model.prototype.schema.properties` (~line 79, beside the other
   metadata fields), each `{ type: 'string', description: ... }`. **No `enum`** — see
   above. Neither added to `required`.

2. Add `"registration_site"` and `"registration_site_url"` to the `cpProps` array at
   line 118. This is what actually persists them.

3. Resolve in `registerUser` (line 111) before the `cpProps` copy — the single
   registration choke point, since `post()` is generic. Given the incoming URL parameter:
   - **absent/empty** → slug = `config.get('default_registration_site')`, no URL stored
     (an old client, not an assertion about origin)
   - **longer than 2048 chars** → 400, before parsing
   - **unparseable or non-`http(s)`** → `new errors.BadRequest('Invalid registration site URL')`
   - **well-formed** → normalize to `protocol//host` (host lowercased); slug =
     `map[origin]` or `'unknown'`; store both

   `errors` is already imported at line 9. A small exported helper
   (`utils.js`, beside `isValidCode`) keeps the parsing testable in isolation.

**Parameter name:** `registration_site_url` on the wire, mirroring what it holds. The
frontend then sends `registration_site_url: window.App.appBaseURL`.

### `routes/register.js` — no change

`UserModel.registerUser(req.body)` at line 28 already passes the whole body to the model.
The required-field check at line 17 stays as-is — the parameter is optional.

### Deliberately unchanged

- **Facets.** Provenance must be immutable. The `ALLOWED_FIELDS` whitelists in
  `facets/user-user.js:38-47` and `facets/user-admin.js:27-35` already reject unknown
  paths with `Forbidden`, so both fields are read-only by default — nothing to add. They
  appear in a user's own profile read and in admin reads, and do *not* leak in the
  third-party projection (`facets/user-user.js:22-29`), which is a fixed field list.
- **Existing records.** No backfill. Absence truthfully means "registered before tracking
  existed"; consumers must handle the fields being missing.
- **`views/registration.ejs`.** Dead code — the only `res.render` calls in the service are
  `index`, `change_password`, `error`. Left alone.

## Verification

No test suite, so per CLAUDE.md these are throwaway harnesses asserting on **outcomes**.
Something is already listening on 127.0.0.1:27017.

1. **URL normalizer, in isolation** — table-drive the helper over
   `https://www.bv-brc.org/`, `HTTPS://WWW.BV-BRC.ORG/register?x=1`, `https://dev.dxkb.org`,
   `javascript:alert(1)`, `ftp://x.org`, `not a url`, `''`, and a 3000-char string.
   Assert the first two both yield `https://www.bv-brc.org` → `bvbrc`, and that every
   malformed case is rejected rather than coerced.

2. **Field survives dactic** — the load-bearing assumption, mirroring the check already run:
   ```bash
   node -e "var M=require('./models/user.js'); var m=Object.create(require('dactic/model').prototype);
   m.schema=M.prototype.schema; var o=m.mixinObject({},{id:'a',l_id:'a',email:'a@b.c',
   first_name:'A',last_name:'B',roles:[],creationDate:'x',updateDate:'x',createdBy:'s',
   updatedBy:'s',registration_site:'maage',registration_site_url:'https://www.maage-brc.org'});
   console.log(o.registration_site, o.registration_site_url)"
   ```

3. **Register through the running app** and assert the *stored document*, not the status code:
   ```bash
   P3_USER_CONFIG=/tmp/t.conf node app.js &
   curl -sS -X POST localhost:3002/register \
     -d username=t_maage -d email=t_maage@example.com -d first_name=T -d last_name=U \
     -d registration_site_url=https://www.maage-brc.org
   ```
   Read the record back (mongo, or `GET /user/t_maage` with an admin token) and confirm
   `registration_site === 'maage'` and the normalized URL.

4. **The three other input classes.** Omitted → default slug, no URL. Unmapped-but-valid
   (`https://brand-new.example.org`) → **201**, slug `unknown`, URL stored — assert the
   account *exists*, since the whole point is that it isn't blocked. Malformed
   (`registration_site_url=javascript:alert(1)`) → 400 **and no user created** (re-query to
   confirm absence, not merely an error response).

5. **The enum hazard stays closed.** Create a user with slug `dxkb`, then restart with
   `registration_site_map` narrowed to BV-BRC only, and confirm that user can still be
   patched (e.g. a password reset completes). This is the regression the schema `enum`
   would have introduced.

6. **Immutability.** `PATCH /user/<id>` with
   `{"op":"add","path":"/registration_site","value":"dxkb"}` as that user → `403 Cannot
   modify field`. Same for `/registration_site_url`.

7. **Token path untouched.** Log in as the `maage` user; confirm the token still reads
   `un=<user>@bvbrc` — `source`/`realm_map` undisturbed.

8. `./node_modules/.bin/eslint config.js models/user.js utils.js` — no *new* errors on the
   touched files (lint is not a gate; ~850 pre-existing).

## Follow-up (not in this PR)

Frontend PRs in `bvbrc_website` and `MAAGE-Web` adding
`registration_site_url: window.App.appBaseURL` in `p3/widget/UserProfileForm.js`
`createNewUser` (bvbrc `:280-290`, MAAGE `:224-234`) — either `lang.mixin` onto `vals`
before the `xhr`, or a hidden input in `templates/UserProfileForm.html`.

**One thing to fix there:** neither checked-in `p3-web.conf` sets `appBaseURL`, so both
repos currently fall back to the `config.js:14` default — which is
`https://www.patricbrc.org` in **both**, including MAAGE-Web. In these dev checkouts MAAGE
would therefore self-report as BV-BRC. Presumably production sets it, but that wants
confirming before the frontend change, or MAAGE registrations will be silently
misattributed rather than visibly broken. (I've included `https://www.patricbrc.org` →
`bvbrc` in the default map since it's the shipped default and is genuinely BV-BRC.)
