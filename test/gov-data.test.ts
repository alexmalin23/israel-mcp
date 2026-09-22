import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeDatastore } from "../src/services/gov-data/index.js";

test("strips CKAN _id from fields and records", () => {
  const out = shapeDatastore({
    total: 1,
    fields: [{ id: "_id", type: "int" }, { id: "city", type: "text" }, { id: "rank", type: "float" }],
    records: [{ _id: 1, city: "חיפה", rank: 0.05 }],
  });
  assert.deepEqual(out.fields, [{ name: "city", type: "text" }, { name: "rank", type: "float" }]);
  assert.deepEqual(out.records, [{ city: "חיפה", rank: 0.05 }]);
});
