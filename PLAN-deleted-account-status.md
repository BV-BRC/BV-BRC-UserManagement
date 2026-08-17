# Plan: Add "Deleted" Account Status

## Context

BV-BRC needs a way to mark user accounts as deleted while preserving the records so that deleted usernames and email addresses cannot be reused. This is a soft-delete mechanism with an enum `status` field to allow future expansion to states like "suspended".

**Requirements:**
- Deleted accounts cannot log in
- Deleted usernames cannot be reused for new registrations
- Deleted email addresses cannot be reused for new registrations
- Admin + self-service deletion (self-service requires password confirmation)
- Admin-only restore capability

---

## New Schema Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"active"` or `"deleted"` (default: `"active"`) |
| `deletedDate` | string (ISO) | Timestamp of when account was deleted |

Existing users without a `status` field are treated as `"active"`.

---

## Changes by File

### 1. `models/user.js` — User Model

- **Add `status` to schema** with type `string` and default `"active"`.

- **`post()` method** (~line 478): Set `obj.status = 'active'` on new user creation.

- **`validatePassword()` method** (~line 398): After fetching the user, check `user.status`. If status is `"deleted"`, resolve with `Result(false)` (same as wrong password) so the caller gets a generic auth failure. This blocks login for deleted accounts.

- **Add `deleteAccount(id, opts)` method**: Patches the user record with:
  - `{op: 'add', path: '/status', value: 'deleted'}`
  - `{op: 'add', path: '/password', value: ''}` (clear password hash)
  - `{op: 'add', path: '/resetCode', value: ''}` (clear any pending reset)
  - `{op: 'add', path: '/verification_code', value: ''}` (clear any pending verification)
  - `{op: 'add', path: '/deletedDate', value: new Date().toISOString()}`
  - `{op: 'replace', path: '/updatedBy', value: deletedBy}` (who performed the deletion)

- **Add `restoreAccount(id, opts)` method**: Patches the user record with:
  - `{op: 'replace', path: '/status', value: 'active'}`
  - `{op: 'replace', path: '/deletedDate', value: ''}`
  - Triggers a password reset flow so the restored user can set a new password (since password was cleared on delete).

- **`registerUser()` method** (~line 112): Enhance the duplicate-found error message. When the duplicate match has `status === 'deleted'`, return a message like `"This username/email is associated with a deleted account and cannot be reused."` instead of the current generic messages.

- **`resetAccount()` method** (~line 267): After `get(id)`, if `user.status === 'deleted'`, return early without generating a code or sending email. This silently prevents password resets on deleted accounts.

- **`get()` method** (~line 177): No change. Deleted users must remain findable so duplicate checks in `registerUser()` continue to work.

### 2. `routes/authenticate.js` — Authentication Route

- **POST `/authenticate`** (~line 15): No route change needed — `validatePassword` in the model already returns `false` for deleted users after the model change above.

- **POST `/authenticate/sulogin`** (~line 42): After fetching the target user (~line 62), check `tuser.status === 'deleted'` and return `NotAcceptable('Target user account is deleted')`. Admins should not be able to impersonate deleted accounts.

- **GET `/authenticate/refresh`** (~line 81): After fetching the user (~line 88), check `user.status === 'deleted'` and return `Unauthorized('Account is deleted')`. Prevents token refresh for deleted accounts.

- **POST `/authenticate/service`** (~line 103): After fetching the user (~line 121), check `user.status === 'deleted'` and return `Unauthorized('Account is deleted')`. Prevents service token generation for deleted accounts.

### 3. `routes/reset.js` — Password Reset Route

- **POST `/reset`** (~line 88): No route change needed — the guard in `resetAccount()` (model change above) handles this by silently returning without sending an email for deleted accounts.

### 4. `routes/verify.js` — Email Verification Route

- No change needed. Deleted accounts won't have pending verification codes (cleared on deletion). Old verification links will fail the query match.

