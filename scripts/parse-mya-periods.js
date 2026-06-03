const fs = require("fs");
const path = require("path");

const API_BASE = "https://mya-sport.be/api/trpc";
const PRODUCT_TYPE_STAGES = "81";
const PAGE_SIZE = 100;
const DEFAULT_INPUT = "mya-periods.txt";

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

const FALLBACK_PERIOD_DATES = {
  "summer - week 0": ["2026-06-29", "2026-07-03"],
  "summer - week 1": ["2026-07-06", "2026-07-10"],
  "summer - week 2": ["2026-07-13", "2026-07-17"],
  "summer - week 3": ["2026-07-20", "2026-07-24"],
  "summer - week 4": ["2026-07-27", "2026-07-31"],
  "summer - week 5": ["2026-08-03", "2026-08-07"],
  "summer - week 6": ["2026-08-10", "2026-08-14"],
  "summer - week 7": ["2026-08-17", "2026-08-21"],
  "summer - week 8": ["2026-08-24", "2026-08-28"],
  "autumn - week 1": ["2026-10-19", "2026-10-23"],
  "autumn - week 2": ["2026-10-26", "2026-10-30"],
  "winter - week 1": ["2026-12-21", "2026-12-25"],
  "winter - week 2": ["2026-12-28", "2027-01-01"]
};

const FALLBACK_SITE_DETAILS = {
  "Koekelberg – Centre Sportif Victoria": {
    city: "Koekelberg",
    postalCode: "1081",
    address: "Rue Léon Autrique 4"
  },
  "Strombeek-Bever – Poneys Club Hof te Bever": {
    city: "Strombeek-Bever",
    postalCode: "1853",
    address: "Hof te Beverlaan 195"
  },
  "Uccle – Manège de la Cambre": {
    city: "Uccle",
    postalCode: "1180",
    address: "Chaussée de Waterloo 872"
  },
  "Uccle – Notre-Dame des Champs": {
    city: "Uccle",
    postalCode: "1180",
    address: "Rue Roberts Jones 24"
  },
  "Woluwe-Saint-Pierre – Sportcity/Crommelynck": {
    city: "Woluwe-Saint-Pierre",
    postalCode: "1150",
    address: "Avenue Salomé 2"
  }
};

