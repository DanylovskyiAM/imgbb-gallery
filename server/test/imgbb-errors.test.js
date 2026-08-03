const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getImgBbErrorDetails,
  isImgBbInvalidKeyError,
  isImgBbRateLimitError
} = require("../lib/imgbb-errors");

function providerError({ status = 400, code = 100, message }) {
  const err = new Error(message);
  err.response = {
    status,
    data: { error: { code, message } }
  };
  return err;
}

test("recognizes explicit ImgBB rate limits", () => {
  assert.equal(isImgBbRateLimitError(providerError({ status: 429, message: "Request rejected" })), true);
  assert.equal(isImgBbRateLimitError(providerError({ message: "Rate limit exceeded" })), true);
  assert.equal(isImgBbRateLimitError(providerError({ message: "Hourly upload limit reached" })), true);
  assert.equal(isImgBbRateLimitError(providerError({ message: "You can upload up to 100 images per hour" })), true);
  assert.equal(isImgBbRateLimitError(providerError({ message: "Too many requests" })), true);
});

test("does not treat generic code 100 errors as rate limits", () => {
  assert.equal(isImgBbRateLimitError(providerError({ message: "Imgbb is currently down for maintenance." })), false);
  assert.equal(isImgBbRateLimitError(providerError({ message: "Internal upload error" })), false);
  assert.equal(isImgBbRateLimitError(providerError({ message: "Invalid base64 string." })), false);
});

test("recognizes invalid API keys separately from rate limits", () => {
  const invalidKey = providerError({ status: 400, message: "Invalid API key" });

  assert.equal(isImgBbInvalidKeyError(invalidKey), true);
  assert.equal(isImgBbRateLimitError(invalidKey), false);
  assert.equal(isImgBbInvalidKeyError(providerError({ message: "Internal upload error" })), false);
});

test("extracts provider diagnostics without API credentials", () => {
  assert.deepEqual(
    getImgBbErrorDetails(providerError({ status: 503, code: 100, message: "Maintenance" })),
    {
      providerStatus: 503,
      providerCode: 100,
      providerMessage: "Maintenance"
    }
  );
});
