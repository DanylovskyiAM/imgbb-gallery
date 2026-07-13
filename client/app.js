const gallery = document.getElementById("gallery");
const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const closeBtn = document.getElementById("close");
const downloadBtn = document.getElementById("downloadBtn");
const downloadAllBtn = document.getElementById("downloadAll");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const counter = document.getElementById("counter");
const headerTitle = document.querySelector(".page-header h2");
const headerSubtitle = document.querySelector(".page-header h3");
const photoCount = document.getElementById("photoCount");
const toTopBtn = document.getElementById("toTopBtn");
const startPage = document.getElementById("startPage");
const albumForm = document.getElementById("albumForm");
const albumInput = document.getElementById("albumInput");
const albumError = document.getElementById("albumError");
const headerActions = document.querySelector(".header-actions");
const footerPhone = document.getElementById("footerPhone");
const footerPhoneText = document.getElementById("footerPhoneText");
const footerEmail = document.getElementById("footerEmail");
const footerEmailText = document.getElementById("footerEmailText");
const footerCopyright = document.getElementById("footerCopyright");

const params = new URLSearchParams(window.location.search);
const albumId = params.get("id");
const folderId = params.get("folder");
const refreshAlbum = params.get("refresh");
const apiHost = window.location.hostname || "127.0.0.1";
const isLocalClient = ["localhost", "127.0.0.1"].includes(apiHost) && window.location.port === "5500";
const apiBase = isLocalClient ? `http://${apiHost}:3000` : window.location.origin;

let images = [];
let currentIndex = 0;
let imageObserver = null;
let lockedScrollY = 0;
let zoomScale = 1;
let pinchStartDistance = 0;
let pinchStartScale = 1;
let isPinching = false;
let isDownloadAllInProgress = false;

const footerBrands = {
  actionsport: {
    name: "Actionsport",
    phone: "+3227349416",
    email: "info@actionsport.be",
    bookingUrl: "https://mya-sport.be/en/pr2/home?category=stages+%28holiday+camps%29",
    privacyUrl: "https://mya-sport.be/en/pr2/privacy-policy",
    termsUrl: "https://mya-sport.be/en/pr2/tos"
  },
  promosport: {
    name: "Promosport",
    phone: "+3210459300",
    email: "info@promo-sport.be",
    bookingUrl: "https://mya-sport.be/en/pr1/home?discipline=&category=stages+%28holiday+camps%29",
    privacyUrl: "https://mya-sport.be/en/pr1/privacy-policy",
    termsUrl: "https://mya-sport.be/en/pr1/tos"
  }
};

function getFooterBrand(data = {}) {
  const path = String(data.path || data.displayPath || data.subtitle || data.title || "").toLowerCase();

  return path.startsWith("actionsport") || path.includes("actionsport")
    ? footerBrands.actionsport
    : footerBrands.promosport;
}

function renderFooterBrand(data = {}) {
  const brand = getFooterBrand(data);

  footerPhone.href = `tel:${brand.phone}`;
  footerPhoneText.textContent = brand.phone;
  footerEmail.href = `mailto:${brand.email}`;
  footerEmailText.textContent = brand.email;
  footerCopyright.innerHTML = "";
  footerCopyright.append(`©Copyright 2026, All Rights Reserved by ${brand.name}, `);

  const privacyLink = document.createElement("a");
  privacyLink.className = "underline lowercase cursor-pointer";
  privacyLink.href = brand.privacyUrl;
  privacyLink.textContent = "Privacy Policy";

  const termsLink = document.createElement("a");
  termsLink.className = "underline lowercase cursor-pointer";
  termsLink.href = brand.termsUrl;
  termsLink.textContent = "Terms & Conditions";

  footerCopyright.append(privacyLink, " / ", termsLink);
}

function formatAvailabilityDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function renderGalleryNotice(data, filesCount, foldersCount) {
  const brand = getFooterBrand(data);
  const notice = document.createElement("section");
  notice.className = "gallery-notice";

  const message = document.createElement("p");

  if (filesCount > 0) {
    const availableUntil = formatAvailabilityDate(data.availability?.availableUntil);
    message.textContent = availableUntil
      ? `Veuillez noter que les fichiers seront accessibles jusqu'au ${availableUntil}`
      : "Veuillez noter que les fichiers seront accessibles pendant une durée limitée.";
  } else if (folderId && foldersCount === 0) {
    message.textContent = "Les fichiers ne sont plus disponibles.";
  } else {
    return;
  }

  const booking = document.createElement("a");
  booking.href = brand.bookingUrl;
  booking.target = "_blank";
  booking.rel = "noopener";
  booking.textContent = "Réservez le prochain stage dès aujourd'hui";

  notice.append(message, booking);
  gallery.appendChild(notice);
}

if (folderId) {
  loadFolderGallery();
} else if (!albumId) {
  showStartPage();
} else {
  loadAlbum();
}

