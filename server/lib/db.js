const driver = String(process.env.DB_DRIVER || "sqlite").trim().toLowerCase();

if (driver === "json") {
  module.exports = require("./db-json");
} else {
  module.exports = require("./db-sqlite");
}
