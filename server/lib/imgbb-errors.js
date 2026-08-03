function getImgBbErrorDetails(err) {
  const providerError = err.response?.data?.error || {};

  return {
    providerStatus: Number(err.response?.status || err.status) || null,
    providerCode: providerError.code ?? null,
    providerMessage: String(providerError.message || err.message || "ImgBB upload failed")
  };
}

function isImgBbRateLimitError(err) {
  const { providerStatus, providerMessage } = getImgBbErrorDetails(err);
  const message = providerMessage.toLowerCase();

  return providerStatus === 429
    || message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("upload limit")
    || message.includes("hourly limit")
    || message.includes("images per hour")
    || message.includes("uploads per hour")
    || message.includes("quota exceeded");
}

function isImgBbInvalidKeyError(err) {
  const { providerStatus, providerMessage } = getImgBbErrorDetails(err);
  const message = providerMessage.toLowerCase();

  return providerStatus === 401
    || message.includes("invalid api key")
    || message.includes("invalid key")
    || message.includes("api key is invalid")
    || message.includes("api key not found");
}

module.exports = {
  getImgBbErrorDetails,
  isImgBbInvalidKeyError,
  isImgBbRateLimitError
};
