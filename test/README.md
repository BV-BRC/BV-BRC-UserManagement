# p3_user tests

Built on node's built-in `node:test` runner — **no new dependencies**.

```bash
npm test               # unit only: no mongo, no network, ~1s
npm run test:integration   # needs a scratch mongod (see below); skips without one
npm run test:all           # both
```

## Two layers

**`test/unit/`** always runs, with no infrastructure. Everything interesting in
`models/user.js` happens *above* the store — the `cpProps` allowlist, AJV
validation in `Model.put`, facet whitelists, the get→patch→put cycle — so an
in-memory store is faithful for those paths. Requiring a database to run the
tests would mean nobody runs them.

**`test/integration/`** covers only what the in-memory store *cannot* model,
and is skipped unless `P3_USER_TEST_MONGO_URL` is set:

```bash
P3_USER_TEST_MONGO_URL=mongodb://127.0.0.1:27017 npm run test:integration
```

Each test creates a uniquely-named scratch database (`p3_user_test_<pid>_<n>`)
and drops it afterwards. Point this at a **scratch server**. If the URL is set
but unreachable the suite skips with a reason rather than hanging — note that
`127.0.0.1:27017` may be the stub TCP listener from CLAUDE.md's manual
verification recipe, which accepts connections and never replies.

Verified green against **mongod 3.4.24**, the version BV-BRC runs in
production and within the driver's supported range (`mongodb@3.5.9` supports
servers 2.6–4.2).

### Getting a 3.4 mongod on macOS

Homebrew cannot supply one: `homebrew-core` has no `mongod` at all, and the
`mongodb/brew` tap only goes back to 7.0 — far outside the driver's range.
Use the official 3.4 tarball. Only the `x86_64` build exists; it runs fine
under Rosetta on Apple silicon.

```bash
mkdir -p /tmp/mongo34 && cd /tmp/mongo34
curl -LO https://fastdl.mongodb.org/osx/mongodb-osx-ssl-x86_64-3.4.24.tgz
tar xf mongodb-osx-ssl-x86_64-3.4.24.tgz
mkdir -p data log
./mongodb-osx-x86_64-3.4.24/bin/mongod --dbpath /tmp/mongo34/data \
  --port 27018 --bind_ip 127.0.0.1 --logpath /tmp/mongo34/log/mongod.log --fork
```

Port **27018**, not 27017, so this does not collide with the stub listener
above. Stop it with `mongod --dbpath /tmp/mongo34/data --shutdown`.

### Every query must carry an explicit `limit()`

A query without one reaches the driver as `limit: Infinity`, which BSON
serializes to int64 min and mongod rejects:

```
Limit value must be non-negative, but received: -9223372036854775808
```

`dactic-store-mongodb/rql.js:13,15` defaults limit to `Infinity`, and the code
in `index.js:332-350` that would have clamped it is commented out. Production
never hits this — `dactic/datamodel.js:80` appends a default `limit(25)` to
every HTTP query and `models/user.js:181` hardcodes `limit(1)` — so it is a
constraint on callers, not a service bug. A test that omits `limit()` is
testing the driver's integer handling rather than p3_user.

## What is deliberately covered

| file | what it pins |
|---|---|
| `unit/dactic-contract.test.js` | dactic@0.8.12 behaviors this service depends on: undeclared properties survive `mixinObject` (so the *allowlist*, not the schema, is the persistence gate) and the AJV enum-bricking hazard |
| `unit/token-realm.test.js` | `source` is auth-bearing, not provenance — an unmapped value silently mints `un=alice@undefined`, a valid-looking token that fails its own realm check |
| `unit/facet-fields.test.js` | facet whitelists are default-deny, so new fields are immutable for free; third-party reads leak nothing |
| `unit/rql-injection.test.js` | `utils.isValidCode()` rejects `re:.*` and friends before any interpolation |
| `unit/register.test.js` | registration: the allowlist, duplicate handling, bcrypt storage, legacy SHA1 migration |
| `unit/registration-site.test.js` | the `registration_site` field: URL normalization, origin→slug resolution, the derive-never-copy rule, and that nconf cannot hold a URL-keyed map |
| `integration/store.test.js` | the `overwrite:false` refusal, `_id` stripping, real mongo RQL semantics, and BSON's `undefined`→`null` coercion — plus the registration defect that coercion causes |

## What the first real-mongod run found

Running this layer for the first time surfaced two things worth knowing
before touching `models/user.js`:

