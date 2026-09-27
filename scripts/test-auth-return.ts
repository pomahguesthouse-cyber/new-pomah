/**
 * Staff sign-in return paths: no open redirect, OAuth callback detection,
 * and chunk-error matching. Pure functions only.
 */
import assert from "node:assert/strict";

import {
  isOAuthErrorLocation,
  isOAuthReturnLocation,
  loginDestination,
  loginReturnUrl,
  resolveAuthReturnTarget,
  safeNext,
  staffHintFromCookie,
} from "../src/lib/auth-return";
import { isChunkLoadError } from "../src/lib/chunk-reload";

assert.equal(safeNext("/admin"), "/admin");
assert.equal(safeNext("/admin/bookings"), "/admin/bookings");
assert.equal(
  safeNext("/.lovable/oauth/consent?authorization_id=abc"),
  "/.lovable/oauth/consent?authorization_id=abc",
);
assert.equal(safeNext("/admin?x=1#y"), "/admin?x=1#y");
assert.equal(safeNext(undefined), null);
assert.equal(safeNext(""), null);
assert.equal(safeNext("https://evil.example/phish"), null);
assert.equal(safeNext("//evil.example"), null);
assert.equal(safeNext("/\\evil.example"), null);
assert.equal(safeNext("/%2F%2Fevil.example"), null);
assert.equal(safeNext("/%5C%5Cevil.example"), null);
assert.equal(safeNext("/admin\nSet-Cookie"), null);

assert.equal(loginDestination(undefined), "/admin");
assert.equal(loginDestination("https://evil.example"), "/admin");
assert.equal(loginDestination("/login"), "/admin");
assert.equal(loginDestination("/login?next=/admin"), "/admin");
assert.equal(loginDestination("/admin/calendar"), "/admin/calendar");

assert.equal(
  loginReturnUrl("https://pomahguesthouse.com", null),
  "https://pomahguesthouse.com/login?next=%2Fadmin",
);
assert.equal(
  loginReturnUrl("https://pomahguesthouse.com", "/admin/bookings"),
  "https://pomahguesthouse.com/login?next=%2Fadmin%2Fbookings",
);
assert.equal(
  loginReturnUrl("https://pomahguesthouse.com", "https://evil.example"),
  "https://pomahguesthouse.com/login?next=%2Fadmin",
);

assert.equal(isOAuthReturnLocation("", "#access_token=abc&refresh_token=def"), true);
assert.equal(isOAuthReturnLocation("?code=" + "a".repeat(20), ""), true);
assert.equal(isOAuthReturnLocation("?code=summer", ""), false);
assert.equal(isOAuthReturnLocation("", ""), false);
assert.equal(isOAuthErrorLocation("", "#error=access_denied&error_description=no"), true);
assert.equal(isOAuthErrorLocation("?error=access_denied", ""), true);

assert.equal(
  resolveAuthReturnTarget({
    next: null,
    remembered: "/admin",
    oauthReturn: false,
    hasSession: true,
  }),
  "/admin",
);
assert.equal(
  resolveAuthReturnTarget({
    next: null,
    remembered: null,
    oauthReturn: true,
    hasSession: true,
  }),
  "/admin",
);
assert.equal(
  resolveAuthReturnTarget({
    next: null,
    remembered: "/admin/calendar",
    oauthReturn: false,
    hasSession: true,
  }),
  "/admin/calendar",
);
assert.equal(
  resolveAuthReturnTarget({
    next: null,
    remembered: null,
    oauthReturn: false,
    hasSession: true,
  }),
  null,
);
assert.equal(
  resolveAuthReturnTarget({
    next: null,
    remembered: "/admin",
    oauthReturn: true,
    hasSession: false,
  }),
  null,
);
assert.equal(
  resolveAuthReturnTarget({
    next: "//evil.example",
    remembered: null,
    oauthReturn: true,
    hasSession: true,
  }),
  "/admin",
);

assert.equal(staffHintFromCookie(null), false);
assert.equal(staffHintFromCookie(""), false);
assert.equal(staffHintFromCookie("pomah_staff=1"), true);
assert.equal(staffHintFromCookie("other=1; pomah_staff=1"), true);
assert.equal(staffHintFromCookie("pomah_staff=0"), false);
assert.equal(staffHintFromCookie("not_pomah_staff=1"), false);

assert.equal(
  isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/admin-abc.js")),
  true,
);
assert.equal(isChunkLoadError(new Error("Importing a module script failed.")), true);
assert.equal(
  isChunkLoadError(new Error("error loading dynamically imported module")),
  true,
);
assert.equal(isChunkLoadError(new Error("something else")), false);
assert.equal(
  isChunkLoadError({
    message: "wrapper",
    cause: new Error("Failed to fetch dynamically imported module"),
  }),
  true,
);

console.log("test-auth-return: ok");
