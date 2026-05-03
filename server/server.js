const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

const BASE = "https://ibb.co";
const MAX_PAGES = 25;
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = {};

function mapImageObject(item) {
  const medium = item.medium?.url || item.display_url;
  const original = item.image?.url || item.url;

  if (!medium || !original) {
    return null;
  }

  return {
    id: item.id_encoded,
    title: item.title || item.name || item.image?.name || "",
    filename: item.filename || item.image?.filename || "",
    width: Number(item.width) || null,
    height: Number(item.height) || null,
    medium,
    original
  };
}

function extractImages(html) {
  const $ = cheerio.load(html);
  const images = [];

  $("[data-object]").each((_, element) => {
    const encoded = $(element).attr("data-object");

    if (!encoded) {
      return;
    }

    try {
      const item = JSON.parse(decodeURIComponent(encoded));
      const image = mapImageObject(item);

      if (image) {
        images.push(image);
      }
    } catch (err) {
      // Ignore malformed entries from the external page and keep parsing.
    }
  });

  return images;
}

function extractAlbumMetadata(html) {
  const $ = cheerio.load(html);
  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $('[data-text="album-name"]').first().text() ||
    $("h1").first().text() ||
    ""
  ).trim();
  const subtitle = (
    $('meta[property="og:description"]').attr("content") ||
    $('[data-text="album-description"]').first().text() ||
    $('meta[name="description"]').attr("content") ||
    ""
  ).trim();

  return {
    title,
    subtitle
  };
}

function getNextPageUrl(html) {
  const $ = cheerio.load(html);
  const nextUrl = $(".pagination-next:not(.pagination-disabled) a[href]").attr("href");

  if (!nextUrl) {
    return null;
  }

  return new URL(nextUrl, BASE).toString();
}

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && parsed.hostname === "i.ibb.co";
  } catch (err) {
    return false;
  }
}

async function fetchAlbumPage(url) {
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  return html;
}

async function fetchAlbumImages(id) {
  const images = [];
  const seen = new Set();
  let metadata = {
    title: "",
    subtitle: ""
  };
  let url = `${BASE}/album/${id}`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    page += 1;
    const html = await fetchAlbumPage(url);

    if (page === 1) {
      metadata = extractAlbumMetadata(html);
    }

    for (const image of extractImages(html)) {
      const key = image.id || image.original;

      if (!seen.has(key)) {
        seen.add(key);
        images.push(image);
      }
    }

    url = getNextPageUrl(html);
  }

  return {
    ...metadata,
    images
  };
}

app.get("/api/album/:id", async (req, res) => {
  const { id } = req.params;
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const cached = cache[id];
    const isCacheFresh = cached && Date.now() - cached.updatedAt < CACHE_TTL_MS;

    if (forceRefresh || !isCacheFresh) {
      cache[id] = {
        data: await fetchAlbumImages(id),
        updatedAt: Date.now()
      };
    }

    const album = cache[id].data;
    const images = album.images;

    if (images.length === 0) {
      return res.status(500).json({
        error: "No images found in the album markup"
      });
    }

    res.json({
      id,
      title: album.title,
      subtitle: album.subtitle,
      count: images.length,
      images
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to load album" });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, filename } = req.query;

  if (!url || !isAllowedImageUrl(url)) {
    return res.status(400).json({ error: "Invalid image URL" });
  }

  try {
    const image = await axios.get(url, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });
    const safeFilename = (filename || url.split("/").pop() || "image").replace(/["\r\n]/g, "");

    res.setHeader("Content-Type", image.headers["content-type"] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);

    image.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to download image" });
  }
});

app.use(express.static(path.join(__dirname, "../client")));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
