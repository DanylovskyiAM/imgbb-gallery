const axios = require("axios");

const TELEGRAM_MESSAGE_LIMIT = 4000;
const DEFAULT_TIME_ZONE = "Europe/Kyiv";

function getFolderHierarchy(folder, folders) {
  const folderById = new Map(folders.map(item => [item.id, item]));
  const hierarchy = [folder];
  const visited = new Set([folder.id]);
  let parentId = folder.parentId;

  while (parentId && !visited.has(parentId)) {
    const parent = folderById.get(parentId);

    if (!parent) {
      break;
    }

    visited.add(parent.id);
    hierarchy.unshift(parent);
    parentId = parent.parentId;
  }

  return hierarchy;
}

function groupPendingFolders(folders) {
  const disciplines = new Map();

  folders
    .filter(folder => Number(folder.pendingCount) > 0)
    .forEach(folder => {
      const hierarchy = getFolderHierarchy(folder, folders);
      const disciplineName = hierarchy[0]?.name || "Other";
      const periodName = hierarchy.at(-1)?.name || "Other";
      const locationName = hierarchy.slice(1, -1).map(item => item.name).join(" / ")
        || "Unassigned location";
      const count = Number(folder.pendingCount);

      if (!disciplines.has(disciplineName)) {
        disciplines.set(disciplineName, {
          name: disciplineName,
          count: 0,
          periods: new Map()
        });
      }

      const discipline = disciplines.get(disciplineName);

      if (!discipline.periods.has(periodName)) {
        discipline.periods.set(periodName, {
          name: periodName,
          count: 0,
          locations: new Map()
        });
      }

      const period = discipline.periods.get(periodName);
      const locationCount = period.locations.get(locationName) || 0;

      discipline.count += count;
      period.count += count;
      period.locations.set(locationName, locationCount + count);
    });

  return [...disciplines.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(discipline => ({
      ...discipline,
      periods: [...discipline.periods.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .map(period => ({
          ...period,
          locations: [...period.locations.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        }))
    }));
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
  const pendingGroups = groupPendingFolders(folders);
  const totalPending = pendingGroups.reduce((total, discipline) => total + discipline.count, 0);
  const keyLine = keyStatus?.configured
    ? `ImgBB API keys: ${keyStatus.available}/${keyStatus.total} available`
    : "ImgBB API keys: not configured";
  const lines = [
    `MYA Gallery status — ${formatReportTime(now, timeZone)}`,
    "",
    keyLine,
    `Waiting for approval: ${pluralizeFiles(totalPending)}`
  ];

  if (pendingGroups.length) {
    lines.push("", "Locations:");
    pendingGroups.forEach(discipline => {
      lines.push(`• ${discipline.name}`);
      discipline.periods.forEach(period => {
        lines.push(`•• ${period.name}`);
        period.locations.forEach(location => {
          lines.push(`••• ${location.name}: ${location.count}`);
        });
      });
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
