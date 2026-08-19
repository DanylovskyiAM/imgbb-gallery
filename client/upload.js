const uploadForm = document.getElementById("uploadForm");
const uploadInput = document.getElementById("uploadInput");
const uploadButton = uploadForm.querySelector("button[type='submit']");
const periodSelect = document.getElementById("periodSelect");
const expirationSelect = document.getElementById("expirationSelect");
const uploadStatus = document.getElementById("uploadStatus");
const uploadResults = document.getElementById("uploadResults");
const uploadSubtitle = document.getElementById("uploadSubtitle");
const deleteAllUploadsBtn = document.getElementById("deleteAllUploadsBtn");
const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const closeBtn = document.getElementById("close");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const counter = document.getElementById("counter");
const downloadBtn = document.getElementById("downloadBtn");
const modalDeleteBtn = document.getElementById("modalDeleteBtn");
const toTopBtn = document.getElementById("toTopBtn");

const apiHost = window.location.hostname || "127.0.0.1";
const isLocalClient = ["localhost", "127.0.0.1"].includes(apiHost) && window.location.port === "5500";
const apiBase = isLocalClient ? `http://${apiHost}:3000` : window.location.origin;
const params = new URLSearchParams(window.location.search);
const folderParam = params.get("folder");
const periodParam = params.get("period");
const preferredPeriodStorageKey = "myaPreferredUploadPeriod";
const defaultExpirationSeconds = "2592000";
let uploadedImages = [];
let currentPreviewIndex = 0;
let lockedScrollY = 0;
let folders = [];
let folderById = new Map();
let currentLocation = null;
let selectedUploadFolderId = "";
let preferredUploadPeriod = localStorage.getItem(preferredPeriodStorageKey) || "";
let currentUser = null;

expirationSelect.value = defaultExpirationSeconds;
expirationSelect.disabled = true;

loadAuthStatus();

if (folderParam) {
  uploadSubtitle.textContent = `Upload to folder: ${folderParam}`;
  loadFolderContext(folderParam);
} else {
  periodSelect.disabled = true;
  updateUploadButtonState();
  uploadSubtitle.textContent = "Open upload from a location or period folder";
}

updateUploadButtonState();

function isAdminUser(user) {
  return user?.role === "admin";
}

async function loadAuthStatus() {
  try {
    const response = await fetch(`${apiBase}/api/auth/status`);
    const data = await response.json();

    currentUser = data.user || null;
    expirationSelect.disabled = !isAdminUser(currentUser);
  } catch (err) {
    currentUser = null;
    expirationSelect.disabled = true;
  }

  if (expirationSelect.disabled) {
    expirationSelect.value = defaultExpirationSeconds;
  }
}

async function loadFolderContext(folderId) {
  try {
    const response = await fetch(`${apiBase}/api/folders`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load folders.");
    }

    folders = data.folders;
    folderById = new Map(folders.map(folder => [folder.id, folder]));
    await loadPreferredUploadPeriod();

    const folder = folders.find(item => (
      item.id === folderId || item.slug === folderId || item.path === folderId
    ));

    if (folder) {
      applyFolderContext(folder);
      return;
    }

    throw new Error("Folder was not found.");
  } catch (err) {
    uploadSubtitle.textContent = `Upload to folder: ${folderId}`;
    periodSelect.disabled = true;
    updateUploadButtonState();
    setStatus("Folder was not found. Open upload from the manage page.", true);
  }
}

