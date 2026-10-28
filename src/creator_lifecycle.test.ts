import { strict as assert } from "node:assert";
import { parseCreatorObject, shouldExpire } from "./creator_lifecycle.ts";

const input = { creator_id: "c-1", object_key: "throwaway/post.json", content_type: "application/json", subscriber_email: "reader@example.com" };
assert.equal(parseCreatorObject(input).processed, false);
assert.equal(shouldExpire(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-08T00:00:00Z")), true);
assert.equal(shouldExpire(new Date("2026-01-02T00:00:00Z"), new Date("2026-01-08T23:59:59Z")), false);
console.log("creator TTL decision: passed");
