const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const db = require("./lib/db");
const notificationSettings = require("./lib/notification-settings").createNotificationSettings();
const imgbbStorage = require("./storage/imgbbStorage");
const {
  buildLowKeyAlert,
  buildTelegramReport,
  sendTelegramReport
} = require("./lib/telegram-notifier");
const {
  getFilesAvailability,
  partitionFilesByAvailability
} = require("./lib/file-availability");
const {
  getImgBbErrorDetails,
  isImgBbInvalidKeyError,
  isImgBbRateLimitError
} = require("./lib/imgbb-errors");

function loadLocalEnv() {
  const envPath = path.join(__dirname, "../.env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match || process.env[match[1]]) {
      return;
    }

    process.env[match[1]] = match[2];
  });
}

loadLocalEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: "64mb" }));

const BASE = "https://ibb.co";
const MAX_PAGES = 25;
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const IMGBB_API_KEYS = String(process.env.IMGBB_API_KEYS || process.env.IMGBB_API_KEY || "")
  .split(/[\s,]+/)
  .map(key => key.trim())
  .filter(Boolean);
const DEFAULT_UPLOAD_EXPIRATION_SECONDS = 2592000;
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const TELEGRAM_CRON_SECRET = String(process.env.TELEGRAM_CRON_SECRET || "").trim();
const TELEGRAM_TIME_ZONE = String(process.env.TELEGRAM_TIME_ZONE || "Europe/Kyiv").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");

const cache = {};
const imageAvailabilityCache = new Map();
const imageAvailabilityChecks = new Map();
const SESSION_COOKIE = "mya_admin_session";
const IMGBB_UPLOADS_PER_KEY = 100;
const IMGBB_KEY_COOLDOWN_MS = Math.max(
  60,
  Number(process.env.IMGBB_KEY_COOLDOWN_SECONDS) || 3600
) * 1000;
const IMGBB_LOW_KEY_ALERT_THRESHOLD = Math.max(
  1,
  Number(process.env.IMGBB_LOW_KEY_ALERT_THRESHOLD) || 5
);
let imgbbApiKeyIndex = 0;
let imgbbUploadsOnCurrentKey = 0;
let imgbbLowKeyAlertActive = false;
const blockedImgBbKeys = new Map();
const invalidImgBbKeyIndexes = new Set();
const IMGBB_KEY_CHECK_IMAGE = {
  name: "mya-api-key-check.png",
  data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
};

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf("=");

      if (separatorIndex < 0) {
        return cookies;
      }

      cookies[item.slice(0, separatorIndex)] = decodeURIComponent(item.slice(separatorIndex + 1));
      return cookies;
    }, {});
}

function getAuth(req) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];

  return sessionId ? db.findSession(sessionId) : null;
}

function setSessionCookie(res, session) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(session.expiresAt).toUTCString()}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function requireManageAuth(req, res, next) {
  const auth = getAuth(req);

  if (auth) {
    req.user = auth.user;
    return next();
  }

  if (req.accepts("html") && !req.path.startsWith("/api/")) {
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl || "/manage.html")}`);
  }

  return res.status(401).json({ error: "Authentication required" });
}

function hasValidBearerSecret(req, expectedSecret) {
  const authorization = String(req.headers.authorization || "");
  const providedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);

  return Boolean(expectedSecret)
    && expected.length === provided.length
    && crypto.timingSafeEqual(expected, provided);
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function logAction(req, action, message, details = {}, level = "info", user = req.user) {
  try {
    return db.createLog({
      action,
      message,
      level,
      userId: user?.id || "",
      username: user?.username || "",
      ip: requestIp(req),
      details
    });
  } catch (err) {
    console.error("Failed to write app log:", err.message);
    return null;
  }
}

function isAdminUser(user) {
  return user?.role === "admin";
}

function clearExpiredImgBbKeyBlocks(referenceTime = Date.now()) {
  blockedImgBbKeys.forEach((block, index) => {
    if (block.blockedUntil <= referenceTime) {
      blockedImgBbKeys.delete(index);
    }
  });

  if (getImgBbAvailableKeyCount() > IMGBB_LOW_KEY_ALERT_THRESHOLD) {
    imgbbLowKeyAlertActive = false;
  }
}

function getImgBbAvailableKeyCount() {
  return Math.max(
    0,
    IMGBB_API_KEYS.length - blockedImgBbKeys.size - invalidImgBbKeyIndexes.size
  );
}

function getImgBbKeyStatus() {
  clearExpiredImgBbKeyBlocks();
  const blocked = [...blockedImgBbKeys.keys()].sort((a, b) => a - b);

  return {
    configured: IMGBB_API_KEYS.length > 0,
    currentIndex: IMGBB_API_KEYS.length ? imgbbApiKeyIndex : -1,
    total: IMGBB_API_KEYS.length,
    available: getImgBbAvailableKeyCount(),
    blocked: blocked.length,
    invalid: invalidImgBbKeyIndexes.size,
    blockedKeySuffixes: blocked.map(index => getImgBbKeySuffix(index)),
    blockedUntil: blocked.map(index => new Date(blockedImgBbKeys.get(index).blockedUntil).toISOString()),
    uploadsOnCurrentKey: imgbbUploadsOnCurrentKey,
    rotateEvery: IMGBB_UPLOADS_PER_KEY,
    cooldownSeconds: IMGBB_KEY_COOLDOWN_MS / 1000
  };
}

function maybeSendImgBbLowKeyAlert(req) {
  const keyStatus = getImgBbKeyStatus();
  const canAlert = TELEGRAM_BOT_TOKEN
    && TELEGRAM_CHAT_ID
    && keyStatus.total > IMGBB_LOW_KEY_ALERT_THRESHOLD;

  if (!canAlert || keyStatus.available > IMGBB_LOW_KEY_ALERT_THRESHOLD) {
    return;
  }

  if (imgbbLowKeyAlertActive) {
    return;
  }

  imgbbLowKeyAlertActive = true;
  const message = buildLowKeyAlert({
    keyStatus,
    manageUrl: PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/manage.html` : "",
    timeZone: TELEGRAM_TIME_ZONE
  });

  sendTelegramReport({
    botToken: TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_CHAT_ID,
    message
  }).then((result) => {
    logAction(req, "notification.telegram.keys_low", `Sent low ImgBB API key alert (${keyStatus.available}/${keyStatus.total})`, {
      messageCount: result.messageCount,
      availableKeys: keyStatus.available,
      totalKeys: keyStatus.total,
      blockedKeys: keyStatus.blocked,
      invalidKeys: keyStatus.invalid,
      threshold: IMGBB_LOW_KEY_ALERT_THRESHOLD
    });
  }).catch((err) => {
    imgbbLowKeyAlertActive = false;
    console.error("Failed to send low ImgBB API key alert:", err.response?.data?.description || err.message);
  });
}

