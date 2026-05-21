const axios = require("axios");

async function uploadImage({ apiKey, image, expiration }) {
  const base64 = String(image.data || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  const body = new URLSearchParams();
  body.set("image", base64);

  if (image.name) {
    body.set("name", image.name.replace(/\.[^.]+$/, ""));
  }

  const uploadUrl = new URL("https://api.imgbb.com/1/upload");
  uploadUrl.searchParams.set("key", apiKey);

  if (expiration) {
    uploadUrl.searchParams.set("expiration", String(expiration));
  }

  const response = await axios.post(uploadUrl.toString(), body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    maxBodyLength: Infinity
  });
  const data = response.data.data;

  return {
    provider: "imgbb",
    providerFileId: data.id,
    filename: image.name || data.title || "image",
    title: data.title || image.name || "image",
    mediumUrl: data.display_url || data.url,
    originalUrl: data.url,
    deleteUrl: data.delete_url
  };
}

module.exports = {
  uploadImage
};