function showStartPage(message = "") {
  renderFooterBrand();
  document.body.classList.add("start-mode");
  headerTitle.textContent = "Gallery";
  headerSubtitle.textContent = "Enter an ImgBB album ID";
  headerActions.classList.add("hidden");
  gallery.classList.add("hidden");
  startPage.classList.remove("hidden");
  albumInput.value = albumId || "";
  albumError.textContent = message;
  albumError.classList.toggle("hidden", !message);
}

function normalizeImage(image) {
  if (typeof image === "string") {
    return {
      title: "",
      filename: "",
      medium: image,
      original: image
    };
  }

  return {
    title: image.title || "",
    filename: image.filename || "",
    medium: image.medium || image.original,
    original: image.original || image.medium
  };
}

function loadThumbnail(img) {
  const src = img.dataset.src;

  if (!src) {
    return;
  }

  img.onload = () => {
    img.closest(".card")?.classList.add("is-loaded");
  };
  img.src = src;
  img.removeAttribute("data-src");
}

function setupLazyLoading() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".lazy-image").forEach(loadThumbnail);
    return;
  }

  imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) {
        return;
      }

      loadThumbnail(entry.target);
      observer.unobserve(entry.target);
    });
  }, {
    root: null,
    rootMargin: "0px",
    threshold: 0.01
  });

  document.querySelectorAll(".lazy-image").forEach(img => {
    imageObserver.observe(img);
  });
}

function getDownloadUrl(url, filename) {
  const downloadUrl = new URL("/api/download", apiBase);
  downloadUrl.searchParams.set("url", url);

  if (filename) {
    downloadUrl.searchParams.set("filename", filename);
  }

  return downloadUrl.toString();
}

function renderGallery(data) {
  renderFooterBrand(data);
  gallery.innerHTML = "";

  if (data.title) {
    headerTitle.textContent = data.title;
  }

  if (data.subtitle) {
    headerSubtitle.textContent = data.subtitle;
  }

  images = data.images.map(normalizeImage);
  const folders = Array.isArray(data.folders) ? data.folders : [];
  const filesCount = data.count || images.length || 0;
  photoCount.textContent = folders.length
    ? `${folders.length} folders · ${filesCount} files`
    : `${filesCount} files`;
  downloadAllBtn.classList.toggle("hidden", !filesCount);
  renderGalleryNotice(data, filesCount, folders.length);

  folders.forEach((folder) => {
    const card = document.createElement("a");
    card.className = "folder-card";
    card.href = `${window.location.pathname}?folder=${encodeURIComponent(folder.id)}`;

    const icon = document.createElement("span");
    icon.className = "folder-card-icon";
    icon.textContent = "▾";
    icon.setAttribute("aria-hidden", "true");

    const content = document.createElement("span");
    content.className = "folder-card-content";

    const title = document.createElement("strong");
    title.textContent = folder.name;

    const description = document.createElement("small");
    description.textContent = folder.description || folder.parentDisplayPath || folder.displayPath || folder.path;

    const meta = document.createElement("span");
    meta.textContent = `${folder.approvedCount || 0} approved files`;

    content.append(title, description, meta);
    card.append(icon, content);
    gallery.appendChild(card);
  });

  images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "card";

    const img = document.createElement("img");
    img.className = "lazy-image";
    img.dataset.src = image.medium;
    img.alt = image.title || image.filename || `Gallery image ${index + 1}`;
    img.onclick = () => openModal(index);

    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.className = "download-btn";
    btn.onclick = (e) => {
      e.stopPropagation();
      downloadImage(image.original, index, image.filename);
    };

    const number = document.createElement("span");
    number.className = "photo-number";
    number.textContent = index + 1;

    card.appendChild(img);
    card.appendChild(number);
    card.appendChild(btn);
    gallery.appendChild(card);
  });

  setupLazyLoading();
}

function loadFolderGallery() {
  fetch(new URL(`/api/gallery/folders/${folderId}`, apiBase))
    .then(async res => {
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Folder was not found.");
      }

      return data;
    })
    .then(renderGallery)
    .catch(() => {
      showStartPage("Folder was not found or has no approved files yet.");
    });
}

function loadAlbum() {
  const albumApiUrl = new URL(`/api/album/${albumId}`, apiBase);

  if (refreshAlbum) {
    albumApiUrl.searchParams.set("refresh", refreshAlbum);
  }

  fetch(albumApiUrl)
    .then(async res => {
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Gallery was not found. Check the ID and try again.");
      }

      return data;
    })
    .then(data => {
      if (!Array.isArray(data.images) || data.images.length === 0) {
        showStartPage("Gallery was not found. Check the ID and try again.");
        return;
      }

      renderGallery(data);
    })
    .catch(() => {
      showStartPage("Gallery was not found. Check the ID and try again.");
    });
}

albumForm.onsubmit = (e) => {
  e.preventDefault();
  const nextAlbumId = albumInput.value.trim();

  if (!nextAlbumId) {
    return;
  }

  window.location.href = `${window.location.pathname}?id=${encodeURIComponent(nextAlbumId)}`;
};

