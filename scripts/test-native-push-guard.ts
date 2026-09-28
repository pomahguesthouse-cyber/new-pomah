import assert from "node:assert/strict";
import { canRegisterStaffPush } from "../src/lib/native-push.ts";

assert.equal(canRegisterStaffPush(false, false), false);
assert.equal(canRegisterStaffPush(false, true), false);
assert.equal(canRegisterStaffPush(true, false), false);
assert.equal(canRegisterStaffPush(true, true), true);

console.log("native push guard ok");
