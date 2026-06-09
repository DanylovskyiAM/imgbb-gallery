const addRootFolderBtn = document.getElementById("addRootFolderBtn");
const preferredPeriodSelect = document.getElementById("preferredPeriodSelect");
const toggleBinBtn = document.getElementById("toggleBinBtn");
const addFolderModal = document.getElementById("addFolderModal");
const addFolderForm = document.getElementById("addFolderForm");
const addParentFolder = document.getElementById("addParentFolder");
const addFolderName = document.getElementById("addFolderName");
const addFolderDescription = document.getElementById("addFolderDescription");
const cancelAddFolder = document.getElementById("cancelAddFolder");
const folderList = document.getElementById("folderList");
const fileList = document.getElementById("fileList");
const filesTitle = document.getElementById("filesTitle");
const filesSubtitle = document.getElementById("filesSubtitle");
const bulkFileActions = document.getElementById("bulkFileActions");
const approveAllBtn = document.getElementById("approveAllBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const closeBtn = document.getElementById("close");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const counter = document.getElementById("counter");
const downloadBtn = document.getElementById("downloadBtn");
const modalApproveBtn = document.getElementById("modalApproveBtn");
const modalDeleteBtn = document.getElementById("modalDeleteBtn");
const toTopBtn = document.getElementById("toTopBtn");
const exportDbBtn = document.getElementById("exportDbBtn");
const logoutBtn = document.getElementById("logoutBtn");
const exportModal = document.getElementById("exportModal");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const exportExcelBtn = document.getElementById("exportExcelBtn");
const excelExportModeInputs = document.querySelectorAll("input[name='excelExportMode']");
const cancelExport = document.getElementById("cancelExport");
const openImportDbBtn = document.getElementById("openImportDbBtn");
const importDbModal = document.getElementById("importDbModal");
const importDbForm = document.getElementById("importDbForm");
const importDbFile = document.getElementById("importDbFile");
const importDbStatus = document.getElementById("importDbStatus");
const cancelImportDb = document.getElementById("cancelImportDb");
const importDbActions = document.getElementById("importDbActions");
const importDbCloseActions = document.getElementById("importDbCloseActions");
const closeImportDb = document.getElementById("closeImportDb");
const editFolderModal = document.getElementById("editFolderModal");
const editFolderForm = document.getElementById("editFolderForm");
const editFolderName = document.getElementById("editFolderName");
const editFolderDescription = document.getElementById("editFolderDescription");
const cancelEditFolder = document.getElementById("cancelEditFolder");

const apiHost = window.location.hostname || "127.0.0.1";
const isLocalClient = ["localhost", "127.0.0.1"].includes(apiHost) && window.location.port === "5500";
const apiBase = isLocalClient ? `http://${apiHost}:3000` : window.location.origin;
const preferredPeriodStorageKey = "myaPreferredUploadPeriod";

let folders = [];
let selectedFolder = null;
let currentFiles = [];
let currentFileIndex = 0;
let lockedScrollY = 0;
let editingFolder = null;
let addingParentId = null;
const collapsedFolderIds = new Set();
let didApplyDefaultCollapse = false;
let folderById = new Map();
let foldersByParentId = new Map();
let folderStatsCache = new Map();
let folderDisplayPathCache = new Map();
let preferredUploadPeriod = localStorage.getItem(preferredPeriodStorageKey) || "";
let folderViewMode = "active";

function setBulkActionsVisible(isVisible) {
  bulkFileActions.classList.toggle("hidden", !isVisible);
  approveAllBtn.disabled = !isVisible;
  deleteAllBtn.disabled = !isVisible;
}

function setBulkActionsEnabled(isEnabled) {
  approveAllBtn.disabled = !isEnabled;
  deleteAllBtn.disabled = !isEnabled;
}

function updateBulkActionsForFiles(files) {
  const hasFiles = files.length > 0;
  const hasPendingFiles = files.some(file => file.status !== "approved");

  approveAllBtn.disabled = !hasPendingFiles;
  deleteAllBtn.disabled = !hasFiles;
}

async function refreshSelectedLeafFolder(expectedFiles = null) {
  if (!selectedFolder) {
    await loadFolders();
    return;
  }

  const selectedFolderId = selectedFolder.id;
  const filesData = expectedFiles
    ? { files: expectedFiles }
    : await api(`/api/folders/${selectedFolderId}/files?status=all`);
  const foldersData = await api("/api/folders");

  folders = foldersData.folders;
  syncFolderStatsFromFiles(selectedFolderId, filesData.files);
  rebuildFolderIndexes();
  selectedFolder = folderById.get(selectedFolderId) || selectedFolder;

  renderFolders();
  filesTitle.textContent = "Files:";
  renderFilesBreadcrumb(selectedFolder);
  setBulkActionsVisible(true);
  renderFiles(filesData.files);
  updateBulkActionsForFiles(filesData.files);
}

function syncFolderStatsFromFiles(folderId, files) {
  const folder = folders.find(item => item.id === folderId);

  if (!folder) {
    return;
  }

  const pendingFiles = files.filter(file => file.status !== "approved");
  const approvedFiles = files.filter(file => file.status === "approved");
  const latestFile = files
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
  const latestPendingFile = pendingFiles
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];

  folder.filesCount = files.length;
  folder.pendingCount = pendingFiles.length;
  folder.approvedCount = approvedFiles.length;
  folder.lastUploadedAt = latestFile?.createdAt || null;
  folder.lastPendingUploadedAt = latestPendingFile?.createdAt || null;
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
}