### 5. `facets/user-admin.js` — Admin Facet

- **Add `deleteAccount(id, opts)` method**: Calls `this.model.deleteAccount(id, opts)`. Only reachable by admin-privileged requests (enforced by facet routing).

- **Add `restoreAccount(id, opts)` method**: Calls `this.model.restoreAccount(id, opts)`. Admin-only.

- **`get()` and `query()` methods**: `status` is already included in responses by default (only `password` and `resetCode` are explicitly stripped). No change needed.

### 6. `facets/user-user.js` — User Facet

- **Add `deleteAccount(id, password, opts)` method**:
  - Requires `opts.req.user.id === id` (can only delete own account)
  - Requires password confirmation: calls `this.model.validatePassword(id, password)` first
  - On valid password: calls `this.model.deleteAccount(id, opts)`
  - On invalid password: throws `Unauthorized('Invalid password')`

### 7. `routes/account.js` (NEW) — Account Lifecycle Routes

New route file for delete/restore operations:

- **DELETE `/user/:id`**:
  - For regular authenticated users: requires `password` in request body for confirmation. Routes through user facet's `deleteAccount`.
  - For admin users: no password required. Routes through admin facet's `deleteAccount`.

- **POST `/user/:id/restore`**: Admin-only endpoint. Calls admin facet's `restoreAccount` method. Returns error for non-admin users.

### 8. `app.js` — Application Entry Point

- Register the new `/user` delete/restore routes from `routes/account.js`.

---

## File Change Summary

| File | Type | Description |
|------|------|-------------|
| `models/user.js` | Modify | Schema, validatePassword, registerUser, resetAccount, new deleteAccount/restoreAccount |
| `routes/authenticate.js` | Modify | Guard sulogin, refresh, service endpoints against deleted users |
| `facets/user-admin.js` | Modify | Add deleteAccount, restoreAccount methods |
| `facets/user-user.js` | Modify | Add deleteAccount method with password confirmation |
| `routes/account.js` | **New** | DELETE /user/:id and POST /user/:id/restore endpoints |
| `app.js` | Modify | Register new routes |

---

## GUI Changes (for the GUI module)

The p3_user backend serves EJS templates that use **Dojo/Dijit** widgets. The actual widget implementations (e.g., `p3/widget/UserProfileEditor`, `p3/widget/LoginForm`) live in the separate GUI module. The changes below describe what the GUI module needs to support the new deletion/restore functionality.

### API Endpoints Available to the GUI

These are the new REST endpoints the backend will expose. All require an `Authorization` header with a valid bearer token.

#### Delete an account

```
DELETE /user/:id
Content-Type: application/x-www-form-urlencoded

# Self-service (authenticated user deleting own account):
password=<current_password>

# Admin (deleting any account):
# No request body required
```

**Responses:**
- `200 OK` — account deleted successfully
- `401 Unauthorized` — wrong password (self-service) or missing/invalid token
- `403 Forbidden` — trying to delete another user's account without admin role
- `404 Not Found` — user ID does not exist

#### Restore an account (admin only)

```
POST /user/:id/restore
```

**Responses:**
- `200 OK` — account restored, password reset email sent to user
- `401 Unauthorized` — not authenticated
- `403 Forbidden` — not an admin
- `404 Not Found` — user ID does not exist

#### User data changes

The `GET /user/:id` and query responses will now include a `status` field:
- `"active"` (or absent for legacy records) — normal account
- `"deleted"` — soft-deleted account

Admin responses also include `deletedDate` (ISO timestamp) when `status === "deleted"`.

---

### View: User Profile — Self-Service Deletion (`views/user.ejs`)

**Location in template:** Inside the `<% if (request.user && (results.id == request.user.id)) { %>` block (line 8), after the `UserProfileEditor` form.

**What to add:** A "Delete My Account" section at the bottom of the user's own profile page.