function getImgBbKeySuffix(index) {
  return String(IMGBB_API_KEYS[index] || "").slice(-4);
}

function getNextAvailableImgBbKeyIndex(startIndex = imgbbApiKeyIndex) {
  clearExpiredImgBbKeyBlocks();

  if (!IMGBB_API_KEYS.length || blockedImgBbKeys.size + invalidImgBbKeyIndexes.size >= IMGBB_API_KEYS.length) {
    return -1;
  }

  for (let offset = 1; offset <= IMGBB_API_KEYS.length; offset += 1) {
    const candidateIndex = (startIndex + offset) % IMGBB_API_KEYS.length;

    if (!blockedImgBbKeys.has(candidateIndex) && !invalidImgBbKeyIndexes.has(candidateIndex)) {
      return candidateIndex;
    }
  }

  return -1;
}

function setCurrentImgBbKeyIndex(index) {
  imgbbApiKeyIndex = index;
  imgbbUploadsOnCurrentKey = 0;
}

function rotateImgBbKeyAfterUploadBatch(req) {
  if (IMGBB_API_KEYS.length < 2 || imgbbUploadsOnCurrentKey < IMGBB_UPLOADS_PER_KEY) {
    return;
  }

  const previousIndex = imgbbApiKeyIndex;
  const nextIndex = getNextAvailableImgBbKeyIndex(previousIndex);

  if (nextIndex < 0 || nextIndex === previousIndex) {
    imgbbUploadsOnCurrentKey = 0;
    return;
  }

  setCurrentImgBbKeyIndex(nextIndex);
  logAction(
    req,
    "upload.key.rotate",
    `Rotated ImgBB API key after ${IMGBB_UPLOADS_PER_KEY} uploaded files`,
    {
      previousKeyNumber: previousIndex + 1,
      currentKeyNumber: nextIndex + 1,
      totalKeys: IMGBB_API_KEYS.length,
      availableKeys: IMGBB_API_KEYS.length - blockedImgBbKeys.size - invalidImgBbKeyIndexes.size
    },
    "info"
  );
}

function blockImgBbKey(req, keyIndex, err, notify = true) {
  if (blockedImgBbKeys.has(keyIndex)) {
    return;
  }

  const errorDetails = getImgBbErrorDetails(err);
  const blockedUntil = Date.now() + IMGBB_KEY_COOLDOWN_MS;

  blockedImgBbKeys.set(keyIndex, { blockedUntil });
  logAction(
    req,
    "upload.key.blocked",
    `ImgBB API key ending in ${getImgBbKeySuffix(keyIndex)} is blocked by rate limit`,
    {
      keyNumber: keyIndex + 1,
      keySuffix: getImgBbKeySuffix(keyIndex),
      totalKeys: IMGBB_API_KEYS.length,
      availableKeys: IMGBB_API_KEYS.length - blockedImgBbKeys.size - invalidImgBbKeyIndexes.size,
      blockedUntil: new Date(blockedUntil).toISOString(),
      ...errorDetails
    },
    "warning"
  );

  if (notify) {
    maybeSendImgBbLowKeyAlert(req);
  }
}

function markImgBbKeyInvalid(req, keyIndex, err, notify = true) {
  blockedImgBbKeys.delete(keyIndex);

  if (invalidImgBbKeyIndexes.has(keyIndex)) {
    return;
  }

  invalidImgBbKeyIndexes.add(keyIndex);
  logAction(
    req,
    "upload.key.invalid",
    `ImgBB API key ending in ${getImgBbKeySuffix(keyIndex)} is invalid`,
    {
      keyNumber: keyIndex + 1,
      keySuffix: getImgBbKeySuffix(keyIndex),
      totalKeys: IMGBB_API_KEYS.length,
      availableKeys: IMGBB_API_KEYS.length - blockedImgBbKeys.size - invalidImgBbKeyIndexes.size,
      ...getImgBbErrorDetails(err)
    },
    "error"
  );

  if (notify) {
    maybeSendImgBbLowKeyAlert(req);
  }
}

