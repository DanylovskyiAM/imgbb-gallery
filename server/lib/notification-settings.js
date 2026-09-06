const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createNotificationSettings(filePath = path.join(__dirname, "../data/notification-settings.json")) {
  let sending = false;
  function read() {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }
  function update(changes) {
    const settings = { ...read(), ...changes };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(settings) + "\n");
    fs.renameSync(`${filePath}.tmp`, filePath);
  }
  return {
    isEnabled() {
      return read().enabled !== false;
    },
    setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      update({ enabled });
    },
    async sendReportIfChanged({ message, chatId, send }) {
      if (sending) return { skipped: true, reason: "A scheduled report is already being sent" };
      // The first line is the report title and generation time, not status content.
      const content = message.slice(message.indexOf("\n") + 1);
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify([chatId, content])).digest("hex");
      if (read().lastReportFingerprint === fingerprint) {
        return { skipped: true, reason: "Scheduled report has not changed" };
      }
      sending = true;
      try {
        const result = await send();
        update({ lastReportFingerprint: fingerprint });
        return result;
      } finally {
        sending = false;
      }
    }
  };
}

module.exports = { createNotificationSettings };
