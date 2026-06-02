const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "http://127.0.0.1:3000";

const stats = {
  created: 0,
  existing: 0,
  duplicateInput: 0
};

function printHelp() {
  console.log(`Usage: npm run import:mya -- [options]

Options:
  --file <path>          MYA JSON file to import. Default: mya-stages.json
  --discipline <text>    Import only rows whose discipline contains this text
  --dry-run              Preview the folder paths without writing to the app
  --help                 Show this help

Examples:
  npm run import:mya -- --file mya-stages.json
  npm run import:mya -- --file mya-stages.json --discipline "Mixed games"
  npm run import:mya -- --file mya-stages.json --dry-run
`);
}

function parseArgs(argv) {
  const options = {
    file: "mya-stages.json",
    discipline: "",
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--file") {
      options.file = argv[index + 1];
      index += 1;
    } else if (arg === "--discipline") {
      options.discipline = argv[index + 1] || "";
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

function loadRows(filePath, disciplineFilter) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const data = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  if (!Array.isArray(data.rows)) {
    throw new Error("MYA JSON must contain a rows array");
  }

  const wantedDiscipline = normalizeName(disciplineFilter);

  return data.rows
    .filter(row => !wantedDiscipline || normalizeName(row.discipline).includes(wantedDiscipline))
    .map(row => ({
      company: requiredText(row.company || "Promosport", "Company"),
      site: requiredText(row.site, "Site"),
      period: requiredText(row.period, "Period"),
      discipline: requiredText(row.discipline, "Discipline"),
      groupTime: row.groupTime || "",
      eventId: row.eventId || "",
      disciplineId: row.disciplineId || "",
      startDate: row.startDate || "",
      endDate: row.endDate || "",
      city: row.city || "",
      postalCode: row.postalCode || "",
      address: row.address || ""
    }))
    .sort((a, b) => (
      a.company.localeCompare(b.company) ||
      a.site.localeCompare(b.site) ||
      a.period.localeCompare(b.period, undefined, { numeric: true }) ||
      a.discipline.localeCompare(b.discipline, undefined, { numeric: true })
    ));
}

function createDescription(lines) {
  return lines
    .map(line => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}

function createSiteDescription(row) {
  const location = [row.postalCode, row.city].filter(Boolean).join(" ");

  return createDescription([
    row.address,
    location
  ]);
}

function createPeriodDescription(row) {
  if (!row.startDate && !row.endDate) {
    return "";
  }

  return createDescription([
    [row.startDate, row.endDate].filter(Boolean).join(" - ")
  ]);
}

function createDisciplineDescription(row) {
  return createDescription([
    row.eventId ? `MYA event ID: ${row.eventId}` : "",
    row.disciplineId ? `MYA discipline ID: ${row.disciplineId}` : "",
    row.groupTime
  ]);
}

function createDisciplineFolderName(row) {
  return row.groupTime ? `${row.discipline} ${row.groupTime}` : row.discipline;
}

function uniqueRows(rows) {
  const seen = new Set();

  return rows.filter((row) => {
    const key = [row.company, row.site, row.period, createDisciplineFolderName(row)].map(normalizeName).join("\0");

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
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${apiPath}`);
  }

  return data;
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
  const disciplineKeys = new Set();

  rows.forEach((row) => {
    companyKeys.add(normalizeName(row.company));
    siteKeys.add([row.company, row.site].map(normalizeName).join("\0"));
    periodKeys.add([row.company, row.site, row.period].map(normalizeName).join("\0"));
    disciplineKeys.add([row.company, row.site, row.period, createDisciplineFolderName(row)].map(normalizeName).join("\0"));
  });

  console.log("Dry run only. No folders were created.");
  console.log(`Rows matched: ${rows.length}`);
  console.log(`Unique companies: ${companyKeys.size}`);
  console.log(`Unique sites: ${siteKeys.size}`);
  console.log(`Unique periods: ${periodKeys.size}`);
  console.log(`Unique discipline folders: ${disciplineKeys.size}`);
  console.log(`Duplicate input rows skipped: ${stats.duplicateInput}`);
  console.log(`Total folder paths to check/create: ${companyKeys.size + siteKeys.size + periodKeys.size + disciplineKeys.size}`);
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

    const period = await getOrCreateFolder(
      folders,
      row.period,
      site.id,
      createPeriodDescription(row)
    );

    await getOrCreateFolder(
      folders,
      createDisciplineFolderName(row),
      period.id,
      createDisciplineDescription(row)
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const rows = uniqueRows(loadRows(options.file, options.discipline));

  if (options.dryRun) {
    printDryRun(rows);
    return;
  }

  await importRows(rows);

  console.log(`Done. Rows matched: ${rows.length}. Created: ${stats.created}. Existing: ${stats.existing}. Duplicate input rows skipped: ${stats.duplicateInput}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