**Behavior:**
1. Display a `dijit/form/Button` labeled "Delete My Account" with a warning style (red or cautionary styling).
2. On click, open a `dijit/Dialog` confirmation dialog containing:
   - Warning text: "This action is permanent. Your username and email address will be reserved and cannot be reused. You will be logged out immediately."
   - A `dijit/form/ValidationTextBox` of type `password` with placeholder "Enter your password to confirm"
   - A "Cancel" button that closes the dialog
   - A "Delete My Account" button (danger-styled) that submits
3. On submit, send:
   ```javascript
   xhr.del('/user/' + userId, {
     data: { password: enteredPassword },
     headers: { 'Authorization': token },
     handleAs: 'json'
   })
   ```
   (Or equivalent using `dojo/request/xhr` with method `DELETE`.)
4. On success: show a brief confirmation message, then redirect to the site home page (`/`) or logout endpoint (`/logout`). The user's session/token is now invalid.
5. On `401` error: show "Incorrect password" inline in the dialog.
6. On other errors: show the error message from the response body.

**Implementation notes:**
- The delete button should NOT appear if `results.status === 'deleted'` (shouldn't be possible in practice since deleted users can't log in, but guard defensively).
- Consider placing the delete section inside a collapsible `dijit/TitlePane` labeled "Danger Zone" to prevent accidental clicks.

---

### View: User Profile — Admin View of Another User (`views/user.ejs`)

**Location in template:** Inside the `<% } else if (request.user && request.user.roles && (request.user.roles.indexOf("admin") >= 0)) { %>` block (line 32).

**What to add:** Account status display and delete/restore action buttons.

**Status display:**
- Show the user's `status` field prominently. For deleted accounts, show it in red with the `deletedDate`:
  ```html
  <p>Status: <span style="color: red; font-weight: bold;">DELETED</span>
     (deleted on <%= results.deletedDate %>)</p>
  ```
- For active accounts (or missing status field), show in green:
  ```html
  <p>Status: <span style="color: green;">Active</span></p>
  ```

**Action buttons (conditional):**
- If `results.status !== 'deleted'`: Show a `dijit/form/Button` labeled "Delete Account".
  - On click, open a `dijit/Dialog` with:
    - Text: "Are you sure you want to delete the account for **{username}** ({email})? The user will be unable to log in. This username and email will be permanently reserved."
    - "Cancel" and "Delete Account" buttons
  - On confirm, send: `DELETE /user/:id` with admin token (no password needed)
  - On success: reload the page to show updated status

- If `results.status === 'deleted'`: Show a `dijit/form/Button` labeled "Restore Account".
  - On click, open a `dijit/Dialog` with:
    - Text: "Restore account for **{username}**? A password reset email will be sent to {email}."
    - "Cancel" and "Restore Account" buttons
  - On confirm, send: `POST /user/:id/restore` with admin token
  - On success: reload the page to show updated status

---

### View: User List — Admin User Table (`views/user-list.ejs`)

**Current behavior:** The template iterates over all keys of the first result object to build table columns dynamically (line 11). Since `status` will now be present in query results for admin users, it will automatically appear as a column.

**Recommended enhancements:**
1. **Row styling for deleted accounts:** Add conditional row styling:
   ```html
   <tr<% if (res.status === 'deleted') { %> style="opacity: 0.5; text-decoration: line-through;"<% } %>>
   ```
2. **Status column styling:** When rendering the `status` cell, add color coding:
   ```html
   <% if (prop === "status") { %>
     <td style="color: <%= res[prop] === 'deleted' ? 'red' : 'green' %>">
       <%= res[prop] || 'active' %>
     </td>
   <% } else if (prop === "id") { %>
     ...existing link...
   ```
3. **Filtering:** Consider adding a filter toggle (e.g., a `dijit/form/CheckBox` labeled "Show deleted accounts") that appends `&eq(status,deleted)` or removes the filter from the query. By default, the list could either show all users or only active ones — admin preference.

