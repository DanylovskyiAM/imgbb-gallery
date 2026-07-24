function getFileExpirationDate(file) {
  const createdAt = new Date(file.createdAt);
  const expirationSeconds = Number(file.expirationSeconds || file.expiration) || 0;

  if (!file.createdAt || Number.isNaN(createdAt.getTime()) || expirationSeconds <= 0) {
    return null;
  }

  return new Date(createdAt.getTime() + expirationSeconds * 1000);
}

function isFileExpired(file, now = new Date()) {
  const expirationDate = getFileExpirationDate(file);

  return Boolean(expirationDate && expirationDate.getTime() <= now.getTime());
}

function partitionFilesByAvailability(files, now = new Date()) {
  return files.reduce((result, file) => {
    if (isFileExpired(file, now)) {
      result.expired.push(file);
    } else {
      result.available.push(file);
    }

    return result;
  }, { available: [], expired: [] });
}

function getFilesAvailability(files) {
  const expirationDates = files
    .map(getFileExpirationDate)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!expirationDates.length) {
    return null;
  }

  return {
    availableUntil: expirationDates[0].toISOString()
  };
}

module.exports = {
  getFileExpirationDate,
  getFilesAvailability,
  isFileExpired,
  partitionFilesByAvailability
};
