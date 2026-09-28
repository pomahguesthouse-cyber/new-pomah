import assert from "node:assert/strict";
import {
  buildCustomSchemeCallback,
  buildNativeOAuthRedirectUri,
  buildOAuthBrokerUrl,
  parseNativeOAuthCallback,
  readOAuthParams,
} from "../src/lib/native-oauth.ts";

const broker = buildOAuthBrokerUrl({
  origin: "https://pomahguesthouse.com",
  state: "abc123",
  redirectUri: buildNativeOAuthRedirectUri("https://pomahguesthouse.com"),
});
const brokerUrl = new URL(broker);
assert.equal(brokerUrl.origin, "https://pomahguesthouse.com");
assert.equal(brokerUrl.pathname, "/~oauth/initiate");
assert.equal(brokerUrl.searchParams.get("provider"), "google");
assert.equal(
  brokerUrl.searchParams.get("redirect_uri"),
  "https://pomahguesthouse.com/native-oauth-return",
);
assert.equal(brokerUrl.searchParams.get("state"), "abc123");
assert.equal(brokerUrl.searchParams.get("prompt"), "select_account");

const callback = buildCustomSchemeCallback({
  accessToken: "access",
  refreshToken: "refresh",
  state: "abc123",
});
const parsed = parseNativeOAuthCallback(callback);
assert.equal(parsed?.ok, true);
if (parsed?.ok) {
  assert.equal(parsed.tokens.accessToken, "access");
  assert.equal(parsed.tokens.refreshToken, "refresh");
  assert.equal(parsed.tokens.state, "abc123");
}

const errored = parseNativeOAuthCallback(
  buildCustomSchemeCallback({
    accessToken: "",
    refreshToken: "",
    error: "access_denied",
    errorDescription: "cancelled",
  }),
);
assert.deepEqual(errored, { ok: false, error: "cancelled" });

assert.equal(parseNativeOAuthCallback("https://pomahguesthouse.com/admin"), null);
assert.equal(parseNativeOAuthCallback("not a url"), null);

const fromHash = readOAuthParams("", "#access_token=a&refresh_token=b&state=s");
assert.equal(fromHash.accessToken, "a");
assert.equal(fromHash.refreshToken, "b");
assert.equal(fromHash.state, "s");

console.log("native oauth ok");