async function checkAllImgBbApiKeys(req) {
  const results = new Array(IMGBB_API_KEYS.length);
  let nextKeyIndex = 0;

  const checkNextKey = async () => {
    while (nextKeyIndex < IMGBB_API_KEYS.length) {
      const keyIndex = nextKeyIndex;
      const apiKey = IMGBB_API_KEYS[keyIndex];
      nextKeyIndex += 1;

      try {
        await imgbbStorage.uploadImage({
          apiKey,
          image: {
            ...IMGBB_KEY_CHECK_IMAGE,
            name: `mya-api-key-check-${keyIndex + 1}.png`
          },
          expiration: 60
        });

        blockedImgBbKeys.delete(keyIndex);
        invalidImgBbKeyIndexes.delete(keyIndex);
        results[keyIndex] = { keyIndex, status: "working" };
      } catch (err) {
        if (isImgBbRateLimitError(err)) {
          invalidImgBbKeyIndexes.delete(keyIndex);
          blockedImgBbKeys.delete(keyIndex);
          blockImgBbKey(req, keyIndex, err, false);
          results[keyIndex] = { keyIndex, status: "rateLimited" };
          continue;
        }

        if (isImgBbInvalidKeyError(err)) {
          markImgBbKeyInvalid(req, keyIndex, err, false);
          results[keyIndex] = { keyIndex, status: "invalid" };
          continue;
        }

        const error = getImgBbErrorDetails(err);
        results[keyIndex] = {
          keyIndex,
          status: "unknown",
          error
        };

        logAction(req, "upload.key.check_failed", `Could not verify ImgBB API key ending in ${getImgBbKeySuffix(keyIndex)}`, {
          keyNumber: keyIndex + 1,
          keySuffix: getImgBbKeySuffix(keyIndex),
          ...error
        }, "warning");
      }
    }
  };

  await Promise.all([checkNextKey(), checkNextKey()]);
  maybeSendImgBbLowKeyAlert(req);
  const check = {
    checkedAt: new Date().toISOString(),
    working: results.filter(result => result.status === "working").length,
    rateLimited: results.filter(result => result.status === "rateLimited").length,
    invalid: results.filter(result => result.status === "invalid").length,
    unknown: results.filter(result => result.status === "unknown").length,
    rateLimitedKeySuffixes: results
      .filter(result => result.status === "rateLimited")
      .map(result => getImgBbKeySuffix(result.keyIndex)),
    invalidKeySuffixes: results
      .filter(result => result.status === "invalid")
      .map(result => getImgBbKeySuffix(result.keyIndex)),
    unknownKeySuffixes: results
      .filter(result => result.status === "unknown")
      .map(result => getImgBbKeySuffix(result.keyIndex))
  };

  logAction(req, "upload.keys.checked", `Checked ${IMGBB_API_KEYS.length} ImgBB API key(s)`, check);
  return check;
}

async function uploadImageWithImgBbKeyRotation(req, image, expiration) {
  if (!IMGBB_API_KEYS.length) {
    throw new Error("IMGBB_API_KEYS or IMGBB_API_KEY is not configured on the server");
  }

  let attempts = 0;

  while (attempts < IMGBB_API_KEYS.length) {
    clearExpiredImgBbKeyBlocks();

    if (blockedImgBbKeys.has(imgbbApiKeyIndex) || invalidImgBbKeyIndexes.has(imgbbApiKeyIndex)) {
      const nextIndex = getNextAvailableImgBbKeyIndex(imgbbApiKeyIndex);

      if (nextIndex < 0) {
        const allRateLimited = invalidImgBbKeyIndexes.size === 0;
        const err = new Error(allRateLimited
          ? "All configured ImgBB API keys are temporarily rate limited"
          : "No usable ImgBB API keys are available");
        err.status = allRateLimited ? 429 : 503;
        throw err;
      }

      setCurrentImgBbKeyIndex(nextIndex);
    }

    const keyIndex = imgbbApiKeyIndex;

    try {
      const stored = await imgbbStorage.uploadImage({
        apiKey: IMGBB_API_KEYS[keyIndex],
        image,
        expiration
      });

      imgbbUploadsOnCurrentKey += 1;
      rotateImgBbKeyAfterUploadBatch(req);

      return stored;
    } catch (err) {
      if (!isImgBbRateLimitError(err)) {
        throw err;
      }

      blockImgBbKey(req, keyIndex, err);

      const nextIndex = getNextAvailableImgBbKeyIndex(keyIndex);

      if (nextIndex < 0) {
        throw err;
      }

      setCurrentImgBbKeyIndex(nextIndex);
      attempts += 1;
    }
  }

  throw new Error("All configured ImgBB API keys are rate limited");
}

function folderLogDetails(folder) {
  return folder ? {
    folderId: folder.id,
    folderName: folder.name,
    folderPath: folder.path
  } : {};
}

function mapImageObject(item) {
  const medium = item.medium?.url || item.display_url;
  const original = item.image?.url || item.url;

  if (!medium || !original) {
    return null;
  }

  return {
    id: item.id_encoded,
    title: item.title || item.name || item.image?.name || "",
    filename: item.filename || item.image?.filename || "",
    width: Number(item.width) || null,
    height: Number(item.height) || null,
    medium,
    original
  };
}

