const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "http://127.0.0.1:3000";

const stats = {
  created: 0,
  existing: 0,
  duplicateInput: 0
};
let authCookie = "";

function printHelp() {
  console.log(`Usage: npm run import:mya-periods -- [options]

Options:
  --file <path>          MYA periods JSON file to import. Default: mya-periods.json
  --company <text>       Import only one company, e.g. "Actionsport"
  --username <text>      Admin username. Can also use MYA_ADMIN_USERNAME
  --password <text>      Admin password. Can also use MYA_ADMIN_PASSWORD
  --dry-run              Preview the folder paths without writing to the app
  --help                 Show this help

Examples:
  npm run import:mya-periods -- --file mya-periods.json
  npm run import:mya-periods -- --file mya-periods.json --username admin --password "your-password"
  npm run import:mya-periods -- --file mya-periods.json --company "Actionsport"
  npm run import:mya-periods -- --file mya-periods.json --dry-run
`);
}

function parseArgs(argv) {
  const options = {
    file: "mya-periods.json",
    company: "",
    username: process.env.MYA_ADMIN_USERNAME || "",
    password: process.env.MYA_ADMIN_PASSWORD || "",
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--file") {
      options.file = argv[index + 1];
      index += 1;
    } else if (arg === "--company") {
      options.company = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--username") {
      options.username = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--password") {
      options.password = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function requiredText(value, label) {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error(`${label} is required`);
  }

  return text;
}

function loadRows(filePath, companyFilter) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const data = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  if (!Array.isArray(data.rows)) {
    throw new Error("MYA periods JSON must contain a rows array");
  }

  const wantedCompany = normalizeName(companyFilter);

  return data.rows
    .filter(row => !wantedCompany || normalizeName(row.company).includes(wantedCompany))
    .map(row => ({
      company: requiredText(row.company, "Company"),
      site: requiredText(row.site, "Site"),
      period: requiredText(row.period, "Period"),
      eventId: row.eventId || "",
      startDate: row.startDate || "",
      endDate: row.endDate || "",
      city: row.city || "",
      postalCode: row.postalCode || "",
      address: row.address || ""
    }))
    .sort((a, b) => (
      a.company.localeCompare(b.company) ||
      a.site.localeCompare(b.site) ||
      a.period.localeCompare(b.period, undefined, { numeric: true })
    ));
}

function createDescription(lines) {
  return lines
    .map(line => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}

function formatDisplayDate(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  return text.slice(0, 10).replace(/-/g, "/");
}

function formatDateRange(startDate, endDate) {
  return [
    formatDisplayDate(startDate),
    formatDisplayDate(endDate)
  ].filter(Boolean).join(" - ");
}

function createSiteDescription(row) {
  const location = [row.postalCode, row.city].filter(Boolean).join(" ");

  return createDescription([
    [row.address, location].filter(Boolean).join(", ")
  ]);
}

function createPeriodDescription(row) {
  return createDescription([
    formatDateRange(row.startDate, row.endDate)
  ]);
}

function uniqueRows(rows) {
  const seen = new Set();

  return rows.filter((row) => {
    const key = [row.company, row.site, row.period].map(normalizeName).join("\0");

    if (seen.has(key)) {
      stats.duplicateInput += 1;
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function api(apiPath, options = {}) {
  const response = await fetch(`${API_BASE}${apiPath}`, {
    headers: {
      "Content-Type": "application/json",
      ...(authCookie ? { Cookie: authCookie } : {})
    },
    ...options
  });
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);

  if (setCookie.length) {
    authCookie = setCookie.map(cookie => cookie.split(";")[0]).join("; ");
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${apiPath}`);
  }

  return data;
}

async function authenticate(options) {
  const status = await api("/api/auth/status");

  if (!status.hasAccounts) {
    throw new Error("No admin account exists. Open /login.html in the app first and create an account.");
  }

  if (status.authenticated) {
    return;
  }

  if (!options.username || !options.password) {
    throw new Error("Authentication required. Pass --username and --password, or set MYA_ADMIN_USERNAME and MYA_ADMIN_PASSWORD.");
  }

  await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: options.username,
      password: options.password
    })
  });
}

async function loadFolders() {
  const data = await api("/api/folders");

  return data.folders;
}

function findFolder(folders, name, parentId) {
  return folders.find(folder => (
    normalizeName(folder.name) === normalizeName(name) &&
    (folder.parentId || null) === (parentId || null)
  ));
}

async function getOrCreateFolder(folders, name, parentId = null, description = "") {
  const existing = findFolder(folders, name, parentId);

  if (existing) {
    stats.existing += 1;
    return existing;
  }

  const data = await api("/api/folders", {
    method: "POST",
    body: JSON.stringify({
      name,
      parentId,
      description
    })
  });

  folders.push(data.folder);
  stats.created += 1;

  return data.folder;
}

function printDryRun(rows) {
  const companyKeys = new Set();
  const siteKeys = new Set();
  const periodKeys = new Set();

  rows.forEach((row) => {
    companyKeys.add(normalizeName(row.company));
    siteKeys.add([row.company, row.site].map(normalizeName).join("\0"));
    periodKeys.add([row.company, row.site, row.period].map(normalizeName).join("\0"));
  });

  console.log("Dry run only. No folders were created.");
  console.log(`Rows matched: ${rows.length}`);
  console.log(`Unique companies: ${companyKeys.size}`);
  console.log(`Unique sites: ${siteKeys.size}`);
  console.log(`Unique periods: ${periodKeys.size}`);
  console.log(`Duplicate input rows skipped: ${stats.duplicateInput}`);
  console.log(`Total folder paths to check/create: ${companyKeys.size + siteKeys.size + periodKeys.size}`);
}

async function importRows(rows) {
  const folders = await loadFolders();

  for (const row of rows) {
    const company = await getOrCreateFolder(
      folders,
      row.company,
      null
    );

    const site = await getOrCreateFolder(
      folders,
      row.site,
      company.id,
      createSiteDescription(row)
    );

    await getOrCreateFolder(
      folders,
      row.period,
      site.id,
      createPeriodDescription(row)
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const rows = uniqueRows(loadRows(options.file, options.company));

  if (options.dryRun) {
    printDryRun(rows);
    return;
  }

  await authenticate(options);
  await importRows(rows);

  console.log(`Done. Rows matched: ${rows.length}. Created: ${stats.created}. Existing: ${stats.existing}. Duplicate input rows skipped: ${stats.duplicateInput}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