function getParentKey(parentId = null) {
  return parentId || "root";
}

function rebuildFolderIndexes() {
  folderById = new Map();
  foldersByParentId = new Map();
  folderStatsCache = new Map();
  folderDisplayPathCache = new Map();

  folders.forEach((folder) => {
    folderById.set(folder.id, folder);
  });

  folders.forEach((folder) => {
    const visibleParentId = folder.parentId && folderById.has(folder.parentId)
      ? folder.parentId
      : null;
    const parentKey = getParentKey(visibleParentId);
    const siblings = foldersByParentId.get(parentKey) || [];
    siblings.push(folder);
    foldersByParentId.set(parentKey, siblings);
  });

  foldersByParentId.forEach((siblings) => {
    siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  });
}

function getChildFolders(parentId = null) {
  return foldersByParentId.get(getParentKey(parentId)) || [];
}

function getAvailablePeriodNames() {
  return [...new Set(folders
    .filter(folder => getFolderDepth(folder) === 2)
    .map(folder => folder.name)
    .filter(Boolean))]
    .sort(comparePeriodNames);
}

function getSeasonSortValue(periodName) {
  const seasonOrder = ["spring", "summer", "autumn", "winter"];
  const normalizedName = String(periodName || "").trim().toLowerCase();
  const index = seasonOrder.findIndex(season => normalizedName.startsWith(season));

  return index >= 0 ? index : seasonOrder.length;
}

function comparePeriodNames(a, b) {
  const seasonDiff = getSeasonSortValue(a) - getSeasonSortValue(b);

  if (seasonDiff) {
    return seasonDiff;
  }

  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function getPreferredPeriodName() {
  return preferredUploadPeriod;
}

function renderPreferredPeriodSelect() {
  const selectedPeriod = getPreferredPeriodName();
  const periodNames = getAvailablePeriodNames();

  preferredPeriodSelect.innerHTML = '<option value="">Period</option>';

  periodNames.forEach((periodName) => {
    const option = document.createElement("option");
    option.value = periodName;
    option.textContent = periodName;
    preferredPeriodSelect.appendChild(option);
  });

  preferredPeriodSelect.value = periodNames.includes(selectedPeriod) ? selectedPeriod : "";
}

function buildUploadUrl(folder) {
  const url = new URL("/upload.html", window.location.origin);
  const preferredPeriod = getPreferredPeriodName();

  url.searchParams.set("folder", folder.id);

  if (preferredPeriod) {
    url.searchParams.set("period", preferredPeriod);
  }

  return `${url.pathname}${url.search}`;
}

function getDescendantFolders(parentId = null) {
  return getChildFolders(parentId).flatMap(child => [
    child,
    ...getDescendantFolders(child.id)
  ]);
}

function buildFolderTree(parentId = null) {
  return getChildFolders(parentId);
}

function isBinMode() {
  return folderViewMode === "deleted";
}

function renderParentOptions(selectedParentId = "") {
  addParentFolder.innerHTML = '<option value="">Root folder</option>';
  folders
    .map(folder => ({
      folder,
      displayPath: getFolderDisplayPath(folder)
    }))
    .sort((a, b) => a.displayPath.localeCompare(b.displayPath))
    .forEach(folder => {
      const option = document.createElement("option");
      option.value = folder.folder.id;
      option.textContent = folder.displayPath;
      addParentFolder.appendChild(option);
    });
  addParentFolder.value = selectedParentId || "";
}

function createActionButton(text, onClick, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.disabled = Boolean(options.disabled);
  button.onclick = onClick;

  return button;
}

function getDownloadUrl(url, filename) {
  const downloadUrl = new URL("/api/download", apiBase);
  downloadUrl.searchParams.set("url", url);

  if (filename) {
    downloadUrl.searchParams.set("filename", filename);
  }

  return downloadUrl.toString();
}

function hasDuplicateFolderName(name, parentId) {
  return folders.some(folder => (
    (folder.parentId || null) === (parentId || null) &&
    folder.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0
  ));
}

function openAddFolderModal(parentId = null) {
  addingParentId = parentId || null;
  renderParentOptions(addingParentId);
  addFolderName.value = "";
  addFolderDescription.value = "";
  addFolderModal.classList.remove("hidden");
  addFolderName.focus();
}

function closeAddFolderModal() {
  addingParentId = null;
  addFolderModal.classList.add("hidden");
  addFolderForm.reset();
}

function openImportDbModal() {
  importDbStatus.textContent = "";
  importDbStatus.classList.remove("is-error");
  importDbFile.value = "";
  importDbActions.classList.remove("hidden");
  importDbCloseActions.classList.add("hidden");
  importDbModal.classList.remove("hidden");
}

function closeImportDbModal() {
  importDbModal.classList.add("hidden");
  importDbForm.reset();
  importDbStatus.textContent = "";
  importDbStatus.classList.remove("is-error");
  importDbActions.classList.remove("hidden");
  importDbCloseActions.classList.add("hidden");
}

function showImportCloseAction() {
  importDbActions.classList.add("hidden");
  importDbCloseActions.classList.remove("hidden");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openExportModal() {
  exportModal.classList.remove("hidden");
}

function closeExportModal() {
  exportModal.classList.add("hidden");
}

function getLeafFolders() {
  const parentIds = new Set(folders.map(folder => folder.parentId).filter(Boolean));

  return folders
    .filter(folder => !parentIds.has(folder.id))
    .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name));
}

