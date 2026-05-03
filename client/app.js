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

const params = new URLSearchParams(window.location.search);
const albumId = params.get("id");
const refreshAlbum = params.get("refresh");
const apiHost = window.location.hostname || "127.0.0.1";

let images = [];
let currentIndex = 0;
let imageObserver = null;

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

// LOAD IMAGES
const albumApiUrl = new URL(`http://${apiHost}:3000/api/album/${albumId}`);

if (refreshAlbum) {
  albumApiUrl.searchParams.set("refresh", refreshAlbum);
}

fetch(albumApiUrl)
  .then(res => res.json())
  .then(data => {
    if (data.title) {
      headerTitle.textContent = data.title;
    }

    if (data.subtitle) {
      headerSubtitle.textContent = data.subtitle;
    }

    images = data.images.map(normalizeImage);
    photoCount.textContent = `${data.count || images.length} photos`;

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
  });

// MODAL
function openModal(index) {
  currentIndex = index;
  updateModal();
  modal.classList.add("active");
}

function updateModal() {
  const image = images[currentIndex];
  modalImg.src = image.medium;
  modalImg.alt = image.title || image.filename || `Gallery image ${currentIndex + 1}`;
  downloadBtn.href = image.original;
  downloadBtn.download = image.filename || `image_${currentIndex + 1}.jpg`;
  counter.innerText = `${currentIndex + 1} / ${images.length}`;
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
  if (e.key === "Escape") modal.classList.remove("active");
});

// TOUCH SWIPE
let startX = 0;

modal.addEventListener("touchstart", e => {
  startX = e.touches[0].clientX;
});

modal.addEventListener("touchend", e => {
  let endX = e.changedTouches[0].clientX;

  if (startX - endX > 50) next();
  if (endX - startX > 50) prev();
});

// CLOSE
closeBtn.onclick = () => modal.classList.remove("active");

// DOWNLOAD SINGLE
function downloadImage(url, index, filename) {
  const a = document.createElement("a");
  a.href = url;
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
