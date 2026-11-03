const test = require("node:test");
const assert = require("node:assert/strict");
const { getStoredImageAvailabilityUrls } = require("../lib/stored-image-urls");

test("checks the original image before the delayed display image", () => {
  assert.deepEqual(getStoredImageAvailabilityUrls({
    originalUrl: "https://i.ibb.co/original.jpg",
    mediumUrl: "https://i.ibb.co/display.jpg"
  }), [
    "https://i.ibb.co/original.jpg",
    "https://i.ibb.co/display.jpg"
  ]);
});

test("falls back to the available URL and removes duplicates", () => {
  assert.deepEqual(getStoredImageAvailabilityUrls({
    mediumUrl: "https://i.ibb.co/display.jpg"
  }), ["https://i.ibb.co/display.jpg"]);

  assert.deepEqual(getStoredImageAvailabilityUrls({
    originalUrl: "https://i.ibb.co/image.jpg",
    mediumUrl: "https://i.ibb.co/image.jpg"
  }), ["https://i.ibb.co/image.jpg"]);
});