function getFolderDepth(folder) {
  let depth = 0;
  let parentId = folder.parentId;

  while (parentId) {
    depth += 1;
    parentId = folderById.get(parentId)?.parentId || null;
  }

  return depth;
}

function getSiteFolders() {
  return folders
    .filter(folder => getFolderDepth(folder) === 1)
    .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name));
}

function getExcelExportMode() {
  return [...excelExportModeInputs].find(input => input.checked)?.value || "periods";
}

function getFolderParentPath(folder) {
  if (!folder.parentId) {
    return "Root";
  }

  const parent = folderById.get(folder.parentId);

  return parent ? getFolderDisplayPath(parent) : "Root";
}

function getFolderStatus(folder) {
  return getStatsStatus({
    filesCount: folder.filesCount,
    pendingCount: folder.pendingCount,
    lastUploadedAt: folder.lastUploadedAt,
    lastPendingUploadedAt: folder.lastPendingUploadedAt
  });
}

function getStatsStatus(stats) {
  const lastPendingText = stats.lastPendingUploadedAt
    ? formatRelativeTime(stats.lastPendingUploadedAt)
    : "";
  const lastUpload = stats.lastUploadedAt
    ? new Date(stats.lastUploadedAt).toLocaleString()
    : "";

  if (stats.pendingCount > 0) {
    return lastPendingText
      ? `${stats.pendingCount} pending (${lastPendingText})`
      : `${stats.pendingCount} pending`;
  }

  return lastUpload ? `No pending, last upload ${lastUpload}` : "No pending";
}

function getLatestDateValue(currentValue, nextValue) {
  if (!currentValue) {
    return nextValue || null;
  }

  if (!nextValue) {
    return currentValue;
  }

  return new Date(nextValue) > new Date(currentValue) ? nextValue : currentValue;
}

function getCombinedFolderStats(folder) {
  if (folderStatsCache.has(folder.id)) {
    return folderStatsCache.get(folder.id);
  }

  const children = getChildFolders(folder.id);

  const stats = children.reduce((stats, child) => {
    const childStats = getCombinedFolderStats(child);

    return {
      filesCount: stats.filesCount + childStats.filesCount,
      approvedCount: stats.approvedCount + childStats.approvedCount,
      pendingCount: stats.pendingCount + childStats.pendingCount,
      lastUploadedAt: getLatestDateValue(stats.lastUploadedAt, childStats.lastUploadedAt),
      lastPendingUploadedAt: getLatestDateValue(stats.lastPendingUploadedAt, childStats.lastPendingUploadedAt)
    };
  }, {
    filesCount: Number(folder.filesCount) || 0,
    approvedCount: Number(folder.approvedCount) || 0,
    pendingCount: Number(folder.pendingCount) || 0,
    lastUploadedAt: folder.lastUploadedAt || null,
    lastPendingUploadedAt: folder.lastPendingUploadedAt || null
  });

  folderStatsCache.set(folder.id, stats);

  return stats;
}

function isFolderDescendantOf(folder, parentId) {
  let currentParentId = folder.parentId;

  while (currentParentId) {
    if (currentParentId === parentId) {
      return true;
    }

    currentParentId = folderById.get(currentParentId)?.parentId || null;
  }

  return false;
}

function hasChildFolders(folder) {
  return getChildFolders(folder.id).length > 0;
}

function getFolderDisplayPath(folder) {
  if (folderDisplayPathCache.has(folder.id)) {
    return folderDisplayPathCache.get(folder.id);
  }

  const segments = [folder.name];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = folderById.get(parentId);

    if (!parent) {
      break;
    }

    segments.unshift(parent.name);
    parentId = parent.parentId;
  }

  const displayPath = segments.join(" / ");
  folderDisplayPathCache.set(folder.id, displayPath);

  return displayPath;
}

function getFolderBreadcrumb(folder) {
  const items = [folder];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = folderById.get(parentId);

    if (!parent) {
      break;
    }

    items.unshift(parent);
    parentId = parent.parentId;
  }

  return items;
}

function clearFilesSubtitle() {
  filesSubtitle.innerHTML = "";
}

