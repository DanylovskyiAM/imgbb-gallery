const folderForm = document.getElementById("folderForm");
const folderName = document.getElementById("folderName");
const folderDescription = document.getElementById("folderDescription");
const parentFolder = document.getElementById("parentFolder");
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
const editFolderModal = document.getElementById("editFolderModal");
const editFolderForm = document.getElementById("editFolderForm");
const editFolderName = document.getElementById("editFolderName");
const editFolderDescription = document.getElementById("editFolderDescription");
const cancelEditFolder = document.getElementById("cancelEditFolder");

const apiHost = window.location.hostname || "127.0.0.1";
const isLocalClient = ["localhost", "127.0.0.1"].includes(apiHost) && window.location.port === "5500";
const apiBase = isLocalClient ? `http://${apiHost}:3000` : window.location.origin;

let folders = [];
let selectedFolder = null;
let currentFiles = [];
let currentFileIndex = 0;
let lockedScrollY = 0;
let editingFolder = null;

function setBulkActionsVisible(isVisible) {
  bulkFileActions.classList.toggle("hidden", !isVisible);
  approveAllBtn.disabled = !isVisible;
  deleteAllBtn.disabled = !isVisible;
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

function buildFolderTree(parentId = null) {
  return folders
    .filter(folder => (folder.parentId || null) === parentId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name))
    .map(folder => ({
      ...folder,
      children: buildFolderTree(folder.id)
    }));
}

function renderParentOptions() {
  parentFolder.innerHTML = '<option value="">Root folder</option>';
  folders
    .slice()
    .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name))
    .forEach(folder => {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.path || folder.name;
      parentFolder.appendChild(option);
    });
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

