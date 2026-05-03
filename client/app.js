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

const params = new URLSearchParams(window.location.search);
const albumId = params.get("id");
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

if (!albumId) {
  showStartPage();
} else {
  loadAlbum();
}

function showStartPage(message = "") {
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

      if (data.title) {
        headerTitle.textContent = data.title;
      }

      if (data.subtitle) {
        headerSubtitle.textContent = data.subtitle;
      }

      images = data.images.map(normalizeImage);
      const filesCount = data.count || images.length || 0;
      photoCount.textContent = `${filesCount} files`;
      downloadAllBtn.classList.toggle("hidden", !filesCount);

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
downloadAllBtn.onclick = async () => {
  const zip = new JSZip();

  await Promise.all(
    images.map(async (image, i) => {
      const res = await fetch(image.original);
      const blob = await res.blob();
      zip.file(image.filename || `image_${i + 1}.jpg`, blob);
    })
  );

  const content = await zip.generateAsync({ type: "blob" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "album.zip";
  a.click();
};