// MODAL
function openModal(index) {
  currentIndex = index;
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
  const image = images[currentIndex];
  resetModalZoom();
  modalImg.src = image.medium;
  modalImg.alt = image.title || image.filename || `Gallery image ${currentIndex + 1}`;
  downloadBtn.href = getDownloadUrl(image.original, image.filename);
  downloadBtn.download = image.filename || `image_${currentIndex + 1}.jpg`;
  counter.innerText = `${currentIndex + 1} / ${images.length}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTouchDistance(touches) {
  const deltaX = touches[0].clientX - touches[1].clientX;
  const deltaY = touches[0].clientY - touches[1].clientY;

  return Math.hypot(deltaX, deltaY);
}

function applyModalZoom() {
  modalImg.style.transform = `scale(${zoomScale})`;
}

function resetModalZoom() {
  zoomScale = 1;
  pinchStartDistance = 0;
  pinchStartScale = 1;
  isPinching = false;
  applyModalZoom();
}

// NAVIGATION
function next() {
  currentIndex = (currentIndex + 1) % images.length;
  updateModal();
}

function prev() {
  currentIndex = (currentIndex - 1 + images.length) % images.length;
  updateModal();
}

nextBtn.onclick = next;
prevBtn.onclick = prev;

// KEYBOARD
document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("active")) return;

  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") prev();
  if (e.key === "Escape") closeModal();
});

// TOUCH SWIPE
let startX = 0;
let startY = 0;

modal.addEventListener("touchstart", e => {
  if (e.touches.length === 2) {
    isPinching = true;
    pinchStartDistance = getTouchDistance(e.touches);
    pinchStartScale = zoomScale;
    return;
  }

  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
});

modal.addEventListener("touchmove", e => {
  if (e.touches.length !== 2 || !pinchStartDistance) {
    return;
  }

  e.preventDefault();
  const distance = getTouchDistance(e.touches);
  zoomScale = clamp(pinchStartScale * (distance / pinchStartDistance), 1, 4);
  applyModalZoom();
}, { passive: false });

modal.addEventListener("touchend", e => {
  if (isPinching) {
    if (e.touches.length < 2) {
      pinchStartDistance = 0;
      pinchStartScale = zoomScale;
      isPinching = false;
    }

    return;
  }

  if (zoomScale > 1.05) {
    return;
  }

  const endX = e.changedTouches[0].clientX;
  const endY = e.changedTouches[0].clientY;
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  if (deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX)) {
    closeModal();
    return;
  }

  if (deltaX < -50) next();
  if (deltaX > 50) prev();
});

// CLOSE
closeBtn.onclick = closeModal;

// SCROLL TO TOP
function updateToTopButton() {
  toTopBtn.classList.toggle("is-visible", window.scrollY > 320);
}

window.addEventListener("scroll", updateToTopButton, { passive: true });
toTopBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
updateToTopButton();

// DOWNLOAD SINGLE
function downloadImage(url, index, filename) {
  const a = document.createElement("a");
  a.href = getDownloadUrl(url, filename);
  a.download = filename || `image_${index + 1}.jpg`;
  a.click();
}

// DOWNLOAD ALL (ZIP)
function setDownloadAllButton(label, disabled = false) {
  downloadAllBtn.textContent = label;
  downloadAllBtn.disabled = disabled;
  downloadAllBtn.setAttribute("aria-busy", String(disabled));
}

async function addImagesToZip(zip) {
  const concurrency = Math.min(4, images.length);
  let nextIndex = 0;
  let completed = 0;
  let failed = false;

  const worker = async () => {
    try {
      while (!failed && nextIndex < images.length) {
        const index = nextIndex++;
        const image = images[index];
        const response = await fetch(image.original);

        if (!response.ok) {
          throw new Error(`Could not download image ${index + 1}.`);
        }

        const blob = await response.blob();

        if (failed) {
          return;
        }

        zip.file(image.filename || `image_${index + 1}.jpg`, blob);
        completed += 1;
        setDownloadAllButton(`Preparing ${completed} of ${images.length}…`, true);
      }
    } catch (err) {
      failed = true;
      throw err;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}

downloadAllBtn.onclick = async () => {
  if (isDownloadAllInProgress || !images.length) {
    return;
  }

  isDownloadAllInProgress = true;
  const zip = new JSZip();

  try {
    setDownloadAllButton(`Preparing 0 of ${images.length}…`, true);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await addImagesToZip(zip);

    const content = await zip.generateAsync({ type: "blob", streamFiles: true }, (metadata) => {
      setDownloadAllButton(`Creating ZIP ${Math.round(metadata.percent)}%…`, true);
    });

    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "album.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    window.alert(err.message || "Unable to prepare the download. Please try again.");
  } finally {
    isDownloadAllInProgress = false;
    setDownloadAllButton("Download All");
  }
};
