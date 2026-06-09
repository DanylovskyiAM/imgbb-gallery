const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const db = require("./lib/db");
const imgbbStorage = require("./storage/imgbbStorage");

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
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

const cache = {};
const SESSION_COOKIE = "mya_admin_session";

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

app.get("/api/folders", (req, res) => {
  res.json({ folders: db.listFolders() });
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
  const folder = db.findFolder(req.params.id);

  db.deleteFolder(req.params.id);
  logAction(req, "folder.delete", folder ? `Deleted folder "${folder.name}"` : "Deleted folder", folderLogDetails(folder));
  res.json({ ok: true });
});

app.get("/api/folders/:id/files", requireManageAuth, (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  res.json({
    folder,
    files: db.listFiles(folder.id, req.query.status || "all")
  });
});

app.post("/api/folders/:id/files/approve-all", requireManageAuth, (req, res) => {
  const folder = db.findFolder(req.params.id);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const recursive = req.query.recursive === "1";
  const count = recursive
    ? db.approveFolderTreeFiles(folder.id)
    : db.approveFolderFiles(folder.id);

  logAction(req, "files.approve_all", `Approved ${count} waiting file(s) in "${folder.name}"`, {
    ...folderLogDetails(folder),
    recursive,
    count
  });
  res.json({
    ok: true,
    count
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
    count: files.length,
    folders: folders.map(item => ({
      id: item.id,
      name: item.name,
      path: item.path,
      displayPath: getFolderDisplayPath(item, allFolders),
      parentDisplayPath: getFolderParentDisplayPath(item, allFolders),
      description: item.description,
      filesCount: item.filesCount,
      approvedCount: item.approvedCount,
      pendingCount: item.pendingCount
    })),
    images: files.map(file => ({
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

app.post("/api/upload", async (req, res) => {
  const { images, expiration, folderId, folderSlug } = req.body;

  if (!IMGBB_API_KEY) {
    return res.status(500).json({ error: "IMGBB_API_KEY is not configured on the server" });
  }

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "No images provided" });
  }

  try {
    const expirationSeconds = Number(expiration) || null;
    const folder = folderId || folderSlug
      ? db.findFolder(folderId || folderSlug)
      : db.getOrCreateDefaultFolder();

    if (!folder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const storedImages = await Promise.all(images.map(async (image) => {
      const stored = await imgbbStorage.uploadImage({
        apiKey: IMGBB_API_KEY,
        image,
        expiration: expirationSeconds
      });

      return {
        folderId: folder.id,
        provider: stored.provider,
        providerFileId: stored.providerFileId,
        filename: stored.filename,
        title: stored.title,
        mediumUrl: stored.mediumUrl,
        originalUrl: stored.originalUrl,
        deleteUrl: stored.deleteUrl,
        uploadedBy: "manager"
      };
    }));
    const uploaded = db.createFiles(storedImages);

    logAction(req, "upload.create", `Uploaded ${uploaded.length} image(s) to "${folder.name}"`, {
      ...folderLogDetails(folder),
      count: uploaded.length,
      expiration: expirationSeconds
    });
    res.json({
      folder,
      count: uploaded.length,
      images: uploaded
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload images" });
  }
});

app.get("/manage.html", requireManageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/manage.html"));
});

app.use(express.static(path.join(__dirname, "../client")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