---

### View: Login Page — Deleted Account Error

**No EJS change needed.** The backend returns the same `401 Unauthorized` / "Invalid username, email, or password" error for deleted accounts as it does for wrong passwords. This is intentional — it avoids leaking whether an account exists or has been deleted.

The `p3/widget/LoginForm` widget already displays authentication errors. No change required.

---

### View: Registration Page — Deleted Account Error

**No EJS change needed.** The backend returns a `409 Conflict` with a message like "This username/email is associated with a deleted account and cannot be reused." The existing error display block in `views/registration.ejs` (line 46-50) already renders `error.message` in red text, so the new message will appear automatically.

If the `p3/widget` module handles registration separately from the EJS template, it should display the error message from the `409` response body.

---

### Widget Changes Summary (in the GUI module)

| Widget / Component | Change |
|--------------------|--------|
| `p3/widget/UserProfileEditor` | Add "Delete My Account" button + password confirmation dialog at bottom of form |
| Admin user detail view | Add status display, conditional Delete/Restore buttons with confirmation dialogs |
| User list (admin) | Add row styling for deleted accounts, optional status filter |
| `p3/widget/LoginForm` | No change (generic error already displayed) |
| Registration form | No change (409 error message already displayed) |

---

### Dojo/Dijit Patterns to Follow

Based on existing code patterns in this project:

- **Dialogs:** Use `dijit/Dialog` for confirmation modals (consistent with the Dojo widget set used throughout).
- **Buttons:** Use `dijit/form/Button` with `data-dojo-type` attribute.
- **Forms:** Use `dijit/form/Form` with `data-dojo-type`, `dijit/form/ValidationTextBox` for password input.
- **XHR requests:** Use `dojo/request/xhr` for API calls. Set `handleAs: 'json'` and include the Authorization header from the current session token.
- **CSS classes:** The project uses the Dijit `claro` theme. Use `dijitHidden`/`showOnLoad` patterns for progressive display.

---

## Verification Checklist

1. **Login blocked**: `POST /authenticate` with deleted user's credentials — expect 401
2. **Registration blocked (username)**: `POST /register` with deleted user's username — expect 409 with "deleted account" message
3. **Registration blocked (email)**: `POST /register` with deleted user's email — expect 409 with "deleted account" message
4. **Token refresh blocked**: Valid token for deleted user on `GET /authenticate/refresh` — expect 401
5. **Sulogin blocked**: Admin `POST /authenticate/sulogin` targeting deleted user — expect error
6. **Service token blocked**: `POST /authenticate/service` for deleted user — expect 401
7. **Self-delete works**: Authenticated user `DELETE /user/:id` with correct password — success, subsequent login fails
8. **Self-delete requires password**: Self-delete with wrong password — expect 401
9. **Admin delete works**: Admin `DELETE /user/:id` — success
10. **Admin restore works**: Admin `POST /user/:id/restore` — success, user receives password reset email
11. **Password reset silent for deleted**: `POST /reset` with deleted user's email — returns 201 but no email sent
12. **Existing users unaffected**: Users without `status` field work normally (treated as `"active"`)

### GUI Verification

13. **Self-delete UI**: User profile page shows "Delete My Account" button, clicking opens password confirmation dialog
14. **Self-delete dialog**: Wrong password shows inline error, correct password deletes account and redirects to logout
15. **Admin delete UI**: Admin viewing another user's profile sees "Delete Account" button, confirmation dialog works
16. **Admin restore UI**: Admin viewing a deleted user's profile sees "Restore Account" button instead, confirmation dialog works
17. **Admin user list**: Deleted accounts show with visual distinction (dimmed/strikethrough), status column is color-coded
18. **Registration error**: Attempting to register with a deleted account's username or email shows the "deleted account" error message
19. **Login error**: Attempting to log in as a deleted user shows generic "Invalid username, email, or password" (no information leak)
