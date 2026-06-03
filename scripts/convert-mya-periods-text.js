const fs = require("fs");
const path = require("path");

const SEASONS = {
  ete: "Summer",
  été: "Summer",
  summer: "Summer",
  automne: "Autumn",
  autumn: "Autumn",
  hiver: "Winter",
  winter: "Winter",
  printemps: "Spring",
  spring: "Spring"
};

const SUFFIXES = {
  "special lunch box": "Special lunch box",
  "spécial lunch box": "Special lunch box"
};

function printHelp() {
  console.log(`Usage: npm run convert:mya-periods -- [options]

Options:
  --file <path>             Plain text file with Company: headers and "Site ; Period" rows
  --out <path>              Write JSON output to a file instead of stdout
  --default-company <name>  Company to use when the text has no Company: header
  --keep-period-names       Keep period names exactly as written
  --help                    Show this help

Examples:
  npm run convert:mya-periods -- --file mya-periods.txt --out mya-periods.json
  npm run convert:mya-periods -- --file promosport.txt --default-company Promosport --out mya-periods.json
`);
}

function parseArgs(argv) {
  const options = {
    file: "",
    out: "",
    defaultCompany: "",
    keepPeriodNames: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--file") {
      options.file = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--out") {
      options.out = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--default-company") {
      options.defaultCompany = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--keep-period-names") {
      options.keepPeriodNames = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return stripAccents(value).trim().toLowerCase();
}

function normalizePeriod(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const parts = text.split(/\s+-\s+/);
  const match = text.match(/^(.+?)\s*-\s*(?:semaine|week)\s*(\d+)(.*)$/i);

  if (!match) {
    return text;
  }

  const season = SEASONS[normalizeKey(match[1])] || match[1].trim();
  const week = Number(match[2]);
  const suffix = parts.slice(2).join(" - ").trim();
  const normalizedSuffix = SUFFIXES[normalizeKey(suffix)] || suffix;

  return [
    `${season} - Week ${week}`,
    normalizedSuffix
  ].filter(Boolean).join(" - ");
}

function cleanLine(line) {
  return String(line || "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
}

function parseText(text, options) {
  const rows = [];
  const seen = new Set();
  let company = options.defaultCompany || "";

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);

    if (!line) {
      continue;
    }

    const header = line.match(/^([A-Za-z][A-Za-z\s-]+):$/);

    if (header) {
      company = header[1].trim();
      continue;
    }

    if (!line.includes(";")) {
      continue;
    }

    const [siteText, ...periodParts] = line.split(";");
    const site = siteText.trim();
    const periodText = periodParts.join(";").trim();

    if (!company) {
      throw new Error(`Company is required before row: ${line}`);
    }

    if (!site || !periodText) {
      throw new Error(`Invalid row: ${line}`);
    }

    const period = options.keepPeriodNames ? periodText : normalizePeriod(periodText);
    const key = [company, site, period].map(normalizeKey).join("\0");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    rows.push({
      company,
      site,
      period,
      eventId: "",
      startDate: "",
      endDate: "",
      city: "",
      postalCode: "",
      address: ""
    });
  }

  return rows.sort((left, right) => (
    left.company.localeCompare(right.company) ||
    left.site.localeCompare(right.site) ||
    left.period.localeCompare(right.period, undefined, { numeric: true })
  ));
}

function buildTree(rows) {
  const companies = [];
  const companyMap = new Map();
  const siteMap = new Map();

  for (const row of rows) {
    let company = companyMap.get(row.company);

    if (!company) {
      company = {
        company: row.company,
        sites: []
      };
      companyMap.set(row.company, company);
      companies.push(company);
    }

    const siteKey = `${row.company}\0${row.site}`;
    let site = siteMap.get(siteKey);

    if (!site) {
      site = {
        site: row.site,
        city: "",
        postalCode: "",
        address: "",
        periods: []
      };
      siteMap.set(siteKey, site);
      company.sites.push(site);
    }

    site.periods.push({
      period: row.period,
      eventId: "",
      startDate: "",
      endDate: ""
    });
  }

  return companies;
}

async function readInput(filePath) {
  if (filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
  }

  return await new Promise((resolve, reject) => {
    let text = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const text = await readInput(options.file);
  const rows = parseText(text, options);
  const output = JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: options.file || "stdin",
    totalEvents: rows.length,
    totalRows: rows.length,
    rows,
    companies: buildTree(rows)
  }, null, 2);

  if (options.out) {
    fs.writeFileSync(options.out, output);
    console.error(`Wrote ${rows.length} rows to ${options.out}`);
    return;
  }

  console.log(output);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
