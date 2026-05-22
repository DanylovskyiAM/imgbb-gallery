const uploadForm = document.getElementById("uploadForm");
const uploadInput = document.getElementById("uploadInput");
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
let uploadedImages = [];
let currentPreviewIndex = 0;
let lockedScrollY = 0;

if (folderParam) {
  uploadSubtitle.textContent = `Upload to folder: ${folderParam}`;
  loadFolderTitle(folderParam);
}

async function loadFolderTitle(folderId) {
  try {
    const response = await fetch(`${apiBase}/api/folders`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load folders.");
    }

    const folder = data.folders.find(item => (
      item.id === folderId || item.slug === folderId || item.path === folderId
    ));

    if (folder) {
      uploadSubtitle.textContent = `Upload to folder: ${getFolderDisplayPath(folder, data.folders)}`;
    }
  } catch (err) {
    uploadSubtitle.textContent = `Upload to folder: ${folderId}`;
  }
}

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

function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("is-error", isError);
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
      folderId: folderParam,
      folderSlug: folderParam
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

  return data.images[0];
}

uploadForm.onsubmit = async (e) => {
  e.preventDefault();

  const files = Array.from(uploadInput.files || []);

  if (!files.length) {
    setStatus("Choose at least one image.", true);
    return;
  }

  try {
    const expiration = expirationSelect.value;
    uploadForm.querySelector("button").disabled = true;
    setStatus(`Preparing ${files.length} image(s)...`);
    uploadResults.innerHTML = "";

    uploadedImages = [];
    renderResults(uploadedImages);

    for (const [index, file] of files.entries()) {
      setStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
      const image = await readFileAsDataUrl(file);

      setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const uploadedImage = await uploadImage(image, expiration);
      uploadedImages.push(uploadedImage);
      renderResults(uploadedImages);
    }

    setStatus(`Uploaded ${uploadedImages.length} image(s).`);
    uploadInput.value = "";
  } catch (err) {
    setStatus(err.message || "Upload failed.", true);
  } finally {
    uploadForm.querySelector("button").disabled = false;
  }
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
