const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getFilesAvailability,
  isFileExpired,
  partitionFilesByAvailability
} = require("../lib/file-availability");

const now = new Date("2026-07-24T16:00:00Z");

test("isFileExpired uses the stored upload time and expiration duration", () => {
  assert.equal(isFileExpired({
    createdAt: "2026-07-24T14:00:00Z",
    expirationSeconds: 3600
  }, now), true);
  assert.equal(isFileExpired({
    createdAt: "2026-07-24T15:30:00Z",
    expirationSeconds: 3600
  }, now), false);
});

test("files without expiration metadata remain available", () => {
  assert.equal(isFileExpired({
    createdAt: "2020-01-01T00:00:00Z",
    expirationSeconds: null
  }, now), false);
});

test("partitionFilesByAvailability separates expired records", () => {
  const result = partitionFilesByAvailability([
    { id: "expired", createdAt: "2026-07-24T14:00:00Z", expirationSeconds: 3600 },
    { id: "available", createdAt: "2026-07-24T15:30:00Z", expirationSeconds: 3600 },
    { id: "permanent", createdAt: "2020-01-01T00:00:00Z", expirationSeconds: null }
  ], now);

  assert.deepEqual(result.expired.map(file => file.id), ["expired"]);
  assert.deepEqual(result.available.map(file => file.id), ["available", "permanent"]);
});

test("getFilesAvailability returns the earliest remaining expiration", () => {
  const availability = getFilesAvailability([
    { createdAt: "2026-07-24T15:30:00Z", expirationSeconds: 7200 },
    { createdAt: "2026-07-24T15:45:00Z", expirationSeconds: 3600 }
  ]);

  assert.equal(availability.availableUntil, "2026-07-24T16:45:00.000Z");
});
