const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildLowKeyAlert,
  buildTelegramReport,
  sendTelegramReport,
  splitTelegramMessage
} = require("../lib/telegram-notifier");

test("buildLowKeyAlert reports available, rate-limited, and invalid keys", () => {
  const alert = buildLowKeyAlert({
    keyStatus: { available: 5, total: 10, blocked: 4, invalid: 1 },
    manageUrl: "https://gallery.example/manage.html",
    now: new Date("2026-08-03T12:00:00Z"),
    timeZone: "Europe/Kyiv"
  });

  assert.match(alert, /Only 5\/10 ImgBB API keys are available/);
  assert.match(alert, /Rate limited: 4/);
  assert.match(alert, /Invalid: 1/);
  assert.match(alert, /https:\/\/gallery\.example\/manage\.html/);
});

test("buildTelegramReport includes available keys and pending folders", () => {
  const report = buildTelegramReport({
    keyStatus: { configured: true, available: 2, total: 3 },
    folders: [
      { id: "root", name: "Promosport", parentId: null, pendingCount: 0 },
      { id: "liege", name: "Liège – Sainte-Véronique", parentId: "root", pendingCount: 0 },
      { id: "liege-period", name: "Summer - Week 3", parentId: "liege", pendingCount: 70 },
      { id: "woluwe", name: "Woluwe-Saint-Lambert – Lindthout", parentId: "root", pendingCount: 0 },
      { id: "woluwe-period", name: "Summer - Week 3", parentId: "woluwe", pendingCount: 58 }
    ],
    manageUrl: "https://gallery.example/manage.html",
    now: new Date("2026-07-24T17:00:00Z"),
    timeZone: "Europe/Kyiv"
  });

  assert.match(report, /ImgBB API keys: 2\/3 available/);
  assert.match(report, /Waiting for approval: 128 files/);
  assert.match(
    report,
    /• Promosport\n•• Summer - Week 3\n••• Liège – Sainte-Véronique: 70\n••• Woluwe-Saint-Lambert – Lindthout: 58/
  );
  assert.match(report, /https:\/\/gallery\.example\/manage\.html/);
});

test("buildTelegramReport handles an empty approval queue", () => {
  const report = buildTelegramReport({
    keyStatus: { configured: true, available: 1, total: 1 },
    folders: []
  });

  assert.match(report, /Waiting for approval: 0 files/);
  assert.match(report, /No files are waiting for approval/);
});

test("splitTelegramMessage keeps chunks inside the Telegram limit", () => {
  const message = Array.from({ length: 20 }, (_, index) => `Location ${index}: ${"x".repeat(40)}`).join("\n");
  const chunks = splitTelegramMessage(message, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 120));
});

test("sendTelegramReport posts every generated chunk", async () => {
  const requests = [];

  const result = await sendTelegramReport({
    botToken: "test-token",
    chatId: "test-chat",
    message: "Status message",
    request: async (...args) => {
      requests.push(args);
    }
  });

  assert.equal(result.messageCount, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1].chat_id, "test-chat");
  assert.equal(requests[0][1].text, "Status message");
});
