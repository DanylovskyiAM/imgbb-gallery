const axios = require("axios");

const TELEGRAM_MESSAGE_LIMIT = 4000;
const DEFAULT_TIME_ZONE = "Europe/Kyiv";

function getFolderDisplayPath(folder, folders) {
  const folderById = new Map(folders.map(item => [item.id, item]));
  const segments = [folder.name];
  const visited = new Set([folder.id]);
  let parentId = folder.parentId;

  while (parentId && !visited.has(parentId)) {
    const parent = folderById.get(parentId);

    if (!parent) {
      break;
    }

    visited.add(parent.id);
    segments.unshift(parent.name);
    parentId = parent.parentId;
  }

  return segments.join(" / ");
}

function pluralizeFiles(count) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function formatReportTime(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function buildTelegramReport({
  keyStatus,
  folders,
  manageUrl = "",
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE
}) {
  const pendingFolders = folders
    .filter(folder => Number(folder.pendingCount) > 0)
    .map(folder => ({
      count: Number(folder.pendingCount),
      path: getFolderDisplayPath(folder, folders)
    }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  const totalPending = pendingFolders.reduce((total, folder) => total + folder.count, 0);
  const keyLine = keyStatus?.configured
    ? `ImgBB API keys: ${keyStatus.available}/${keyStatus.total} available`
    : "ImgBB API keys: not configured";
  const lines = [
    `MYA Gallery status — ${formatReportTime(now, timeZone)}`,
    "",
    keyLine,
    `Waiting for approval: ${pluralizeFiles(totalPending)}`
  ];

  if (pendingFolders.length) {
    lines.push("", "Locations:");
    pendingFolders.forEach(folder => {
      lines.push(`• ${folder.path}: ${pluralizeFiles(folder.count)}`);
    });
  } else {
    lines.push("", "No files are waiting for approval.");
  }

  if (manageUrl) {
    lines.push("", `Manage: ${manageUrl}`);
  }

  return lines.join("\n");
}

function splitTelegramMessage(message, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  const chunks = [];
  let current = "";

  String(message).split("\n").forEach((line) => {
    let remaining = line;

    while (remaining.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }

    const candidate = current ? `${current}\n${remaining}` : remaining;

    if (candidate.length > maxLength) {
      chunks.push(current);
      current = remaining;
    } else {
      current = candidate;
    }
  });

  if (current || !chunks.length) {
    chunks.push(current);
  }

  return chunks;
}

async function sendTelegramReport({
  botToken,
  chatId,
  message,
  request = axios.post
}) {
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured");
  }

  const chunks = splitTelegramMessage(message);

  for (const text of chunks) {
    await request(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      },
      { timeout: 15000 }
    );
  }

  return { messageCount: chunks.length };
}

module.exports = {
  buildTelegramReport,
  sendTelegramReport,
  splitTelegramMessage
};