function extractImages(html) {
  const $ = cheerio.load(html);
  const images = [];

  $("[data-object]").each((_, element) => {
    const encoded = $(element).attr("data-object");

    if (!encoded) {
      return;
    }

    try {
      const item = JSON.parse(decodeURIComponent(encoded));
      const image = mapImageObject(item);

      if (image) {
        images.push(image);
      }
    } catch (err) {
      // Ignore malformed entries from the external page and keep parsing.
    }
  });

  return images;
}

function extractAlbumMetadata(html) {
  const $ = cheerio.load(html);
  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $('[data-text="album-name"]').first().text() ||
    $("h1").first().text() ||
    ""
  ).trim();
  const subtitle = (
    $('meta[property="og:description"]').attr("content") ||
    $('[data-text="album-description"]').first().text() ||
    $('meta[name="description"]').attr("content") ||
    ""
  ).trim();

  return {
    title,
    subtitle
  };
}

function getNextPageUrl(html) {
  const $ = cheerio.load(html);
  const nextUrl = $(".pagination-next:not(.pagination-disabled) a[href]").attr("href");

  if (!nextUrl) {
    return null;
  }

  return new URL(nextUrl, BASE).toString();
}

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && parsed.hostname === "i.ibb.co";
  } catch (err) {
    return false;
  }
}

