function getStoredImageAvailabilityUrls(file = {}) {
  return [file.originalUrl, file.mediumUrl]
    .filter((url, index, urls) => url && urls.indexOf(url) === index);
}

module.exports = {
  getStoredImageAvailabilityUrls
};