function getChildFolders(parentId) {
  return folders
    .filter(folder => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function hasChildFolders(folder) {
  return getChildFolders(folder.id).length > 0;
}

function getFolderAncestors(folder) {
  const ancestors = [folder];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = folderById.get(parentId);

    if (!parent) {
      break;
    }

    ancestors.unshift(parent);
    parentId = parent.parentId;
  }

  return ancestors;
}

function getFolderDisplayPath(folder) {
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

  return segments.join(" / ");
}

function setSelectOptions(select, items, placeholder) {
  select.innerHTML = "";

  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  select.appendChild(option);

  items.forEach((item) => {
    const itemOption = document.createElement("option");
    itemOption.value = item.id;
    itemOption.textContent = item.name;
    select.appendChild(itemOption);
  });
}

function findPreferredPeriod(periods) {
  const preferredPeriod = String(periodParam || preferredUploadPeriod || localStorage.getItem(preferredPeriodStorageKey) || "").trim();

  if (!preferredPeriod) {
    return null;
  }

  const normalizedPreferredPeriod = preferredPeriod.toLowerCase();

  return periods.find(period => (
    period.id === preferredPeriod ||
    period.slug === preferredPeriod ||
    period.path === preferredPeriod ||
    String(period.name || "").toLowerCase() === normalizedPreferredPeriod
  )) || null;
}

async function loadPreferredUploadPeriod() {
  if (periodParam) {
    return;
  }

  try {
    const response = await fetch(`${apiBase}/api/preferences`);
    const data = await response.json();

    if (response.ok) {
      preferredUploadPeriod = data.preferences?.preferredUploadPeriod || preferredUploadPeriod;

      if (preferredUploadPeriod) {
        localStorage.setItem(preferredPeriodStorageKey, preferredUploadPeriod);
      }
    }
  } catch (err) {
    // Local storage remains the fallback when preferences cannot be loaded.
  }
}

function resolveFolderContext(folder) {
  const ancestors = getFolderAncestors(folder);

  return {
    company: ancestors[0] || null,
    location: ancestors[1] || null,
    period: ancestors[2] || null
  };
}

function applyFolderContext(folder) {
  const context = resolveFolderContext(folder);

  if (!context.location) {
    uploadSubtitle.textContent = `Upload to folder: ${getFolderDisplayPath(folder)}`;
    periodSelect.disabled = true;
    updateUploadButtonState();
    setStatus("Choose a location or period folder from manage page.", true);
    return;
  }

  currentLocation = context.location;
  uploadSubtitle.textContent = `Upload to location: ${getFolderDisplayPath(currentLocation)}`;
  periodSelect.disabled = false;

  const periods = getChildFolders(currentLocation.id);
  const preferredPeriod = context.period || findPreferredPeriod(periods);

  setSelectOptions(periodSelect, periods, "Select period");
  periodSelect.value = preferredPeriod?.id || "";
  updateSelectedUploadFolder();
}

function updateSelectedUploadFolder() {
  const period = folderById.get(periodSelect.value);
  selectedUploadFolderId = period?.id || "";
  updateUploadButtonState();

  if (period) {
    uploadSubtitle.textContent = `Upload to folder: ${getFolderDisplayPath(period)}`;
    setStatus("");
  } else if (currentLocation) {
    uploadSubtitle.textContent = `Upload to location: ${getFolderDisplayPath(currentLocation)}`;
  }
}

function updateUploadButtonState(isUploading = false) {
  const hasSelectedFiles = (uploadInput.files || []).length > 0;
  uploadButton.disabled = isUploading || !periodSelect.value || !selectedUploadFolderId || !hasSelectedFiles;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      data: reader.result
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setStatus(message, isError = false, isSuccess = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("is-error", isError);
  uploadStatus.classList.toggle("is-success", isSuccess);
}

function renderResults(images) {
  uploadResults.innerHTML = "";
  deleteAllUploadsBtn.disabled = !images.length;

  if (!images.length) {
    uploadResults.innerHTML = '<p class="empty-state">Uploaded files will appear here.</p>';
    return;
  }

  images.forEach((image, index) => {
    const item = document.createElement("article");
    item.className = "upload-result";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "upload-preview-btn";
    previewBtn.onclick = () => openModal(index);

    const img = document.createElement("img");
    img.src = image.mediumUrl || image.displayUrl || image.originalUrl || image.url;
    img.alt = image.title || "Uploaded image";
    previewBtn.appendChild(img);

    const text = document.createElement("span");
    text.textContent = `${image.title || image.filename || "Uploaded image"} · ${image.status || "pending"}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger-action";
    removeBtn.textContent = "Delete";
    removeBtn.onclick = () => removeUploadedImage(image, removeBtn);

    item.appendChild(previewBtn);
    item.appendChild(text);
    item.appendChild(removeBtn);
    uploadResults.appendChild(item);
  });
}

function getPreviewUrl(image) {
  return image.originalUrl || image.url || image.mediumUrl || image.displayUrl;
}

function updateModal() {
  const image = uploadedImages[currentPreviewIndex];

  if (!image) {
    closeModal();
    return;
  }

  modalImg.src = getPreviewUrl(image);
  modalImg.alt = image.title || image.filename || `Uploaded image ${currentPreviewIndex + 1}`;
  counter.textContent = `${currentPreviewIndex + 1} / ${uploadedImages.length}`;
  downloadBtn.href = image.originalUrl || image.url;
  downloadBtn.download = image.filename || image.title || `uploaded-image-${currentPreviewIndex + 1}.jpg`;
  modalDeleteBtn.disabled = false;
}

function openModal(index) {
  currentPreviewIndex = index;
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

function nextPreview() {
  currentPreviewIndex = (currentPreviewIndex + 1) % uploadedImages.length;
  updateModal();
}

function prevPreview() {
  currentPreviewIndex = (currentPreviewIndex - 1 + uploadedImages.length) % uploadedImages.length;
  updateModal();
}

async function removeUploadedImage(image, button) {
  if (!image.id) {
    return;
  }

  button.disabled = true;

  try {
    const response = await fetch(`${apiBase}/api/files/${encodeURIComponent(image.id)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error("Failed to remove uploaded file.");
    }

    uploadedImages = uploadedImages.filter(item => item.id !== image.id);
    renderResults(uploadedImages);
    if (modal.classList.contains("active")) {
      currentPreviewIndex = Math.min(currentPreviewIndex, uploadedImages.length - 1);
      updateModal();
    }
    setStatus(uploadedImages.length ? `${uploadedImages.length} uploaded image(s).` : "Uploaded file removed.");
  } catch (err) {
    button.disabled = false;
    setStatus(err.message || "Failed to remove uploaded file.", true);
  }
}

async function deleteAllUploadedImages() {
  if (!uploadedImages.length || !window.confirm("Delete all uploaded files from this list?")) {
    return;
  }

  deleteAllUploadsBtn.disabled = true;
  const imagesToDelete = [...uploadedImages];

  try {
    await Promise.all(imagesToDelete.map(image => (
      fetch(`${apiBase}/api/files/${encodeURIComponent(image.id)}`, { method: "DELETE" })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to remove uploaded files.");
          }
        })
    )));

    uploadedImages = [];
    renderResults(uploadedImages);
    closeModal();
    setStatus("Uploaded files removed.");
  } catch (err) {
    deleteAllUploadsBtn.disabled = false;
    setStatus(err.message || "Failed to remove uploaded files.", true);
  }
}