async function isImageUrlAvailable(url) {
  if (!url || !isAllowedImageUrl(url)) {
    return false;
  }

  const cached = imageAvailabilityCache.get(url);

  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.available;
  }

  if (imageAvailabilityChecks.has(url)) {
    return imageAvailabilityChecks.get(url);
  }

  const check = (async () => {
    let available = false;

    try {
      const response = await axios.head(url, {
        timeout: 5000,
        maxRedirects: 3,
        validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const contentType = String(response.headers["content-type"] || "").toLowerCase();

      available = response.status >= 200
        && response.status < 300
        && contentType.startsWith("image/");
    } catch (err) {
      available = false;
    }

    imageAvailabilityCache.set(url, { available, checkedAt: Date.now() });
    return available;
  })();

  imageAvailabilityChecks.set(url, check);
  try {
    return await check;
  } finally {
    imageAvailabilityChecks.delete(url);
  }
}

async function isStoredImageAvailable(file) {
  const thumbnailUrl = file.mediumUrl || file.originalUrl;
  const originalUrl = file.originalUrl || thumbnailUrl;

  if (await isImageUrlAvailable(thumbnailUrl)) {
    return true;
  }

  return originalUrl !== thumbnailUrl && isImageUrlAvailable(originalUrl);
}

async function partitionStoredImagesByAvailability(files) {
  const valid = Array(files.length).fill(false);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      valid[index] = await isStoredImageAvailable(files[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker));

  return files.reduce((result, file, index) => {
    result[valid[index] ? "available" : "unavailable"].push(file);
    return result;
  }, { available: [], unavailable: [] });
}

async function removeStoredImgBbImage(deleteUrl) {
  if (!deleteUrl || !String(deleteUrl).startsWith("https://ibb.co/")) {
    return;
  }

  try {
    await axios.get(deleteUrl, {
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
  } catch (err) {
    console.error("Failed to remove unavailable ImgBB upload:", err.message);
  }
}

async function fetchStoredImage(url) {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 15000,
    maxRedirects: 3,
    validateStatus: () => true,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const contentType = String(response.headers["content-type"] || "").toLowerCase();

  if (response.status >= 200 && response.status < 300 && contentType.startsWith("image/")) {
    return response;
  }

  response.data.destroy();
  return null;
}

function crc32(buffer) {
  let crc = 0 ^ -1;

  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function createZip(filename, content) {
  const nameBuffer = Buffer.from(filename);
  const contentBuffer = Buffer.from(content);
  const checksum = crc32(contentBuffer);
  const localHeader = Buffer.alloc(30);

  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(contentBuffer.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(contentBuffer.length, 20);
  centralHeader.writeUInt32LE(contentBuffer.length, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirectoryOffset = localHeader.length + nameBuffer.length + contentBuffer.length;
  const centralDirectorySize = centralHeader.length + nameBuffer.length;
  const endRecord = Buffer.alloc(22);

  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([
    localHeader,
    nameBuffer,
    contentBuffer,
    centralHeader,
    nameBuffer,
    endRecord
  ]);
}

function extractJsonFromZip(zipBuffer) {
  const localHeaderOffset = zipBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  if (localHeaderOffset < 0) {
    throw new Error("ZIP backup does not contain a readable database file");
  }

  const compressionMethod = zipBuffer.readUInt16LE(localHeaderOffset + 8);
  const compressedSize = zipBuffer.readUInt32LE(localHeaderOffset + 18);
  const filenameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + filenameLength + extraLength;
  const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    return compressedData.toString("utf8");
  }

  if (compressionMethod === 8) {
    return zlib.inflateRawSync(compressedData).toString("utf8");
  }

  throw new Error("Unsupported ZIP compression method");
}

function parseImportedBackup(data) {
  const buffer = Buffer.from(String(data || ""), "base64");

  if (buffer.length < 2) {
    throw new Error("Import file is empty");
  }

  const content = buffer[0] === 0x50 && buffer[1] === 0x4b
    ? extractJsonFromZip(buffer)
    : buffer.toString("utf8");

  return JSON.parse(content);
}

async function fetchAlbumPage(url) {
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  return html;
}

async function fetchAlbumImages(id) {
  const images = [];
  const seen = new Set();
  let metadata = {
    title: "",
    subtitle: ""
  };
  let url = `${BASE}/album/${id}`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    page += 1;
    const html = await fetchAlbumPage(url);

    if (page === 1) {
      metadata = extractAlbumMetadata(html);
    }

    for (const image of extractImages(html)) {
      const key = image.id || image.original;

      if (!seen.has(key)) {
        seen.add(key);
        images.push(image);
      }
    }

    url = getNextPageUrl(html);
  }

  return {
    ...metadata,
    images
  };
}

app.get("/api/album/:id", async (req, res) => {
  const { id } = req.params;
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const cached = cache[id];
    const isCacheFresh = cached && Date.now() - cached.updatedAt < CACHE_TTL_MS;

    if (forceRefresh || !isCacheFresh) {
      cache[id] = {
        data: await fetchAlbumImages(id),
        updatedAt: Date.now()
      };
    }

    const album = cache[id].data;
    const images = album.images;

    if (images.length === 0) {
      return res.status(500).json({
        error: "No images found in the album markup"
      });
    }

    res.json({
      id,
      title: album.title,
      subtitle: album.subtitle,
      count: images.length,
      images
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to load album" });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, filename } = req.query;

  if (!url || !isAllowedImageUrl(url)) {
    return res.status(400).json({ error: "Invalid image URL" });
  }

  try {
    const image = await axios.get(url, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });
    const safeFilename = (filename || url.split("/").pop() || "image").replace(/["\r\n]/g, "");

    res.setHeader("Content-Type", image.headers["content-type"] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);

    image.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to download image" });
  }
});

app.get("/api/managed-image", requireManageAuth, async (req, res) => {
  const primaryUrl = String(req.query.url || "");
  const fallbackUrl = String(req.query.fallback || "");
  const urls = [...new Set([primaryUrl, fallbackUrl].filter(isAllowedImageUrl))];

  if (!urls.length) {
    return res.status(400).json({ error: "Invalid image URL" });
  }

  try {
    for (const url of urls) {
      const image = await fetchStoredImage(url);

      if (!image) {
        continue;
      }

      res.setHeader("Content-Type", image.headers["content-type"] || "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=300");
      image.data.pipe(res);
      return;
    }

    return res.status(404).json({ error: "Image is unavailable" });
  } catch (err) {
    console.error("Failed to load managed image:", err.message);
    return res.status(502).json({ error: "Failed to load image" });
  }
});

app.get("/api/folders", (req, res) => {
  const state = ["active", "deleted", "all"].includes(req.query.state)
    ? req.query.state
    : "active";

  if (state !== "active" && !getAuth(req)) {
    return res.status(401).json({ error: "Authentication required" });
  }

  res.json({ folders: db.listFolders({ state }) });
});

app.get("/api/auth/status", (req, res) => {
  const auth = getAuth(req);

  res.json({
    hasAccounts: db.hasUsers(),
    authenticated: Boolean(auth),
    user: auth?.user || null
  });
});

app.post("/api/auth/setup", (req, res) => {
  if (db.hasUsers()) {
    return res.status(400).json({ error: "An account already exists" });
  }

  try {
    const user = db.createUser(req.body.username, req.body.password);
    const session = db.createSession(user.id);

    setSessionCookie(res, session);
    logAction(req, "auth.setup", `Created admin account "${user.username}"`, { username: user.username }, "info", user);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const user = db.verifyUser(req.body.username, req.body.password);

  if (!user) {
    logAction(req, "auth.login_failed", "Failed admin login", { username: String(req.body.username || "").trim() }, "warn");
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const session = db.createSession(user.id);

  setSessionCookie(res, session);
  logAction(req, "auth.login", `Admin "${user.username}" signed in`, { username: user.username }, "info", user);
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = parseCookies(req)[SESSION_COOKIE];
  const auth = sessionId ? db.findSession(sessionId) : null;

  if (sessionId) {
    db.deleteSession(sessionId);
  }

  clearSessionCookie(res);
  logAction(req, "auth.logout", "Admin signed out", {}, "info", auth?.user);
  res.json({ ok: true });
});

app.get("/api/preferences", requireManageAuth, (req, res) => {
  res.json({
    preferences: req.user.preferences || {}
  });
});

app.patch("/api/preferences", requireManageAuth, (req, res) => {
  try {
    const preferences = db.updateUserPreferences(req.user.id, {
      preferredUploadPeriod: String(req.body.preferredUploadPeriod || "").trim()
    });

    logAction(req, "preferences.update", "Updated preferences", {
      fields: ["preferredUploadPeriod"]
    });
    res.json({ preferences });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update preferences" });
  }
});

app.get("/api/db/export", requireManageAuth, (req, res) => {
  const exportedDb = db.exportDb();
  const filename = `imgbb-gallery-db-${new Date().toISOString().slice(0, 10)}.zip`;
  const zip = createZip("db.json", JSON.stringify(exportedDb, null, 2));

  logAction(req, "db.export", "Exported database backup", { filename });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zip);
});

app.post("/api/db/import", requireManageAuth, (req, res) => {
  const mode = req.body.mode === "replace" ? "replace" : "update";

  try {
    const importedDb = parseImportedBackup(req.body.data);
    const summary = mode === "replace"
      ? db.replaceDb(importedDb)
      : db.mergeDb(importedDb);

    logAction(req, "db.import", `Imported database backup with ${mode} mode`, { mode, summary });
    res.json({
      ok: true,
      summary
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to import database" });
  }
});

app.get("/api/logs", requireManageAuth, (req, res) => {
  res.json({
    logs: db.listLogs({
      limit: req.query.limit,
      action: req.query.action,
      level: req.query.level
    })
  });
});

function getPeriodStartDate(description) {
  const value = String(description || "");
  const yearFirst = value.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  const dayFirst = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const parts = yearFirst
    ? [yearFirst[1], yearFirst[2], yearFirst[3]]
    : dayFirst ? [dayFirst[3], dayFirst[2], dayFirst[1]] : null;

  if (!parts) return "";

  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

app.get("/api/statistics", requireManageAuth, (req, res) => {
  const folders = db.listFolders();
  const filesByFolderId = new Map();
  db.listAllFiles("all").forEach(file => {
    const files = filesByFolderId.get(file.folderId) || [];
    files.push(file);
    filesByFolderId.set(file.folderId, files);
  });
  const folderById = new Map(folders.map(folder => [folder.id, folder]));
  const childFolderIds = new Set(folders.map(folder => folder.parentId).filter(Boolean));
  const rows = folders.map(folder => {
    const files = filesByFolderId.get(folder.id) || [];

    if (!files.length) return null;

    const locationFolder = folder.parentId ? folderById.get(folder.parentId) : null;
    const companyFolder = locationFolder?.parentId ? folderById.get(locationFolder.parentId) : null;
    const uploadedAt = files
      .map(file => file.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null;

    return {
      company: companyFolder?.name || "—",
      location: locationFolder?.name || "—",
      period: folder.name,
      total: files.length,
      approved: files.filter(file => file.status === "approved").length,
      pending: files.filter(file => file.status !== "approved").length,
      uploadedAt
    };
  }).filter(Boolean);

  const completionRows = folders
    .filter(folder => folder.parentId && !childFolderIds.has(folder.id))
    .map(folder => {
      const files = filesByFolderId.get(folder.id) || [];
      const locationFolder = folderById.get(folder.parentId);
      const companyFolder = locationFolder?.parentId ? folderById.get(locationFolder.parentId) : null;
      const startDate = getPeriodStartDate(folder.description);
      const uploadDates = files.map(file => file.createdAt).filter(Boolean).sort();

      return {
        company: companyFolder?.name || "—",
        location: locationFolder?.name || "—",
        period: folder.name,
        startDate,
        total: files.length,
        firstUploadedAt: uploadDates[0] || null
      };
    });

  res.json({ rows, completionRows });
});

app.delete("/api/logs", requireManageAuth, (req, res) => {
  const count = db.clearLogs();

  logAction(req, "logs.clear", `Cleared ${count} log entries`, { count });
  res.json({ ok: true, count });
});

app.post("/api/folders", requireManageAuth, (req, res) => {
  try {
    const folder = db.createFolder(req.body.name, req.body.parentId || null, req.body.description || "");
    logAction(req, "folder.create", `Created folder "${folder.name}"`, folderLogDetails(folder));
    res.status(201).json({ folder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/folders/:id", requireManageAuth, (req, res) => {
  try {
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      updates.name = req.body.name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "parentId")) {
      updates.parentId = req.body.parentId;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      updates.description = req.body.description;
    }

    const folder = db.updateFolder(req.params.id, {
      ...updates
    });
    logAction(req, "folder.update", `Updated folder "${folder.name}"`, {
      ...folderLogDetails(folder),
      fields: Object.keys(updates)
    });
    res.json({ folder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/folders/:id/order", requireManageAuth, (req, res) => {
  try {
    const folder = db.reorderFolder(req.params.id, req.body.direction);
    logAction(req, "folder.reorder", `Reordered folder "${folder.name}"`, {
      ...folderLogDetails(folder),
      direction: req.body.direction
    });
    res.json({ folder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/folders/:id", requireManageAuth, (req, res) => {
  const permanent = req.query.permanent === "1" || req.query.permanent === "true";
  const folder = db.findFolder(req.params.id, { includeDeleted: permanent });

  if (permanent) {
    db.permanentlyDeleteFolder(req.params.id);
    logAction(req, "folder.delete_permanent", folder ? `Permanently deleted folder "${folder.name}"` : "Permanently deleted folder", folderLogDetails(folder));
    return res.json({ ok: true, permanent: true });
  }

  db.deleteFolder(req.params.id);
  logAction(req, "folder.delete", folder ? `Moved folder "${folder.name}" to bin` : "Moved folder to bin", folderLogDetails(folder));
  res.json({ ok: true, deleted: true });
});

app.post("/api/folders/:id/restore", requireManageAuth, (req, res) => {
  const folder = db.findFolder(req.params.id, { includeDeleted: true });

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  db.restoreFolder(req.params.id);
  logAction(req, "folder.restore", `Restored folder "${folder.name}"`, folderLogDetails(folder));
  res.json({ ok: true });
});

app.get("/api/folders/:id/files", requireManageAuth, async (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const files = db.listFiles(folder.id, req.query.status || "all");

  if (req.query.validate !== "1") {
    return res.json({ folder, files });
  }

  const { unavailable } = await partitionStoredImagesByAvailability(files);

  res.json({
    folder,
    files,
    invalidFileIds: unavailable.map(file => file.id)
  });
});

app.post("/api/folders/:id/files/approve-all", requireManageAuth, async (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const recursive = req.query.recursive === "1";
  const folders = recursive
    ? db.listFolders().filter(item => item.id === folder.id || item.path.startsWith(`${folder.path}/`))
    : [folder];
  const pendingFiles = folders.flatMap(item => db.listFiles(item.id, "all"))
    .filter(file => file.status !== "approved");
  const { available, unavailable } = await partitionStoredImagesByAvailability(pendingFiles);

  available.forEach(file => {
    db.updateFile(file.id, { status: "approved", approvedBy: "admin" });
  });
  const count = available.length;

  logAction(req, "files.approve_all", `Approved ${count} waiting file(s) in "${folder.name}"`, {
    ...folderLogDetails(folder),
    recursive,
    count,
    unavailableCount: unavailable.length
  });
  res.json({
    ok: true,
    count,
    unavailableCount: unavailable.length
  });
});

app.delete("/api/folders/:id/files", requireManageAuth, (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const count = db.deleteFolderFiles(folder.id);

  logAction(req, "files.delete_all", `Deleted ${count} file(s) from "${folder.name}"`, {
    ...folderLogDetails(folder),
    count
  });
  res.json({
    ok: true,
    count
  });
});

function getFolderDisplayPath(folder, folders) {
  const segments = [folder.name];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = folders.find(item => item.id === parentId);

    if (!parent) {
      break;
    }

    segments.unshift(parent.name);
    parentId = parent.parentId;
  }

  return segments.join(" / ");
}

function getFolderParentDisplayPath(folder, folders) {
  if (!folder.parentId) {
    return "";
  }

  const parent = folders.find(item => item.id === folder.parentId);

  return parent ? getFolderDisplayPath(parent, folders) : "";
}

app.get("/api/gallery/folders/:id", (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const files = db.listFiles(folder.id, "approved");
  const now = new Date();
  const {
    available: availableFiles,
    expired: expiredFiles
  } = partitionFilesByAvailability(files, now);
  const allFolders = db.listFolders();
  const folders = allFolders
    .filter(item => item.parentId === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  res.json({
    id: folder.id,
    path: folder.path,
    displayPath: getFolderDisplayPath(folder, allFolders),
    title: folder.name,
    subtitle: getFolderParentDisplayPath(folder, allFolders) || getFolderDisplayPath(folder, allFolders),
    count: availableFiles.length,
    expiredCount: expiredFiles.length,
    availability: getFilesAvailability(availableFiles),
    folders: folders.map(item => {
      const childFiles = db.listFiles(item.id, "approved");
      const childAvailability = partitionFilesByAvailability(childFiles, now);

      return {
        id: item.id,
        name: item.name,
        path: item.path,
        displayPath: getFolderDisplayPath(item, allFolders),
        parentDisplayPath: getFolderParentDisplayPath(item, allFolders),
        description: item.description,
        filesCount: item.filesCount,
        approvedCount: childAvailability.available.length,
        expiredCount: childAvailability.expired.length,
        pendingCount: item.pendingCount
      };
    }),
    images: availableFiles.map(file => ({
      id: file.id,
      title: file.title,
      filename: file.filename,
      width: file.width || null,
      height: file.height || null,
      medium: file.mediumUrl,
      original: file.originalUrl
    }))
  });
});

app.patch("/api/files/:id", requireManageAuth, (req, res) => {
  try {
    const file = db.updateFile(req.params.id, req.body);
    logAction(req, "file.update", `Updated file "${file.title || file.filename || file.id}"`, {
      fileId: file.id,
      folderId: file.folderId,
      status: file.status,
      fields: Object.keys(req.body || {})
    });
    res.json({ file });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/files/:id/approve", requireManageAuth, (req, res) => {
  try {
    const file = db.updateFile(req.params.id, {
      status: "approved",
      approvedBy: "admin"
    });
    logAction(req, "file.approve", `Approved file "${file.title || file.filename || file.id}"`, {
      fileId: file.id,
      folderId: file.folderId
    });
    res.json({ file });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/files/:id", requireManageAuth, (req, res) => {
  const file = db.findFile(req.params.id);

  db.deleteFile(req.params.id);
  logAction(req, "file.delete", file ? `Deleted file "${file.title || file.filename || file.id}"` : "Deleted file", {
    fileId: req.params.id,
    folderId: file?.folderId || ""
  });
  res.json({ ok: true });
});

app.get("/api/upload/key-status", requireManageAuth, (req, res) => {
  res.json(getImgBbKeyStatus());
});

app.post("/api/upload/key-status/refresh", requireManageAuth, async (req, res) => {
  if (!IMGBB_API_KEYS.length) {
    return res.status(503).json({ error: "IMGBB_API_KEYS or IMGBB_API_KEY is not configured on the server" });
  }

  try {
    const check = await checkAllImgBbApiKeys(req);

    res.json({
      ...getImgBbKeyStatus(),
      check
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Failed to check ImgBB API keys" });
  }
});

app.get("/api/notifications/telegram/settings", requireManageAuth, (req, res) => {
  res.json({ enabled: notificationSettings.isEnabled(), configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) });
});

app.patch("/api/notifications/telegram/settings", requireManageAuth, (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  notificationSettings.setEnabled(req.body.enabled);
  logAction(req, "notification.telegram.settings", `Scheduled Telegram reports ${req.body.enabled ? "enabled" : "disabled"}`);
  res.json({ enabled: req.body.enabled, configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) });
});

app.post("/api/notifications/telegram", async (req, res) => {
  if (!TELEGRAM_CRON_SECRET || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(503).json({ error: "Telegram notifications are not configured" });
  }

  if (!hasValidBearerSecret(req, TELEGRAM_CRON_SECRET)) {
    return res.status(401).json({ error: "Invalid notification secret" });
  }

  try {
    if (!notificationSettings.isEnabled()) {
      return res.json({ ok: true, skipped: true, reason: "Scheduled Telegram reports are disabled" });
    }
    const keyStatus = getImgBbKeyStatus();
    const folders = db.listFolders();
    const message = buildTelegramReport({
      keyStatus,
      folders,
      manageUrl: PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/manage.html` : "",
      timeZone: TELEGRAM_TIME_ZONE
    });
    const result = await notificationSettings.sendReportIfChanged({
      message,
      chatId: TELEGRAM_CHAT_ID,
      send: () => sendTelegramReport({
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: TELEGRAM_CHAT_ID,
        message
      })
    });
    if (result.skipped) return res.json({ ok: true, ...result });
    const sentAt = new Date().toISOString();

    logAction(req, "notification.telegram", "Sent scheduled Telegram status report", {
      messageCount: result.messageCount,
      pendingCount: folders.reduce((total, folder) => total + Number(folder.pendingCount || 0), 0),
      availableKeys: keyStatus.available,
      totalKeys: keyStatus.total
    });
    res.json({ ok: true, sentAt, messageCount: result.messageCount });
  } catch (err) {
    const providerMessage = err.response?.data?.description || err.message;

    console.error("Failed to send Telegram notification:", providerMessage);
    res.status(502).json({
      error: providerMessage
        ? `Failed to send Telegram notification: ${providerMessage}`
        : "Failed to send Telegram notification"
    });
  }
});

app.post("/api/upload", async (req, res) => {
  const { images, expiration, folderId, folderSlug } = req.body;
  const auth = getAuth(req);

  if (!IMGBB_API_KEYS.length) {
    return res.status(500).json({ error: "IMGBB_API_KEYS or IMGBB_API_KEY is not configured on the server" });
  }

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "No images provided" });
  }

  try {
    const requestedExpirationSeconds = Number(expiration) || null;
    const expirationSeconds = isAdminUser(auth?.user)
      ? requestedExpirationSeconds
      : DEFAULT_UPLOAD_EXPIRATION_SECONDS;
    const folder = folderId || folderSlug
      ? db.findFolder(folderId || folderSlug)
      : db.getOrCreateDefaultFolder();

    if (!folder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const storedImages = [];
    const failedFiles = [];

    for (const image of images) {
      let stored = await uploadImageWithImgBbKeyRotation(req, image, expirationSeconds);

      if (!await isStoredImageAvailable(stored)) {
        await removeStoredImgBbImage(stored.deleteUrl);
        stored = await uploadImageWithImgBbKeyRotation(req, image, expirationSeconds);

        if (!await isStoredImageAvailable(stored)) {
          await removeStoredImgBbImage(stored.deleteUrl);
          failedFiles.push(image.name || "Unnamed file");
          continue;
        }
      }

      storedImages.push({
        folderId: folder.id,
        provider: stored.provider,
        providerFileId: stored.providerFileId,
        filename: stored.filename,
        title: stored.title,
        mediumUrl: stored.mediumUrl,
        originalUrl: stored.originalUrl,
        deleteUrl: stored.deleteUrl,
        expirationSeconds,
        uploadedBy: "manager"
      });
    }
    const uploaded = db.createFiles(storedImages);

    logAction(req, "upload.create", `Uploaded ${uploaded.length} image(s) to "${folder.name}"`, {
      ...folderLogDetails(folder),
      count: uploaded.length,
      expiration: expirationSeconds,
      failedFiles
    });
    res.json({
      folder,
      count: uploaded.length,
      images: uploaded,
      failedFiles
    });
  } catch (err) {
    const errorDetails = getImgBbErrorDetails(err);
    const providerMessage = errorDetails.providerMessage;
    const providerStatus = errorDetails.providerStatus || 500;

    console.error("Failed to upload images:", providerMessage);
    logAction(req, "upload.failed", `ImgBB upload failed: ${providerMessage}`, {
      folderId: folderId || folderSlug || "",
      rateLimited: isImgBbRateLimitError(err),
      ...errorDetails
    }, "error", auth?.user);
    const responseStatus = providerStatus === 429
      ? 429
      : (providerStatus >= 400 && providerStatus < 500 ? 400 : 502);

    res.status(responseStatus).json({
      error: providerMessage ? `Failed to upload images: ${providerMessage}` : "Failed to upload images"
    });
  }
});

app.get("/manage.html", requireManageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/manage.html"));
});

app.get("/statistics.html", requireManageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/statistics.html"));
});

app.use(express.static(path.join(__dirname, "../client")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