function parseArgs(argv) {
  const args = {
    file: DEFAULT_INPUT,
    format: "json",
    out: "",
    company: "",
    keepPeriodNames: false,
    skipApi: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--file") {
      args.file = argv[index + 1] || args.file;
      index += 1;
    } else if (value === "--format") {
      args.format = argv[index + 1] || args.format;
      index += 1;
    } else if (value === "--out") {
      args.out = argv[index + 1] || "";
      index += 1;
    } else if (value === "--company") {
      args.company = argv[index + 1] || "";
      index += 1;
    } else if (value === "--keep-period-names") {
      args.keepPeriodNames = true;
    } else if (value === "--skip-api") {
      args.skipApi = true;
    } else if (value === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/parse-mya-periods.js [options]

Options:
  --file <path>          Plain text source. Default: mya-periods.txt
  --format json|csv      Output format. Default: json
  --out <path>           Write output to a file instead of stdout
  --company <text>       Keep only one company, e.g. "Actionsport"
  --keep-period-names    Keep period names exactly as written
  --skip-api             Do not fetch MYA API data; use fallback dates/details only
  --help                 Show this help
`);
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

function basePeriodKey(period) {
  return normalizeKey(String(period || "").split(/\s+-\s+Special lunch box/i)[0]);
}

function cleanLine(line) {
  return String(line || "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
}

function parseManualRows(text, options) {
  const rows = [];
  const seen = new Set();
  let company = "";

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

    if (options.company && !normalizeKey(company).includes(normalizeKey(options.company))) {
      continue;
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
      address: "",
      dataSource: "manual"
    });
  }

  return rows;
}

function trpcInput(input) {
  return encodeURIComponent(JSON.stringify({ 0: { json: input } }));
}

async function trpc(procedure, input) {
  const url = `${API_BASE}/${procedure}?batch=1&input=${trpcInput(input)}`;
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en",
      "Cookie": "NEXT_LOCALE=en",
      "x-trpc-source": "nextjs-react"
    }
  });

  if (!response.ok) {
    throw new Error(`${procedure} failed with ${response.status}`);
  }

  const payload = await response.json();
  const entry = Array.isArray(payload) ? payload[0] : payload;
  const data = entry?.result?.data?.json;

  if (!data) {
    throw new Error(`${procedure} returned an unexpected payload`);
  }

  return data;
}

async function getEventsPage(pageNumber) {
  return trpc("events.getAllEvents", {
    disciplineid: "",
    startdate: "",
    enddate: "",
    provinceid: "",
    siteid: "",
    age: "",
    producttypes: [PRODUCT_TYPE_STAGES],
    pagenumber: String(pageNumber),
    pagesize: String(PAGE_SIZE)
  });
}

async function getAllEvents() {
  const events = [];
  let pageNumber = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await getEventsPage(pageNumber);

    events.push(...(page.data || []));
    hasNextPage = Boolean(page.metaData?.hasNextPage);
    pageNumber += 1;
  }

  return events;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function createEnrichmentMaps(events) {
  const eventMap = new Map();
  const siteMap = new Map();
  const periodMap = new Map();

  for (const event of events) {
    const period = normalizePeriod(event.name);
    const eventDetails = {
      eventId: event.id || "",
      startDate: formatDate(event.startDate),
      endDate: formatDate(event.endDate),
      city: event.city || "",
      postalCode: event.postalCode || "",
      address: event.siteAddress || ""
    };

    eventMap.set([event.siteName, period].map(normalizeKey).join("\0"), eventDetails);

    if (!siteMap.has(normalizeKey(event.siteName))) {
      siteMap.set(normalizeKey(event.siteName), {
        city: event.city || "",
        postalCode: event.postalCode || "",
        address: event.siteAddress || ""
      });
    }

    const key = basePeriodKey(period);

    if (!periodMap.has(key)) {
      periodMap.set(key, {
        startDate: formatDate(event.startDate),
        endDate: formatDate(event.endDate)
      });
    }
  }

  return {
    eventMap,
    siteMap,
    periodMap
  };
}

function fallbackDates(period) {
  const dates = FALLBACK_PERIOD_DATES[basePeriodKey(period)];

  return dates ? {
    startDate: dates[0],
    endDate: dates[1]
  } : {
    startDate: "",
    endDate: ""
  };
}

function enrichRows(rows, maps) {
  return rows.map((row) => {
    const eventDetails = maps.eventMap.get([row.site, row.period].map(normalizeKey).join("\0")) || {};
    const siteDetails = maps.siteMap.get(normalizeKey(row.site)) || FALLBACK_SITE_DETAILS[row.site] || {};
    const periodDetails = maps.periodMap.get(basePeriodKey(row.period)) || fallbackDates(row.period);
    const enriched = {
      ...row,
      eventId: eventDetails.eventId || "",
      startDate: eventDetails.startDate || periodDetails.startDate || "",
      endDate: eventDetails.endDate || periodDetails.endDate || "",
      city: eventDetails.city || siteDetails.city || "",
      postalCode: eventDetails.postalCode || siteDetails.postalCode || "",
      address: eventDetails.address || siteDetails.address || "",
      dataSource: eventDetails.eventId ? "manual+mya" : "manual+fallback"
    };

    return enriched;
  }).sort((left, right) => (
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
        city: row.city,
        postalCode: row.postalCode,
        address: row.address,
        periods: []
      };
      siteMap.set(siteKey, site);
      company.sites.push(site);
    }

    site.periods.push({
      period: row.period,
      eventId: row.eventId,
      startDate: row.startDate,
      endDate: row.endDate
    });
  }

  return companies;
}

function toCsv(rows) {
  const headers = [
    "company",
    "site",
    "period",
    "eventId",
    "startDate",
    "endDate",
    "city",
    "postalCode",
    "address",
    "dataSource"
  ];
  const escape = (value) => {
    const text = String(value ?? "");

    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  };

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), options.file);
  const manualRows = parseManualRows(fs.readFileSync(inputPath, "utf8"), options);
  let maps = {
    eventMap: new Map(),
    siteMap: new Map(),
    periodMap: new Map()
  };

  if (!options.skipApi) {
    maps = createEnrichmentMaps(await getAllEvents());
  }

  const rows = enrichRows(manualRows, maps);
  const output = options.format === "csv"
    ? toCsv(rows)
    : JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: options.file,
      sources: [
        {
          type: "manual",
          file: options.file
        },
        {
          type: "mya-api",
          productTypeId: PRODUCT_TYPE_STAGES,
          skipped: options.skipApi
        }
      ],
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
