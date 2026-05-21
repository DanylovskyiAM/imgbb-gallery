const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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

  if (!fs.existsSync(DB_PATH)) {
    writeDb({
      folders: [],
      files: []
    });
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  normalizeDb(db);

  return db;
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeDb(db) {
  db.folders = Array.isArray(db.folders) ? db.folders : [];
  db.files = Array.isArray(db.files) ? db.files : [];

  const siblingCounters = {};

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

  db.folders = db.folders.filter(folder => !folderIds.includes(folder.id));
  db.files = db.files.filter(file => !folderIds.includes(file.folderId));
  writeDb(db);
}

function findFolder(identifier) {
  const db = readDb();
  return db.folders.find(folder => folder.id === identifier || folder.slug === identifier || folder.path === identifier) || null;
}

function listFolders() {
  const db = readDb();

  return db.folders
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

    return {
      ...folder,
      filesCount: files.length,
      pendingCount: pendingFiles.length,
      approvedCount: files.filter(file => file.status === "approved").length,
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

function listFiles(folderId, status = "approved") {
  const db = readDb();

  return db.files.filter(file => {
    if (file.folderId !== folderId) {
      return false;
    }

    return status === "all" || file.status === status;
  });
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

function deleteFolderFiles(folderId) {
  const db = readDb();
  const before = db.files.length;
  db.files = db.files.filter(file => file.folderId !== folderId);
  writeDb(db);

  return before - db.files.length;
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
  createFile,
  createFolder,
  deleteFile,
  deleteFolder,
  findFolder,
  getOrCreateDefaultFolder,
  listFiles,
  listFolders,
  approveFolderFiles,
  deleteFolderFiles,
  reorderFolder,
  updateFile,
  updateFolder
};
