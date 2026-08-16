const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "db.sqlite");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOGS = 1000;
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "qwerty",
  "qwerty123",
  "admin",
  "admin123",
  "letmein",
  "welcome",
  "welcome123",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000"
]);

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "folder";
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  getSqlite();
}

let sqlite = null;

function getSqlite() {
  if (sqlite) {
    return sqlite;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      parentId TEXT,
      slug TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      sortOrder INTEGER,
      updatedAt TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parentId);
    CREATE INDEX IF NOT EXISTS idx_folders_slug ON folders(slug);
    CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path);

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      folderId TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_folder_status ON files(folderId, status);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      usernameLower TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expiresAt TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      createdAt TEXT,
      level TEXT,
      action TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(createdAt);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
  `);

  migrateJsonDbIfNeeded(sqlite);

  return sqlite;
}

function parseRows(rows) {
  return rows.map(row => JSON.parse(row.data));
}

function readDb() {
  ensureDb();
  const sql = getSqlite();
  const db = {
    folders: parseRows(sql.prepare("SELECT data FROM folders").all()),
    files: parseRows(sql.prepare("SELECT data FROM files").all()),
    users: parseRows(sql.prepare("SELECT data FROM users").all()),
    sessions: parseRows(sql.prepare("SELECT data FROM sessions").all()),
    logs: parseRows(sql.prepare("SELECT data FROM logs").all())
  };

  normalizeDb(db);

  return db;
}

function writeDb(db) {
  normalizeDb(db);
  const sql = getSqlite();
  const replace = sql.transaction((nextDb) => {
    sql.prepare("DELETE FROM folders").run();
    sql.prepare("DELETE FROM files").run();
    sql.prepare("DELETE FROM users").run();
    sql.prepare("DELETE FROM sessions").run();
    sql.prepare("DELETE FROM logs").run();

    const insertFolder = sql.prepare(`
      INSERT INTO folders (id, parentId, slug, path, name, sortOrder, updatedAt, data)
      VALUES (@id, @parentId, @slug, @path, @name, @sortOrder, @updatedAt, @data)
    `);
    const insertFile = sql.prepare(`
      INSERT INTO files (id, folderId, status, createdAt, updatedAt, data)
      VALUES (@id, @folderId, @status, @createdAt, @updatedAt, @data)
    `);
    const insertUser = sql.prepare(`
      INSERT INTO users (id, usernameLower, data)
      VALUES (@id, @usernameLower, @data)
    `);
    const insertSession = sql.prepare(`
      INSERT INTO sessions (id, userId, expiresAt, data)
      VALUES (@id, @userId, @expiresAt, @data)
    `);
    const insertLog = sql.prepare(`
      INSERT INTO logs (id, createdAt, level, action, data)
      VALUES (@id, @createdAt, @level, @action, @data)
    `);

    nextDb.folders.forEach(folder => insertFolder.run({
      id: folder.id,
      parentId: folder.parentId || null,
      slug: folder.slug || "",
      path: folder.path || "",
      name: folder.name || "",
      sortOrder: Number(folder.sortOrder) || 0,
      updatedAt: folder.updatedAt || "",
      data: JSON.stringify(folder)
    }));
    nextDb.files.forEach(file => insertFile.run({
      id: file.id,
      folderId: file.folderId || "",
      status: file.status || "pending",
      createdAt: file.createdAt || "",
      updatedAt: file.updatedAt || "",
      data: JSON.stringify(file)
    }));
    nextDb.users.forEach(user => insertUser.run({
      id: user.id,
      usernameLower: String(user.username || "").toLowerCase(),
      data: JSON.stringify(user)
    }));
    nextDb.sessions.forEach(session => insertSession.run({
      id: session.id,
      userId: session.userId || "",
      expiresAt: session.expiresAt || "",
      data: JSON.stringify(session)
    }));
    nextDb.logs.forEach(log => insertLog.run({
      id: log.id,
      createdAt: log.createdAt || "",
      level: log.level || "info",
      action: log.action || "action",
      data: JSON.stringify(log)
    }));
  });

  replace(db);
}

function migrateJsonDbIfNeeded(sql) {
  const marker = path.join(DATA_DIR, ".sqlite-migrated");
  const jsonPath = path.join(DATA_DIR, "db.json");
  const hasSqliteData = sql.prepare(`
    SELECT
      (SELECT COUNT(*) FROM folders) +
      (SELECT COUNT(*) FROM files) +
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM sessions) +
      (SELECT COUNT(*) FROM logs) AS count
  `).get().count > 0;

  if (hasSqliteData || fs.existsSync(marker) || !fs.existsSync(jsonPath)) {
    return;
  }

  const importedDb = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  writeDb(importedDb);
  fs.writeFileSync(marker, new Date().toISOString());
}

function normalizeDb(db) {
  db.folders = Array.isArray(db.folders) ? db.folders : [];
  db.files = Array.isArray(db.files) ? db.files : [];
  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.logs = Array.isArray(db.logs) ? db.logs : [];

  const siblingCounters = {};
  const timestamp = now();

  db.sessions = db.sessions.filter(session => !session.expiresAt || new Date(session.expiresAt) > new Date(timestamp));
  db.logs = db.logs.slice(-MAX_LOGS);

  db.folders.forEach((folder) => {
    const parentKey = folder.parentId || "root";

    if (!folder.description) {
      folder.description = "";
    }

    if (!Number.isFinite(folder.sortOrder)) {
      siblingCounters[parentKey] = (siblingCounters[parentKey] || 0) + 1;
      folder.sortOrder = siblingCounters[parentKey];
    }
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");

  return { salt, hash };
}

function validatePassword(password, username = "") {
  const value = String(password || "");
  const normalized = value.toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();

  if (value.length < 10) {
    throw new Error("Password must be at least 10 characters");
  }

  if (/^\d+$/.test(value)) {
    throw new Error("Password cannot contain only numbers");
  }

  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) {
    throw new Error("Password must include uppercase and lowercase letters");
  }

  if (!/\d/.test(value)) {
    throw new Error("Password must include at least one number");
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    throw new Error("Password must include at least one special symbol");
  }

  if (COMMON_PASSWORDS.has(normalized)) {
    throw new Error("Password is too common");
  }

  if (normalizedUsername && normalized.includes(normalizedUsername)) {
    throw new Error("Password cannot contain the username");
  }
}

function hasUsers() {
  const db = readDb();

  return db.users.length > 0;
}

function publicUser(user) {
  return user ? {
    id: user.id,
    username: user.username,
    role: user.role || "admin",
    preferences: user.preferences && typeof user.preferences === "object" ? user.preferences : {},
    createdAt: user.createdAt
  } : null;
}

function createUser(username, password) {
  const db = readDb();
  const name = String(username || "").trim();

  if (!name) {
    throw new Error("Username is required");
  }

  validatePassword(password, name);

  if (db.users.some(user => user.username.toLowerCase() === name.toLowerCase())) {
    throw new Error("An account with this username already exists");
  }

  const timestamp = now();
  const passwordHash = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username: name,
    role: "admin",
    passwordSalt: passwordHash.salt,
    passwordHash: passwordHash.hash,
    preferences: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.users.push(user);
  writeDb(db);

  return publicUser(user);
}

function verifyUser(username, password) {
  const db = readDb();
  const user = db.users.find(item => item.username.toLowerCase() === String(username || "").trim().toLowerCase());

  if (!user) {
    return null;
  }

  const passwordHash = hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(passwordHash.hash, "hex");
  const isMatch = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  return isMatch ? publicUser(user) : null;
}

function updateUserPreferences(userId, preferences) {
  const db = readDb();
  const user = db.users.find(item => item.id === userId);

  if (!user) {
    throw new Error("User not found");
  }

  user.preferences = {
    ...(user.preferences && typeof user.preferences === "object" ? user.preferences : {}),
    ...(preferences && typeof preferences === "object" ? preferences : {})
  };
  user.updatedAt = now();
  writeDb(db);

  return publicUser(user).preferences;
}

function createSession(userId) {
  const db = readDb();
  const user = db.users.find(item => item.id === userId);

  if (!user) {
    throw new Error("User not found");
  }

  const timestamp = now();
  const session = {
    id: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };

  db.sessions.push(session);
  writeDb(db);

  return session;
}

function findSession(sessionId) {
  const db = readDb();
  const session = db.sessions.find(item => item.id === sessionId);

  if (!session || (session.expiresAt && new Date(session.expiresAt) <= new Date())) {
    return null;
  }

  const user = db.users.find(item => item.id === session.userId);

  return user ? {
    session,
    user: publicUser(user)
  } : null;
}

function deleteSession(sessionId) {
  const db = readDb();
  const before = db.sessions.length;

  db.sessions = db.sessions.filter(session => session.id !== sessionId);
  writeDb(db);

  return before - db.sessions.length;
}

function createLog(entry) {
  const db = readDb();
  const timestamp = now();
  const log = {
    id: crypto.randomUUID(),
    level: entry.level || "info",
    action: String(entry.action || "action"),
    message: String(entry.message || "").trim(),
    userId: entry.userId || "",
    username: entry.username || "",
    ip: entry.ip || "",
    details: entry.details && typeof entry.details === "object" ? entry.details : {},
    createdAt: timestamp
  };

  db.logs.push(log);
  db.logs = db.logs.slice(-MAX_LOGS);
  writeDb(db);

  return log;
}

function listLogs(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);
  const action = String(options.action || "").trim();
  const level = String(options.level || "").trim();
  const db = readDb();

  return db.logs
    .filter(log => !action || log.action === action)
    .filter(log => !level || log.level === level)
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

function clearLogs() {
  const db = readDb();
  const count = db.logs.length;

  db.logs = [];
  writeDb(db);

  return count;
}

function uniqueSlug(db, name, parentId, currentId = null) {
  const base = slugify(name);
  let slug = base;
  let index = 2;

  while (db.folders.some(folder => folder.id !== currentId && folder.parentId === parentId && folder.slug === slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }

  return slug;
}

function buildPath(db, folder) {
  const segments = [folder.slug];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = db.folders.find(item => item.id === parentId);

    if (!parent) {
      break;
    }

    segments.unshift(parent.slug);
    parentId = parent.parentId;
  }

  return segments.join("/");
}

function refreshFolderPaths(db) {
  db.folders.forEach(folder => {
    folder.path = buildPath(db, folder);
  });
}

function getNextSortOrder(db, parentId) {
  const siblingOrders = db.folders
    .filter(folder => folder.parentId === parentId)
    .map(folder => Number(folder.sortOrder) || 0);

  return siblingOrders.length ? Math.max(...siblingOrders) + 1 : 1;
}

function hasDuplicateFolderName(db, name, parentId, currentId = null) {
  const normalizedName = String(name || "").trim().toLowerCase();

  return db.folders.some(folder => (
    folder.id !== currentId &&
    folder.parentId === parentId &&
    String(folder.name || "").trim().toLowerCase() === normalizedName
  ));
}

function createFolder(name, parentId = null, description = "") {
  const db = readDb();

  if (parentId && !db.folders.some(folder => folder.id === parentId)) {
    throw new Error("Parent folder not found");
  }

  const timestamp = now();
  const folder = {
    id: crypto.randomUUID(),
    name: String(name || "").trim(),
    slug: uniqueSlug(db, name, parentId),
    parentId,
    path: "",
    description: String(description || "").trim(),
    sortOrder: getNextSortOrder(db, parentId),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (!folder.name) {
    throw new Error("Folder name is required");
  }

  if (hasDuplicateFolderName(db, folder.name, parentId)) {
    throw new Error("A folder with this name already exists in the selected parent folder");
  }

  db.folders.push(folder);
  refreshFolderPaths(db);
  writeDb(db);

  return folder;
}

function updateFolder(id, updates) {
  const db = readDb();
  const folder = db.folders.find(item => item.id === id);
  const previousParentId = folder?.parentId || null;

  if (!folder) {
    throw new Error("Folder not found");
  }

  if (updates.parentId !== undefined) {
    const parentId = updates.parentId || null;

    if (parentId === id) {
      throw new Error("Folder cannot be moved inside itself");
    }

    if (parentId && !db.folders.some(item => item.id === parentId)) {
      throw new Error("Parent folder not found");
    }

    folder.parentId = parentId;

    if (parentId !== previousParentId) {
      folder.sortOrder = getNextSortOrder(db, parentId);
    }
  }

  if (updates.name !== undefined) {
    const name = String(updates.name || "").trim();

    if (!name) {
      throw new Error("Folder name is required");
    }

    folder.name = name;
    folder.slug = uniqueSlug(db, name, folder.parentId, id);
  }

  if (updates.description !== undefined) {
    folder.description = String(updates.description || "").trim();
  }

  folder.updatedAt = now();
  refreshFolderPaths(db);
  writeDb(db);

  return folder;
}

function reorderFolder(id, direction) {
  const db = readDb();
  const folder = db.folders.find(item => item.id === id);

  if (!folder) {
    throw new Error("Folder not found");
  }

  if (!["up", "down"].includes(direction)) {
    throw new Error("Order direction must be up or down");
  }

  const siblings = db.folders
    .filter(item => item.parentId === folder.parentId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
  const currentIndex = siblings.findIndex(item => item.id === id);
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (nextIndex < 0 || nextIndex >= siblings.length) {
    return folder;
  }

  const target = siblings[nextIndex];
  const folderOrder = folder.sortOrder;
  folder.sortOrder = target.sortOrder;
  target.sortOrder = folderOrder;
  folder.updatedAt = now();
  target.updatedAt = now();
  writeDb(db);

  return folder;
}

function getDescendantFolderIds(db, folderId) {
  const ids = [folderId];
  const children = db.folders.filter(folder => folder.parentId === folderId);

  children.forEach(child => {
    ids.push(...getDescendantFolderIds(db, child.id));
  });

  return ids;
}

function deleteFolder(id) {
  const db = readDb();
  const folderIds = getDescendantFolderIds(db, id);
  const timestamp = now();

  db.folders.forEach(folder => {
    if (folderIds.includes(folder.id)) {
      folder.deletedAt = timestamp;
      folder.updatedAt = timestamp;
    }
  });
  writeDb(db);
}

function restoreFolder(id) {
  const db = readDb();
  const folderIds = getDescendantFolderIds(db, id);
  let parentId = db.folders.find(folder => folder.id === id)?.parentId || null;
  const timestamp = now();

  while (parentId) {
    const parent = db.folders.find(folder => folder.id === parentId);

    if (!parent) {
      break;
    }

    folderIds.push(parent.id);
    parentId = parent.parentId;
  }

  db.folders.forEach(folder => {
    if (folderIds.includes(folder.id)) {
      folder.deletedAt = null;
      folder.updatedAt = timestamp;
    }
  });
  writeDb(db);
}

function permanentlyDeleteFolder(id) {
  const db = readDb();
  const folderIds = getDescendantFolderIds(db, id);

  db.folders = db.folders.filter(folder => !folderIds.includes(folder.id));
  db.files = db.files.filter(file => !folderIds.includes(file.folderId));
  writeDb(db);
}

function findFolder(identifier, options = {}) {
  const db = readDb();
  const includeDeleted = Boolean(options.includeDeleted);

  return db.folders.find(folder => (
    (includeDeleted || !folder.deletedAt) &&
    (folder.id === identifier || folder.slug === identifier || folder.path === identifier)
  )) || null;
}

function listFolders(options = {}) {
  const db = readDb();
  const state = options.state || "active";

  return db.folders
  .filter(folder => {
    if (state === "deleted") {
      return Boolean(folder.deletedAt);
    }

    if (state === "all") {
      return true;
    }

    return !folder.deletedAt;
  })
  .slice()
  .sort((a, b) => {
    if ((a.parentId || "") !== (b.parentId || "")) {
      return (a.parentId || "").localeCompare(b.parentId || "");
    }

    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
  })
  .map(folder => {
    const files = db.files.filter(file => file.folderId === folder.id);
    const pendingFiles = files.filter(file => file.status === "pending");
    const lastPendingFile = pendingFiles
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    const lastFile = files
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];

    return {
      ...folder,
      filesCount: files.length,
      pendingCount: pendingFiles.length,
      approvedCount: files.filter(file => file.status === "approved").length,
      lastUploadedAt: lastFile?.createdAt || null,
      lastPendingUploadedAt: lastPendingFile?.createdAt || null
    };
  });
}

function createFile(file) {
  const db = readDb();
  const timestamp = now();
  const record = {
    id: crypto.randomUUID(),
    status: "pending",
    title: file.title || file.filename || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    approvedBy: null,
    ...file
  };

  db.files.push(record);
  writeDb(db);

  return record;
}

function createFiles(files) {
  const db = readDb();
  const timestamp = now();
  const records = files.map(file => ({
    id: crypto.randomUUID(),
    status: "pending",
    title: file.title || file.filename || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    approvedBy: null,
    ...file
  }));

  db.files.push(...records);
  writeDb(db);

  return records;
}

function listFiles(folderId, status = "approved") {
  const db = readDb();

  return db.files.filter(file => {
    if (file.folderId !== folderId) {
      return false;
    }

    return status === "all" || file.status === status;
  });
}

function listAllFiles(status = "all") {
  const db = readDb();

  return db.files.filter(file => status === "all" || file.status === status);
}

function updateFile(id, updates) {
  const db = readDb();
  const file = db.files.find(item => item.id === id);

  if (!file) {
    throw new Error("File not found");
  }

  Object.assign(file, updates, { updatedAt: now() });

  if (updates.status === "approved") {
    file.approvedAt = now();
    file.approvedBy = updates.approvedBy || "admin";
  }

  writeDb(db);

  return file;
}

function deleteFile(id) {
  const db = readDb();
  db.files = db.files.filter(file => file.id !== id);
  writeDb(db);
}

function findFile(id) {
  const db = readDb();

  return db.files.find(file => file.id === id) || null;
}

function approveFolderFiles(folderId) {
  const db = readDb();
  const timestamp = now();
  let count = 0;

  db.files.forEach(file => {
    if (file.folderId !== folderId || file.status === "approved") {
      return;
    }

    file.status = "approved";
    file.updatedAt = timestamp;
    file.approvedAt = timestamp;
    file.approvedBy = "admin";
    count += 1;
  });

  writeDb(db);

  return count;
}

function approveFolderTreeFiles(folderId) {
  const db = readDb();
  const folderIds = new Set(getDescendantFolderIds(db, folderId));
  const timestamp = now();
  let count = 0;

  db.files.forEach(file => {
    if (!folderIds.has(file.folderId) || file.status === "approved") {
      return;
    }

    file.status = "approved";
    file.updatedAt = timestamp;
    file.approvedAt = timestamp;
    file.approvedBy = "admin";
    count += 1;
  });

  writeDb(db);

  return count;
}

function deleteFolderFiles(folderId) {
  const db = readDb();
  const before = db.files.length;
  db.files = db.files.filter(file => file.folderId !== folderId);
  writeDb(db);

  return before - db.files.length;
}

function exportDb() {
  const db = readDb();

  return {
    folders: db.folders,
    files: db.files,
    users: db.users,
    logs: db.logs
  };
}

function validateImportedDb(importedDb) {
  if (!importedDb || !Array.isArray(importedDb.folders) || !Array.isArray(importedDb.files)) {
    throw new Error("Imported file is not a valid database backup");
  }

  normalizeDb(importedDb);
  refreshFolderPaths(importedDb);

  return importedDb;
}

function replaceDb(importedDb) {
  const nextDb = validateImportedDb(importedDb);
  writeDb(nextDb);

  return {
    mode: "replace",
    foldersAdded: nextDb.folders.length,
    foldersUpdated: 0,
    foldersSkipped: 0,
    filesAdded: nextDb.files.length,
    filesUpdated: 0,
    filesSkipped: 0
  };
}

function isImportedRecordNewer(importedRecord, existingRecord) {
  const importedTime = new Date(importedRecord.updatedAt || importedRecord.createdAt || 0).getTime();
  const existingTime = new Date(existingRecord.updatedAt || existingRecord.createdAt || 0).getTime();

  return Number.isFinite(importedTime) && importedTime >= existingTime;
}

function mergeDb(importedDb) {
  const currentDb = readDb();
  const nextDb = validateImportedDb(importedDb);
  const summary = {
    mode: "update",
    foldersAdded: 0,
    foldersUpdated: 0,
    foldersSkipped: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesSkipped: 0
  };

  nextDb.folders.forEach(importedFolder => {
    const existingFolder = currentDb.folders.find(folder => folder.id === importedFolder.id);

    if (!existingFolder) {
      if (hasDuplicateFolderName(currentDb, importedFolder.name, importedFolder.parentId)) {
        summary.foldersSkipped += 1;
        return;
      }

      currentDb.folders.push(importedFolder);
      summary.foldersAdded += 1;
      return;
    }

    if (isImportedRecordNewer(importedFolder, existingFolder)) {
      Object.assign(existingFolder, importedFolder);
      summary.foldersUpdated += 1;
    } else {
      summary.foldersSkipped += 1;
    }
  });

  nextDb.files.forEach(importedFile => {
    const existingFile = currentDb.files.find(file => file.id === importedFile.id);

    if (!currentDb.folders.some(folder => folder.id === importedFile.folderId)) {
      summary.filesSkipped += 1;
      return;
    }

    if (!existingFile) {
      currentDb.files.push(importedFile);
      summary.filesAdded += 1;
      return;
    }

    if (isImportedRecordNewer(importedFile, existingFile)) {
      Object.assign(existingFile, importedFile);
      summary.filesUpdated += 1;
    } else {
      summary.filesSkipped += 1;
    }
  });

  normalizeDb(currentDb);
  refreshFolderPaths(currentDb);
  writeDb(currentDb);

  return summary;
}

function getOrCreateDefaultFolder() {
  const db = readDb();
  const existing = db.folders.find(folder => folder.slug === "uploads" && folder.parentId === null);

  if (existing) {
    return existing;
  }

  return createFolder("Uploads");
}

module.exports = {
  clearLogs,
  createFile,
  createFiles,
  createFolder,
  createLog,
  createSession,
  createUser,
  deleteSession,
  deleteFile,
  deleteFolder,
  exportDb,
  findFile,
  findFolder,
  findSession,
  getOrCreateDefaultFolder,
  hasUsers,
  listFiles,
  listAllFiles,
  listFolders,
  listLogs,
  approveFolderFiles,
  approveFolderTreeFiles,
  deleteFolderFiles,
  mergeDb,
  permanentlyDeleteFolder,
  reorderFolder,
  replaceDb,
  restoreFolder,
  updateFile,
  updateFolder,
  updateUserPreferences,
  verifyUser
};