function renderFolderNode(folder, depth = 0) {
  const wrapper = document.createElement("div");
  wrapper.className = "folder-node";

  const item = document.createElement("div");
  item.className = "folder-node-content";
  item.dataset.folderId = folder.id;
  item.dataset.parentId = folder.parentId || "";
  item.style.setProperty("--folder-depth", depth);
  item.style.setProperty("--folder-branch-offset", `${Math.max(0, depth - 1) * 24}px`);
  item.style.setProperty("--folder-description-offset", `${depth ? 48 + Math.max(0, depth - 1) * 24 : 24}px`);
  item.onclick = () => loadFiles(folder);

  if (selectedFolder?.id === folder.id) {
    item.classList.add("is-selected");
  }

  const info = document.createElement("button");
  info.type = "button";
  info.className = "folder-info";
  info.onclick = () => loadFiles(folder);

  const folderLabel = document.createElement("span");
  folderLabel.className = "folder-label";

  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = folder.children.length ? "▾" : "•";
  icon.setAttribute("aria-hidden", "true");

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

  const meta = document.createElement("span");
  meta.className = "folder-meta";
  const lastPendingText = folder.pendingCount
    ? ` (${formatRelativeTime(folder.lastPendingUploadedAt)})`
    : "";
  const approvedText = document.createElement("span");
  approvedText.textContent = `${folder.approvedCount} approved`;

  const separator = document.createElement("span");
  separator.textContent = " · ";

  const pendingText = document.createElement("span");
  pendingText.className = folder.pendingCount ? "folder-pending is-active" : "folder-pending";
  pendingText.textContent = `${folder.pendingCount} pending${lastPendingText}`;

  meta.append(approvedText, separator, pendingText);

  const actions = document.createElement("div");
  actions.className = "manage-actions";
  actions.onclick = (e) => e.stopPropagation();

  const uploadLink = document.createElement("a");
  uploadLink.textContent = "Upload";
  uploadLink.href = `/upload.html?folder=${encodeURIComponent(folder.id)}`;

  const viewLink = document.createElement("a");
  viewLink.textContent = "View";
  viewLink.href = `/?folder=${encodeURIComponent(folder.id)}`;

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
      filesSubtitle.textContent = "";
      setBulkActionsVisible(false);
    }

    await loadFolders();
  });

  actions.append(uploadLink, viewLink, renameBtn, deleteBtn);
  item.append(info, meta, actions);
  wrapper.appendChild(item);

  if (folder.children.length) {
    const children = document.createElement("div");
    children.className = "folder-children";
    folder.children.forEach(child => children.appendChild(renderFolderNode(child, depth + 1)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

function renderFolders() {
  folderList.innerHTML = "";

  const tree = buildFolderTree();

  if (!tree.length) {
    folderList.innerHTML = '<p class="empty-state">No folders yet.</p>';
    return;
  }

  tree.forEach(folder => {
    folderList.appendChild(renderFolderNode(folder));
  });
}

function renderFolderOverview() {
  filesTitle.textContent = "Folder overview";
  filesSubtitle.textContent = "";
  setBulkActionsVisible(false);
  fileList.innerHTML = "";
  fileList.classList.add("folder-overview-list");
  fileList.classList.remove("manage-file-grid");

  const totalPending = folders.reduce((sum, folder) => sum + (Number(folder.pendingCount) || 0), 0);
  const foldersWithPending = folders.filter(folder => folder.pendingCount > 0);
  const panel = document.createElement("section");
  panel.className = "folder-overview";

  const header = document.createElement("div");
  header.className = "folder-overview-header";

  const title = document.createElement("div");
  title.innerHTML = `<strong>${foldersWithPending.length} folders</strong><span>${totalPending} waiting files</span>`;

  const approveAllWaiting = createActionButton("Approve all waiting", async () => {
    const foldersWithPending = folders.filter(folder => folder.pendingCount > 0);
    approveAllWaiting.disabled = true;

    await Promise.all(foldersWithPending.map(folder => (
      api(`/api/folders/${folder.id}/files/approve-all`, { method: "POST" })
    )));
    await loadFolders();
  }, { disabled: totalPending === 0 });

  header.append(title, approveAllWaiting);
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "folder-overview-items";

  if (!foldersWithPending.length) {
    list.innerHTML = '<p class="empty-state">No folders with waiting files.</p>';
  }

  foldersWithPending.forEach(folder => {
    const item = document.createElement("div");
    item.className = "folder-overview-item";

    const info = document.createElement("button");
    info.type = "button";
    info.className = "folder-overview-info";
    info.onclick = () => loadFiles(folder);

    const name = document.createElement("strong");
    name.textContent = folder.path || folder.name;

    const description = document.createElement("span");
    description.textContent = folder.description || "-";

    info.append(name, description);

    const pending = document.createElement("span");
    pending.className = "folder-overview-pending";
    pending.textContent = `${folder.pendingCount} waiting (${formatRelativeTime(folder.lastPendingUploadedAt)})`;

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
  const data = await api("/api/folders");
  folders = data.folders;
  renderParentOptions();

  if (selectedFolder) {
    selectedFolder = folders.find(folder => folder.id === selectedFolder.id) || selectedFolder;
  }

  renderFolders();

  if (!selectedFolder) {
    renderFolderOverview();
  }
}

async function loadFiles(folder) {
  selectedFolder = folder;
  filesTitle.textContent = "Files:";
  filesSubtitle.textContent = folder.path;
  setBulkActionsVisible(true);
  renderFolders();

  const data = await api(`/api/folders/${folder.id}/files?status=all`);
  renderFiles(data.files);
}

folderForm.onsubmit = async (e) => {
  e.preventDefault();

  if (!folderName.value.trim()) {
    return;
  }

  await api("/api/folders", {
    method: "POST",
    body: JSON.stringify({
      name: folderName.value.trim(),
      description: folderDescription.value.trim(),
      parentId: parentFolder.value || null
    })
  });
  folderName.value = "";
  folderDescription.value = "";
  await loadFolders();
};

approveAllBtn.onclick = async () => {
  if (!selectedFolder) {
    return;
  }

  approveAllBtn.disabled = true;

  try {
    await api(`/api/folders/${selectedFolder.id}/files/approve-all`, { method: "POST" });
  } catch (err) {
    const pendingFiles = currentFiles.filter(file => file.status !== "approved");
    await Promise.all(pendingFiles.map(file => api(`/api/files/${file.id}/approve`, { method: "POST" })));
  }

  await loadFiles(selectedFolder);
  await loadFolders();
};

deleteAllBtn.onclick = async () => {
  if (!selectedFolder || !window.confirm(`Delete all files in ${selectedFolder.path}?`)) {
    return;
  }

  deleteAllBtn.disabled = true;

  try {
    await api(`/api/folders/${selectedFolder.id}/files`, { method: "DELETE" });
  } catch (err) {
    await Promise.all(currentFiles.map(file => api(`/api/files/${file.id}`, { method: "DELETE" })));
  }

  await loadFiles(selectedFolder);
  await loadFolders();
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
    selectedFolder = folders.find(folder => folder.id === editingFolderId) || selectedFolder;
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

setBulkActionsVisible(false);
loadFolders();