**Omitting an optional profile field breaks registration.** `registerUser`
copies its allowlist unconditionally (`models/user.js:118-121`), so a field
the caller omits lands as `undefined`. JS hides this — AJV skips `undefined`,
and a JSON clone drops the key — but BSON serializes it to **null**, and the
schema's `type: 'string'` then rejects null on the *next* write. Failure is
delayed and the cleanup differs by path: with a password the account is rolled
back (`:165`); on the no-password invite path the account is left behind in a
state that cannot be written to at all — no password reset, no verification,
no profile edit. Only reachable from a client that omits the keys entirely; an
HTML form always sends `""`, which passes. The fix is one line in the cpProps
loop. Pinned as observed behavior in
`an omitted optional profile field breaks registration`, so fixing it will
fail that test and prompt an update.

**`encodeURIComponent` and `isValidCode` defend against different things.**
Encoding alone defeats `re:` — `re%3A.*` survives as a literal string and
matches nothing, while the *unencoded* form is compiled to a real `RegExp` and
matches every document. But encoding leaves `( ) ' !  * - . _ ~` unescaped, so
a value like `X),eq(id,admin` still splits the RQL expression into extra
terms. `isValidCode()` is what covers that, and is not redundant with
encoding. Both are asserted.

**`dactic-store-mongodb`'s duplicate refusal crashes rather than rejects.**
`index.js:300` builds its rejection message from an undeclared `id`, so a
`ReferenceError` is thrown inside a driver callback on a later tick and the
deferred never rejects. An `await` cannot catch it. The refusal itself is
correct — the document is not clobbered — but any caller matching on the
message text gets a `ReferenceError` instead. `helpers/mongo.js` exports
`captureError()` for this; it uses `setUncaughtExceptionCaptureCallback`
because `node:test` installs its own `uncaughtException` listener and would
otherwise attribute the throw to the running test.

## Notes for whoever extends this

**Assert on outcomes, not on "it didn't throw."** Every bug found in this
service so far produced a plausible-looking success.

**Test third-party behavior when it is load-bearing.** `dactic` is pinned and
unmaintained; `unit/dactic-contract.test.js` is what tells you what silently
changed if it is ever forked or upgraded.

**Pending tests are `todo`, not commented out.** `unit/registration-site.test.js`
was written this way first: it encoded `PLAN-registration-site.md` as assertions
that ran and reported without failing the build, and the implementation turned
them green without editing any of them. That is the value of the pattern — the
tests are the spec as agreed, not a description of whatever the code ended up
doing. Use it for the next planned change.

**Build a model with `mongo.model()`, not `new UserModel(store, {})`.**
`new Model(...)` calls `store.setSchema()` (dactic/model.js:35-36), which in
dactic-store-mongodb is asynchronous and whose promise nobody awaits
(index.js:76-133) — `collection()` → `col.stats()` → `createCollection()` when
the collection does not exist. A test that never writes therefore still has a
`createCollection` in flight when teardown drops the database: the drop
succeeds, the collection is recreated a millisecond later on the other
connection, and an empty scratch database is left behind on every run. The
mongod log shows it plainly — `dropDatabase` on conn N, `create collection` on
conn N-1. Tests that write win the race by accident; don't rely on it.

**Prefer `find().limit(n).toArray()` over `countDocuments()`.** On driver 3.5
against a 3.4 server `countDocuments()` issues `collStats` + `aggregate`, and
`collStats` against a missing collection creates it — the same leak, from the
assertion side rather than the constructor.

**The in-memory store returns promises**, as `dactic-store-mongodb` does.
This is not cosmetic: promised-io's `when()` runs its callback inline on a
non-promise, so a throw inside a model callback escapes synchronously instead
of rejecting, and tests then assert the wrong error semantics. `registerUser`'s
`Conflict` is thrown from exactly such a callback.

**Never call `store.connect()` on a `dactic-store-mongodb` store.** The
`Store` constructor already does (`dactic/store.js:18` → `init()` →
`connect()`), so `new MongoStore(...)` has an open `MongoClient` before it
returns. Calling `connect()` again opens a *second* one, and closing only the
second leaves the first's sockets open so the process never exits — that is
what hung the first run of this suite: every test reported, then the runner
sat there. Await `store.initialized.promise` instead. Driver 3.5's `Db` has no
back-pointer to its `MongoClient`, so teardown closes the shared pool via
`db.s.topology.close()`.

**Config is an nconf singleton read at require time.** `helpers/config.js` must
be required *before* anything pulling in `../../config`. Things read at require
time (e.g. `generateToken`'s signing key) cannot be changed by
`build({config: ...})` afterwards — see `unit/token-realm.test.js` for the
pattern.
