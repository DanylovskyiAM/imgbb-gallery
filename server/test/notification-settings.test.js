const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createNotificationSettings } = require("../lib/notification-settings");

test("scheduled reports default on and persist toggles across instances", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notification-settings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  const settings = createNotificationSettings(file);
  assert.equal(settings.isEnabled(), true);
  settings.setEnabled(false);
  assert.equal(createNotificationSettings(file).isEnabled(), false);
  settings.setEnabled(true);
  assert.equal(createNotificationSettings(file).isEnabled(), true);
  assert.throws(() => settings.setEnabled("false"), /boolean/);
  assert.equal(settings.isEnabled(), true);
});

test("reports ignore timestamps, persist successful content, and retry failures", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notification-reports-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  let settings = createNotificationSettings(file);
  let sends = 0;
  const report = (message, send = async () => { sends++; return { messageCount: 1 }; }) =>
    settings.sendReportIfChanged({ message, chatId: "chat", send });
  await report("Status — Monday\nKeys: 3\nPending: 2");
  settings.setEnabled(false);
  settings.setEnabled(true);
  settings = createNotificationSettings(file);
  assert.equal((await report("Status — Tuesday\nKeys: 3\nPending: 2")).skipped, true);
  assert.equal(sends, 1);
  await report("Status — Tuesday\nKeys: 2\nPending: 2");
  assert.equal(sends, 2);
  await assert.rejects(report("Status\nKeys: 2\nPending: 3", async () => { throw new Error("send failed"); }), /send failed/);
  await report("Status\nKeys: 2\nPending: 3");
  assert.equal(sends, 3);
  await settings.sendReportIfChanged({ message: "Status\nKeys: 2\nPending: 3", chatId: "new-chat", send: async () => { sends++; } });
  assert.equal(sends, 4);
});

test("overlapping scheduled reports send only once", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notification-overlap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settings = createNotificationSettings(path.join(directory, "settings.json"));
  let finish;
  const pending = settings.sendReportIfChanged({
    message: "Status\nPending: 2", chatId: "chat",
    send: () => new Promise(resolve => { finish = resolve; })
  });
  const result = await settings.sendReportIfChanged({
    message: "Status\nPending: 2", chatId: "chat",
    send: () => assert.fail("duplicate send")
  });
  assert.equal(result.skipped, true);
  finish({ messageCount: 1 });
  await pending;
});