async function uploadImage(image, expiration) {
  const response = await fetch(`${apiBase}/api/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      images: [image],
      expiration,
      folderId: selectedUploadFolderId,
      folderSlug: selectedUploadFolderId
    })
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("Upload is too large for the cloud server. Increase Nginx client_max_body_size.");
    }

    throw new Error(data.error || "Upload failed.");
  }

  return {
    image: data.images[0] || null,
    failedFiles: Array.isArray(data.failedFiles) ? data.failedFiles : []
  };
}

uploadForm.onsubmit = async (e) => {
  e.preventDefault();

  const files = Array.from(uploadInput.files || []);

  if (!selectedUploadFolderId) {
    setStatus("Select a period before uploading.", true);
    return;
  }

  if (!files.length) {
    setStatus("Choose at least one image.", true);
    return;
  }

  try {
    const expiration = isAdminUser(currentUser) ? expirationSelect.value : defaultExpirationSeconds;
    updateUploadButtonState(true);
    setStatus(`Preparing ${files.length} image(s)...`);
    uploadResults.innerHTML = "";

    uploadedImages = [];
    renderResults(uploadedImages);
    const failedFileNames = [];

    for (const [index, file] of files.entries()) {
      try {
        setStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
        const image = await readFileAsDataUrl(file);

        setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        const result = await uploadImage(image, expiration);

        if (result.image) {
          uploadedImages.push(result.image);
          renderResults(uploadedImages);
        }

        failedFileNames.push(...result.failedFiles);
      } catch (err) {
        failedFileNames.push(file.name);
      }
    }

    const successMessage = uploadedImages.length === 1
      ? "Success! 1 file has been uploaded and is waiting for approval."
      : `Success! ${uploadedImages.length} files have been uploaded and are waiting for approval.`;
    const uniqueFailedFileNames = [...new Set(failedFileNames)];
    const failureMessage = uniqueFailedFileNames.length
      ? ` Files not uploaded correctly: ${uniqueFailedFileNames.join(", ")}.`
      : "";
    setStatus(successMessage + failureMessage, Boolean(uniqueFailedFileNames.length), !uniqueFailedFileNames.length);
    uploadInput.value = "";
  } catch (err) {
    setStatus(err.message || "Upload failed.", true);
  } finally {
    updateUploadButtonState();
  }
};

periodSelect.onchange = () => {
  updateSelectedUploadFolder();
};

uploadInput.onchange = () => {
  updateUploadButtonState();
};

closeBtn.onclick = closeModal;
nextBtn.onclick = nextPreview;
prevBtn.onclick = prevPreview;
modalDeleteBtn.onclick = () => {
  const image = uploadedImages[currentPreviewIndex];

  if (!image) {
    return;
  }

  removeUploadedImage(image, modalDeleteBtn);
};
deleteAllUploadsBtn.onclick = deleteAllUploadedImages;

document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("active")) {
    return;
  }

  if (e.key === "Escape") {
    closeModal();
  } else if (e.key === "ArrowRight") {
    nextPreview();
  } else if (e.key === "ArrowLeft") {
    prevPreview();
  }
});

function updateToTopButton() {
  toTopBtn.classList.toggle("is-visible", window.scrollY > 320);
}

window.addEventListener("scroll", updateToTopButton, { passive: true });
toTopBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
updateToTopButton();
