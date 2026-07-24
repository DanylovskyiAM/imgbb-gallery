const fs = require("fs");
const path = require("path");

function loadLocalEnv() {
  const envPath = path.join(__dirname, "../.env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  });
}

async function main() {
  loadLocalEnv();

  const secret = String(process.env.TELEGRAM_CRON_SECRET || "");
  const port = process.env.PORT || "3000";
  const url = process.env.TELEGRAM_NOTIFY_URL
    || `http://127.0.0.1:${port}/api/notifications/telegram`;

  if (!secret) {
    throw new Error("TELEGRAM_CRON_SECRET is not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new Error(body.error || `Notification request failed with HTTP ${response.status}`);
  }

  console.log(`Telegram status sent at ${body.sentAt} (${body.messageCount} message(s))`);
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