function renderFilesBreadcrumb(folder) {
  filesSubtitle.innerHTML = "";

  const rootSegment = document.createElement(folder ? "button" : "span");
  rootSegment.className = folder ? "breadcrumb-link" : "breadcrumb-current";
  rootSegment.textContent = "All";

  if (folder) {
    rootSegment.type = "button";
    rootSegment.onclick = async () => {
      selectedFolder = null;
      currentFiles = [];
      await loadFolders();
      renderFolderOverview();
    };
  }

  filesSubtitle.appendChild(rootSegment);

  if (!folder) {
    return;
  }

  const rootSeparator = document.createElement("span");
  rootSeparator.className = "breadcrumb-separator";
  rootSeparator.textContent = "/";
  filesSubtitle.appendChild(rootSeparator);

  getFolderBreadcrumb(folder).forEach((item, index, items) => {
    const isLast = index === items.length - 1;
    const segment = document.createElement(isLast ? "span" : "button");
    segment.className = isLast ? "breadcrumb-current" : "breadcrumb-link";
    segment.textContent = item.name;

    if (!isLast) {
      segment.type = "button";
      segment.onclick = async () => {
        await loadFolders();
        await loadFiles(folderById.get(item.id) || item);
      };
    }

    filesSubtitle.appendChild(segment);

    if (!isLast) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "/";
      filesSubtitle.appendChild(separator);
    }
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportFoldersToExcel() {
  const origin = window.location.origin;
  const mode = getExcelExportMode();
  const exportFolders = mode === "sites" ? getSiteFolders() : getLeafFolders();
  const rows = [
    [
      "Path",
      "Folder",
      "Files Count",
      "Status",
      "Uploading",
      "Viewing"
    ],
    ...exportFolders.map((folder) => {
      const stats = mode === "sites"
        ? getCombinedFolderStats(folder)
        : folder;

      return [
        getFolderParentPath(folder),
        folder.name,
        stats.filesCount,
        getStatsStatus(stats),
        `${origin}/upload.html?folder=${encodeURIComponent(folder.id)}`,
        `${origin}/?folder=${encodeURIComponent(folder.id)}`
      ];
    })
  ];
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${mode}-folders-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderImportSummary(summary) {
  if (!summary) {
    importDbStatus.textContent = "Import completed.";
    return;
  }

  importDbStatus.innerHTML = "";

  if (summary.mode === "replace") {
    importDbStatus.appendChild(createImportSummaryLine("Database replaced", [
      ["added", `${summary.foldersAdded} folders`],
      ["added", `${summary.filesAdded} files`]
    ]));
    return;
  }

  const title = document.createElement("span");
  title.className = "import-summary-title";
  title.textContent = "Import updated database.";
  importDbStatus.appendChild(title);
  importDbStatus.appendChild(createImportSummaryLine("Folders", [
    ["added", `${summary.foldersAdded} added`],
    ["updated", `${summary.foldersUpdated} updated`],
    ["skipped", `${summary.foldersSkipped} skipped`]
  ]));
  importDbStatus.appendChild(createImportSummaryLine("Files", [
    ["added", `${summary.filesAdded} added`],
    ["updated", `${summary.filesUpdated} updated`],
    ["skipped", `${summary.filesSkipped} skipped`]
  ]));
}

function createImportSummaryLine(label, parts) {
  const line = document.createElement("span");
  line.className = "import-summary-line";

  const labelNode = document.createElement("strong");
  labelNode.textContent = `${label}: `;
  line.appendChild(labelNode);

  parts.forEach(([type, text], index) => {
    const part = document.createElement("span");
    part.className = `import-count import-count-${type}`;
    part.textContent = text;
    line.appendChild(part);

    if (index < parts.length - 1) {
      line.appendChild(document.createTextNode(", "));
    }
  });

  return line;
}

function formatRelativeTime(dateValue) {
  if (!dateValue) {
    return "";
  }

  const timestamp = new Date(dateValue).getTime();

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  for (const [label, seconds] of units) {
    const value = Math.floor(diffSeconds / seconds);

    if (value >= 1) {
      return `${value} ${label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

function openEditFolderModal(folder) {
  editingFolder = folder;
  editFolderName.value = folder.name || "";
  editFolderDescription.value = folder.description || "";
  editFolderModal.classList.remove("hidden");
  editFolderName.focus();
}

function closeEditFolderModal() {
  editingFolder = null;
  editFolderModal.classList.add("hidden");
  editFolderForm.reset();
}

function toggleFolderCollapse(folder) {
  if (!hasChildFolders(folder)) {
    return;
  }

  if (collapsedFolderIds.has(folder.id)) {
    expandFolder(folder);
  } else {
    collapsedFolderIds.add(folder.id);
  }
}

function collapseDescendantFolders(folder) {
  getChildFolders(folder.id).forEach((child) => {
    if (hasChildFolders(child)) {
      collapsedFolderIds.add(child.id);
      collapseDescendantFolders(child);
    }
  });
}

function expandFolder(folder) {
  if (!hasChildFolders(folder)) {
    return;
  }

  if (!folder.parentId) {
    getChildFolders()
      .filter(item => item.id !== folder.id)
      .forEach(item => collapsedFolderIds.add(item.id));
  }

  collapseDescendantFolders(folder);
  collapsedFolderIds.delete(folder.id);
}

async function handleFolderSelection(folder) {
  if (isBinMode()) {
    toggleFolderCollapse(folder);
    renderFolders();
    return;
  }

  if (selectedFolder?.id === folder.id) {
    if (hasChildFolders(folder)) {
      collapsedFolderIds.add(folder.id);
    }

    selectedFolder = null;
    currentFiles = [];
    renderFolders();
    renderFolderOverview();
    return;
  }

  expandFolder(folder);
  await loadFiles(folder);
}

function renderFolderNode(folder, depth = 0) {
  const wrapper = document.createElement("div");
  wrapper.className = "folder-node";
  const childFolders = getChildFolders(folder.id);
  const hasChildren = childFolders.length > 0;

  const item = document.createElement("div");
  item.className = "folder-node-content";
  item.dataset.folderId = folder.id;
  item.dataset.parentId = folder.parentId || "";
  item.style.setProperty("--folder-depth", depth);
  item.style.setProperty("--folder-level-color", `rgba(58, 164, 252, ${Math.min(0.34, 0.04 + depth * 0.05)})`);
  item.style.setProperty("--folder-branch-offset", `${Math.max(0, depth - 1) * 24}px`);
  item.style.setProperty("--folder-description-offset", `${depth ? 48 + Math.max(0, depth - 1) * 24 : 24}px`);
  item.onclick = () => handleFolderSelection(folder);
  item.classList.toggle("is-deleted", Boolean(folder.deletedAt));

  if (selectedFolder?.id === folder.id) {
    item.classList.add("is-selected");
  }

  const info = document.createElement("button");
  info.type = "button";
  info.className = "folder-info";

  const folderLabel = document.createElement("span");
  folderLabel.className = "folder-label";

  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = hasChildren
    ? (collapsedFolderIds.has(folder.id) ? "▸" : "▾")
    : "•";
  icon.setAttribute("aria-hidden", "true");

  if (hasChildren) {
    icon.classList.add("is-toggle");
    icon.onclick = (e) => {
      e.stopPropagation();
      toggleFolderCollapse(folder);
      renderFolders();
    };
  }

  const title = document.createElement("strong");
  title.textContent = folder.name;

  if (depth) {
    const branch = document.createElement("span");
    branch.className = "folder-branch";
    branch.textContent = "└";
    branch.setAttribute("aria-hidden", "true");
    folderLabel.appendChild(branch);
  }

  folderLabel.append(icon, title);

  const description = document.createElement("small");
  description.className = "folder-description";
  description.textContent = folder.description || "-";

  info.append(folderLabel, description);

  const combinedStats = getCombinedFolderStats(folder);
  const meta = document.createElement("span");
  meta.className = "folder-meta";
  const lastPendingText = combinedStats.pendingCount
    ? ` (${formatRelativeTime(combinedStats.lastPendingUploadedAt)})`
    : "";
  const approvedText = document.createElement("span");
  approvedText.textContent = `${combinedStats.approvedCount} approved`;

  const separator = document.createElement("span");
  separator.textContent = " · ";

  const pendingText = document.createElement("span");
  pendingText.className = combinedStats.pendingCount ? "folder-pending is-active" : "folder-pending";
  pendingText.textContent = `${combinedStats.pendingCount} pending${lastPendingText}`;

  meta.append(approvedText, separator, pendingText);

  const actions = document.createElement("div");
  actions.className = "manage-actions";
  actions.onclick = (e) => e.stopPropagation();

  if (isBinMode()) {
    const restoreBtn = createActionButton("Restore", async () => {
      await api(`/api/folders/${folder.id}/restore`, { method: "POST" });
      await loadFolders();
    });

    const deleteForeverBtn = createActionButton("Delete forever", async () => {
      if (!window.confirm(`Permanently delete ${folder.path} and its file records? This cannot be undone.`)) {
        return;
      }

      await api(`/api/folders/${folder.id}?permanent=1`, { method: "DELETE" });
      await loadFolders();
    });
    deleteForeverBtn.classList.add("danger-action");

    actions.append(restoreBtn, deleteForeverBtn);
    item.append(info, meta, actions);
    wrapper.appendChild(item);

    if (hasChildren && !collapsedFolderIds.has(folder.id)) {
      const children = document.createElement("div");
      children.className = "folder-children";
      childFolders.forEach(child => children.appendChild(renderFolderNode(child, depth + 1)));
      wrapper.appendChild(children);
    }

    return wrapper;
  }

  const uploadLink = document.createElement("a");
  uploadLink.textContent = "Upload";
  uploadLink.href = buildUploadUrl(folder);

  const viewLink = document.createElement("a");
  viewLink.textContent = "View";
  viewLink.href = `/?folder=${encodeURIComponent(folder.id)}`;

  const addBtn = createActionButton("+ Folder", () => openAddFolderModal(folder.id));
  addBtn.disabled = folder.filesCount > 0;
  addBtn.title = folder.filesCount > 0 ? "Folders with files cannot have child folders" : "";

  const renameBtn = createActionButton("Edit", () => openEditFolderModal(folder));

  const deleteBtn = createActionButton("Delete", async () => {
    if (!window.confirm(`Delete ${folder.path} and its file records?`)) {
      return;
    }

    await api(`/api/folders/${folder.id}`, { method: "DELETE" });

    if (selectedFolder?.id === folder.id) {
      selectedFolder = null;
      fileList.innerHTML = "";
      filesTitle.textContent = "Files";
      clearFilesSubtitle();
      setBulkActionsVisible(false);
    }

    await loadFolders();
  });
  deleteBtn.classList.add("danger-action");

  actions.append(addBtn, renameBtn, deleteBtn, uploadLink, viewLink);

  if (!folder.parentId) {
    uploadLink.classList.add("is-disabled");
    uploadLink.setAttribute("aria-disabled", "true");
    uploadLink.removeAttribute("href");
    uploadLink.title = "Open a location or period folder to upload";
  }

  item.append(info, meta, actions);
  wrapper.appendChild(item);

  if (hasChildren && !collapsedFolderIds.has(folder.id)) {
    const children = document.createElement("div");
    children.className = "folder-children";
    childFolders.forEach(child => children.appendChild(renderFolderNode(child, depth + 1)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

function renderFolders() {
  folderList.innerHTML = "";

  const tree = buildFolderTree();

  if (!tree.length) {
    folderList.innerHTML = isBinMode()
      ? '<p class="empty-state">Bin is empty.</p>'
      : '<p class="empty-state">No folders yet.</p>';
    return;
  }

  tree.forEach(folder => {
    folderList.appendChild(renderFolderNode(folder));
  });
}

function renderFolderOverview(parentFolder = null) {
  const overviewFolders = parentFolder
    ? getDescendantFolders(parentFolder.id)
    : folders;
  const overviewItems = overviewFolders
    .map(folder => ({
      folder,
      stats: getCombinedFolderStats(folder)
    }))
    .filter(item => !hasChildFolders(item.folder) && item.stats.pendingCount > 0);

  filesTitle.textContent = "Folder overview";
  renderFilesBreadcrumb(parentFolder);
  setBulkActionsVisible(false);
  fileList.innerHTML = "";
  fileList.classList.add("folder-overview-list");
  fileList.classList.remove("manage-file-grid");

  const totalPending = overviewItems.reduce((sum, item) => sum + item.stats.pendingCount, 0);
  const panel = document.createElement("section");
  panel.className = "folder-overview";

  const header = document.createElement("div");
  header.className = "folder-overview-header";

  const title = document.createElement("div");
  title.innerHTML = `<strong>${overviewItems.length} folders</strong><span>${totalPending} waiting files</span>`;

  const approveAllWaiting = createActionButton("Approve all waiting", async () => {
    approveAllWaiting.disabled = true;

    try {
      for (const item of overviewItems) {
        await api(`/api/folders/${item.folder.id}/files/approve-all`, { method: "POST" });
      }

      await loadFolders();

      renderFolderOverview(parentFolder ? folderById.get(parentFolder.id) || parentFolder : null);
    } catch (err) {
      approveAllWaiting.disabled = false;
      window.alert(err.message || "Failed to approve waiting files.");
    }
  }, { disabled: totalPending === 0 });

  header.append(title, approveAllWaiting);
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "folder-overview-items";

  if (!overviewItems.length) {
    list.innerHTML = '<p class="empty-state">No folders with waiting files.</p>';
  }

  overviewItems.forEach(({ folder, stats }) => {
    const item = document.createElement("div");
    item.className = "folder-overview-item";

    const info = document.createElement("button");
    info.type = "button";
    info.className = "folder-overview-info";
    info.onclick = () => loadFiles(folder);

    const name = document.createElement("strong");
    name.textContent = getFolderDisplayPath(folder);

    const description = document.createElement("span");
    description.textContent = folder.description || "-";

    info.append(name, description);

    const pending = document.createElement("span");
    pending.className = "folder-overview-pending";
    pending.textContent = `${stats.pendingCount} waiting (${formatRelativeTime(stats.lastPendingUploadedAt)})`;

    item.append(info, pending);
    list.appendChild(item);
  });

  panel.appendChild(list);
  fileList.appendChild(panel);
}

function renderFiles(files) {
  fileList.innerHTML = "";
  fileList.classList.remove("folder-overview-list");
  fileList.classList.add("manage-file-grid");
  currentFiles = files;

  if (!files.length) {
    fileList.innerHTML = '<p class="empty-state">No files in this folder.</p>';
    return;
  }

  files.forEach((file, index) => {
    const item = document.createElement("article");
    item.className = "card manage-file-card";

    const img = document.createElement("img");
    img.src = file.mediumUrl || file.originalUrl;
    img.alt = file.title || file.filename || `File ${index + 1}`;
    img.onclick = () => openModal(index);

    const number = document.createElement("span");
    number.className = "photo-number";
    number.textContent = index + 1;

    const status = document.createElement("span");
    status.className = `file-status file-status-${file.status}`;
    status.textContent = file.status;

    item.append(img, number, status);
    fileList.appendChild(item);
  });
}

function openModal(index) {
  currentFileIndex = index;
  updateModal();
  lockedScrollY = window.scrollY;
  document.body.style.top = `-${lockedScrollY}px`;
  modal.classList.add("active");
  document.body.classList.add("modal-open");
}

function closeModal() {
  modal.classList.remove("active");
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, lockedScrollY);
}

function updateModal() {
  const file = currentFiles[currentFileIndex];

  if (!file) {
    closeModal();
    return;
  }

  modalImg.src = file.mediumUrl || file.originalUrl;
  modalImg.alt = file.title || file.filename || `File ${currentFileIndex + 1}`;
  counter.innerText = `${currentFileIndex + 1} / ${currentFiles.length}`;
  downloadBtn.href = getDownloadUrl(file.originalUrl, file.filename);
  downloadBtn.download = file.filename || `image_${currentFileIndex + 1}.jpg`;
  modalApproveBtn.disabled = file.status === "approved";
  modalApproveBtn.textContent = file.status === "approved" ? "Approved" : "Approve";
}

function nextFile() {
  currentFileIndex = (currentFileIndex + 1) % currentFiles.length;
  updateModal();
}

function prevFile() {
  currentFileIndex = (currentFileIndex - 1 + currentFiles.length) % currentFiles.length;
  updateModal();
}

async function loadFolders() {
  const [data, preferencesData] = await Promise.all([
    api(`/api/folders?state=${folderViewMode}`),
    api("/api/preferences").catch(() => ({ preferences: {} }))
  ]);

  folders = data.folders;
  preferredUploadPeriod = preferencesData.preferences?.preferredUploadPeriod || localStorage.getItem(preferredPeriodStorageKey) || "";
  rebuildFolderIndexes();
  renderPreferredPeriodSelect();
  toggleBinBtn.textContent = isBinMode() ? "Folders" : "Bin";
  toggleBinBtn.classList.toggle("is-active", isBinMode());
  addRootFolderBtn.classList.toggle("hidden", isBinMode());
  preferredPeriodSelect.disabled = isBinMode();
  preferredPeriodSelect.classList.toggle("hidden", isBinMode());

  if (!addFolderModal.classList.contains("hidden")) {
    renderParentOptions(addingParentId);
  }

  if (!didApplyDefaultCollapse) {
    folders
      .filter(folder => hasChildFolders(folder))
      .forEach(folder => collapsedFolderIds.add(folder.id));
    didApplyDefaultCollapse = true;
  }

  if (selectedFolder) {
    selectedFolder = folderById.get(selectedFolder.id) || selectedFolder;
  }

  if (isBinMode()) {
    selectedFolder = null;
    currentFiles = [];
  }

  renderFolders();

  if (isBinMode()) {
    filesTitle.textContent = "Bin";
    filesSubtitle.textContent = "";
    setBulkActionsVisible(false);
    fileList.classList.remove("manage-file-grid");
    fileList.classList.add("folder-overview-list");
    fileList.innerHTML = '<p class="empty-state">Deleted folders stay here until restored or permanently deleted.</p>';
  } else if (!selectedFolder) {
    renderFolderOverview();
  }
}

async function loadFiles(folder) {
  selectedFolder = folder;
  renderFolders();

  if (hasChildFolders(folder)) {
    renderFolderOverview(folder);
    return;
  }

  filesTitle.textContent = "Files:";
  renderFilesBreadcrumb(folder);
  setBulkActionsVisible(true);
  setBulkActionsEnabled(false);

  const data = await api(`/api/folders/${folder.id}/files?status=all`);
  renderFiles(data.files);
  updateBulkActionsForFiles(data.files);
}

addFolderForm.onsubmit = async (e) => {
  e.preventDefault();

  const name = addFolderName.value.trim();
  const parentId = addParentFolder.value || null;

  if (!name) {
    return;
  }

  if (hasDuplicateFolderName(name, parentId)) {
    window.alert("A folder with this name already exists in the selected parent folder.");
    return;
  }

  await api("/api/folders", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: addFolderDescription.value.trim(),
      parentId
    })
  });
  closeAddFolderModal();
  await loadFolders();
};

addRootFolderBtn.onclick = () => openAddFolderModal(null);
cancelAddFolder.onclick = closeAddFolderModal;
toggleBinBtn.onclick = async () => {
  folderViewMode = isBinMode() ? "active" : "deleted";
  selectedFolder = null;
  currentFiles = [];
  collapsedFolderIds.clear();
  didApplyDefaultCollapse = false;
  await loadFolders();
};
preferredPeriodSelect.onchange = async () => {
  preferredUploadPeriod = preferredPeriodSelect.value;

  if (preferredUploadPeriod) {
    localStorage.setItem(preferredPeriodStorageKey, preferredUploadPeriod);
  } else {
    localStorage.removeItem(preferredPeriodStorageKey);
  }

  renderFolders();

  try {
    await api("/api/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        preferredUploadPeriod
      })
    });
  } catch (err) {
    alert(err.message || "Failed to save selected period.");
  }
};

exportDbBtn.onclick = openExportModal;
logoutBtn.onclick = logout;
cancelExport.onclick = closeExportModal;

exportBackupBtn.onclick = () => {
  window.location.href = `${apiBase}/api/db/export`;
  closeExportModal();
};

exportExcelBtn.onclick = () => {
  exportFoldersToExcel();
  closeExportModal();
};

openImportDbBtn.onclick = openImportDbModal;
cancelImportDb.onclick = closeImportDbModal;
closeImportDb.onclick = closeImportDbModal;

importDbForm.onsubmit = async (e) => {
  e.preventDefault();

  const file = importDbFile.files?.[0];
  const mode = new FormData(importDbForm).get("importMode") || "update";

  if (!file) {
    importDbStatus.textContent = "Choose a backup file first.";
    importDbStatus.classList.add("is-error");
    return;
  }

  if (mode === "replace" && !window.confirm("Replace the current database with this backup?")) {
    return;
  }

  importDbStatus.textContent = "Importing backup...";
  importDbStatus.classList.remove("is-error");

  try {
    const data = await readFileAsBase64(file);
    const response = await api("/api/db/import", {
      method: "POST",
      body: JSON.stringify({
        mode,
        data
      })
    });

    selectedFolder = null;
    currentFiles = [];
    await loadFolders();
    renderImportSummary(response.summary);
    showImportCloseAction();
  } catch (err) {
    importDbStatus.textContent = err.message || "Import failed.";
    importDbStatus.classList.add("is-error");
    showImportCloseAction();
  }
};

approveAllBtn.onclick = async () => {
  if (!selectedFolder || !currentFiles.length) {
    return;
  }

  approveAllBtn.disabled = true;

  try {
    await api(`/api/folders/${selectedFolder.id}/files/approve-all`, { method: "POST" });
  } catch (err) {
    const pendingFiles = currentFiles.filter(file => file.status !== "approved");
    await Promise.all(pendingFiles.map(file => api(`/api/files/${file.id}/approve`, { method: "POST" })));
  }

  const approvedFiles = currentFiles.map(file => ({
    ...file,
    status: "approved"
  }));

  syncFolderStatsFromFiles(selectedFolder.id, approvedFiles);
  rebuildFolderIndexes();
  selectedFolder = folderById.get(selectedFolder.id) || selectedFolder;
  renderFolders();
  renderFiles(approvedFiles);
  updateBulkActionsForFiles(approvedFiles);
  await refreshSelectedLeafFolder(approvedFiles);
};

deleteAllBtn.onclick = async () => {
  if (!selectedFolder || !currentFiles.length || !window.confirm(`Delete all files in ${selectedFolder.path}?`)) {
    return;
  }

  deleteAllBtn.disabled = true;

  try {
    await api(`/api/folders/${selectedFolder.id}/files`, { method: "DELETE" });
  } catch (err) {
    await Promise.all(currentFiles.map(file => api(`/api/files/${file.id}`, { method: "DELETE" })));
  }

  syncFolderStatsFromFiles(selectedFolder.id, []);
  rebuildFolderIndexes();
  selectedFolder = folderById.get(selectedFolder.id) || selectedFolder;
  renderFolders();
  renderFiles([]);
  updateBulkActionsForFiles([]);
  await refreshSelectedLeafFolder([]);
};

editFolderForm.onsubmit = async (e) => {
  e.preventDefault();

  if (!editingFolder || !editFolderName.value.trim()) {
    return;
  }

  const editingFolderId = editingFolder.id;
  const name = editFolderName.value.trim();
  const description = editFolderDescription.value.trim();

  const data = await api(`/api/folders/${editingFolderId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name,
      description
    })
  });

  folders = folders.map(folder => {
    if (folder.id !== editingFolderId) {
      return folder;
    }

    return {
      ...folder,
      ...(data.folder || {}),
      description
    };
  });

  if (selectedFolder?.id === editingFolderId) {
    selectedFolder = folderById.get(editingFolderId) || selectedFolder;
  }

  closeEditFolderModal();
  await loadFolders();
};

cancelEditFolder.onclick = closeEditFolderModal;

closeBtn.onclick = closeModal;
nextBtn.onclick = nextFile;
prevBtn.onclick = prevFile;

modalApproveBtn.onclick = async () => {
  const file = currentFiles[currentFileIndex];

  if (!file || file.status === "approved") {
    return;
  }

  await api(`/api/files/${file.id}/approve`, { method: "POST" });
  await loadFiles(selectedFolder);
  await loadFolders();
  updateModal();
};

modalDeleteBtn.onclick = async () => {
  const file = currentFiles[currentFileIndex];

  if (!file || !window.confirm("Delete this file?")) {
    return;
  }

  await api(`/api/files/${file.id}`, { method: "DELETE" });
  currentFiles.splice(currentFileIndex, 1);
  await loadFiles(selectedFolder);
  await loadFolders();

  if (!currentFiles.length) {
    closeModal();
    return;
  }

  currentFileIndex = Math.min(currentFileIndex, currentFiles.length - 1);
  updateModal();
};

document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("active")) {
    return;
  }

  if (e.key === "ArrowRight") {
    nextFile();
  }

  if (e.key === "ArrowLeft") {
    prevFile();
  }

  if (e.key === "Escape") {
    closeModal();
  }
});

function updateToTopButton() {
  toTopBtn.classList.toggle("is-visible", window.scrollY > 320);
}

window.addEventListener("scroll", updateToTopButton, { passive: true });
toTopBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
updateToTopButton();

setBulkActionsVisible(false);
loadFolders();
