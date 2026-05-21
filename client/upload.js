const uploadForm = document.getElementById("uploadForm");
const uploadInput = document.getElementById("uploadInput");
const expirationSelect = document.getElementById("expirationSelect");
const uploadStatus = document.getElementById("uploadStatus");
const uploadResults = document.getElementById("uploadResults");
const uploadSubtitle = document.getElementById("uploadSubtitle");

const apiHost = window.location.hostname || "127.0.0.1";
const isLocalClient = ["localhost", "127.0.0.1"].includes(apiHost) && window.location.port === "5500";
const apiBase = isLocalClient ? `http://${apiHost}:3000` : window.location.origin;
const params = new URLSearchParams(window.location.search);
const folderParam = params.get("folder");

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
      uploadSubtitle.textContent = `Upload to folder: ${folder.path || folder.name}`;
    }
  } catch (err) {
    uploadSubtitle.textContent = `Upload to folder: ${folderId}`;
  }
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

  images.forEach((image) => {
    const item = document.createElement("a");
    item.className = "upload-result";
    item.href = image.originalUrl || image.url;
    item.target = "_blank";
    item.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.src = image.mediumUrl || image.displayUrl || image.originalUrl || image.url;
    img.alt = image.title || "Uploaded image";

    const text = document.createElement("span");
    text.textContent = `${image.title || image.filename || "Uploaded image"} · ${image.status || "pending"}`;

    item.appendChild(img);
    item.appendChild(text);
    uploadResults.appendChild(item);
  });
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

    const images = await Promise.all(files.map(readFileAsDataUrl));
    setStatus("Uploading to ImgBB...");

    const response = await fetch(`${apiBase}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        images,
        expiration,
        folderId: folderParam,
        folderSlug: folderParam
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    setStatus(`Uploaded ${data.count} image(s).`);
    renderResults(data.images);
    uploadInput.value = "";
  } catch (err) {
    setStatus(err.message || "Upload failed.", true);
  } finally {
    uploadForm.querySelector("button").disabled = false;
  }
};
