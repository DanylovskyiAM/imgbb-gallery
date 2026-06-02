const fs = require("fs");

const API_BASE = "https://mya-sport.be/api/trpc";
const PRODUCT_TYPE_STAGES = "81";
const PAGE_SIZE = 100;
const GROUP_PAGE_SIZE = 100;
const DETAIL_CONCURRENCY = 8;
const SOURCES = [
  {
    company: "Promosport",
    base: "pr1",
    productTypeId: PRODUCT_TYPE_STAGES,
    sourceUrl: "https://mya-sport.be/en/pr1/home?category=stages+%28holiday+camps%29&disciplineCard=true&page=1",
    filters: {}
  },
  {
    company: "Actionsport",
    base: "pr2",
    productTypeId: PRODUCT_TYPE_STAGES,
    sourceUrl: "https://mya-sport.be/en/pr2/home?category=stages+%28holiday+camps%29&disciplineCard=true&page=1",
    filters: {}
  }
];

const DISCIPLINE_NAMES = {
  "anglais (avec cll)": "English (with CLL)",
  "artiste": "Artist",
  "arts martiaux": "Martial arts",
  "athletisme": "Athletics",
  "athlétisme": "Athletics",
  "aventure 100% (toute la journee)": "Adventure 100% (Full day)",
  "aventure 100% (toute la journée)": "Adventure 100% (Full day)",
  "aventure 100% toute la journee": "Adventure 100% Full day",
  "aventure 100% toute la journée": "Adventure 100% Full day",
  "aventure 100%": "Adventure 100%",
  "basket": "Basketball",
  "cirque": "Circus",
  "cirque stromboli 100% (toute la journee)": "Stromboli Circus 100% (Full day)",
  "cirque stromboli 100% (toute la journée)": "Stromboli Circus 100% (Full day)",
  "comedie musicale": "Musical theater",
  "comédie musicale": "Musical theater",
  "cuisine (top chef)": "Cooking (Top Chef)",
  "cuisine top chef": "Cooking Top Chef",
  "danse - commercial": "Dance - Commercial",
  "danse - hip hop/urban dance": "Dance - Hip Hop/Urban Dance",
  "danse : classico-jazz": "Dance: Classico-Jazz",
  "danse fusion": "Dance Fusion",
  "equitation / poney": "Horse riding / Pony",
  "équitation / poney": "Horse riding / Pony",
  "escalade": "Climbing",
  "escrime": "Fencing",
  "evasion 100% (toute la journee)": "Escape 100% (Full day)",
  "evasion 100% (toute la journée)": "Escape 100% (Full day)",
  "football (en salle)": "Indoor soccer",
  "football 100% (toute la journee)": "Soccer 100% (Full day)",
  "football 100% (toute la journée)": "Soccer 100% (Full day)",
  "geo cachette": "Geocaching",
  "géo cachette": "Geocaching",
  "gymnastique": "Gymnastics",
  "gymnastique sportive": "Sport gymnastics",
  "gymnastique sportive 100% (toute la journee)": "Sport gymnastics 100% (Full day)",
  "gymnastique sportive 100% (toute la journée)": "Sport gymnastics 100% (Full day)",
  "hockey (en salle)": "Indoor hockey",
  "ia et esprit critique - createur du futur": "AI and critical thinking - creator of the future",
  "ia et esprit critique - créateur du futur": "AI and critical thinking - creator of the future",
  "langues (anglais avec kids&us)": "Languages (English with Kids&Us)",
  "lunch box (forfait pour la semaine)": "Lunch Box (weekly package)",
  "mix games": "Mixed games",
  "moto electrique": "Electric motorbike",
  "moto électrique": "Electric motorbike",
  "musique": "Music",
  "natation collective": "Collective swimming",
  "plongee": "Diving",
  "plongée": "Diving",
  "pompier secourisme": "Firefighter first aid",
  "programmation logiscool : junior explorer": "Logiscool programming: Junior Explorer",
  "programmation logiscool : junior explorer avec wedo": "Logiscool programming: Junior Explorer with WeDo",
  "programmation logiscool : lego spike adventure p1-p3": "Logiscool programming: Lego Spike Adventure P1-P3",
  "programmation logiscool : lego spike p1-p3": "Logiscool programming: Lego Spike P1-P3",
  "programmation logiscool : lego wedo espace p1-p3": "Logiscool programming: Lego WeDo Space P1-P3",
  "programmation logiscool : lego wedo futur p1-p3": "Logiscool programming: Lego WeDo Future P1-P3",
  "programmation logiscool : minecraft maze master": "Logiscool programming: Minecraft Maze Master",
  "programmation logiscool : minecraft mission mars": "Logiscool programming: Minecraft Mars Mission",
  "programmation logiscool : minecraft ville des heros": "Logiscool programming: Minecraft City of Heroes",
  "programmation logiscool : minecraft ville des héros": "Logiscool programming: Minecraft City of Heroes",
  "psycho decouverte": "Psycho Discovery",
  "psycho découverte": "Psycho Discovery",
  "psycho sport": "Psycho Sport",
  "sciences - cap sciences - agent secret": "Science - Cap Sciences - Secret Agent",
  "sciences - cap sciences": "Science - Cap Sciences",
  "sciences - cap sciences - graines de genie": "Science - Cap Sciences - Seeds of Genius",
  "sciences - cap sciences - graines de génie": "Science - Cap Sciences - Seeds of Genius",
  "sciences (cap sciences) - agent secret": "Science (Cap Sciences) - Secret Agent",
  "sciences (cap sciences) - graines de genie": "Science (Cap Sciences) - Seeds of Genius",
  "sciences (cap sciences) - graines de génie": "Science (Cap Sciences) - Seeds of Genius",
  "sciences (cap sciences) - le magicien des sciences": "Science (Cap Sciences) - The Science Magician",
  "sciences (cap sciences) - les arsouilles du labo": "Science (Cap Sciences) - Lab Rascals",
  "sciences (cap sciences) - les p'tits curieux": "Science (Cap Sciences) - Little Curious Ones",
  "sciences (cap sciences) - les p'tits inventeurs": "Science (Cap Sciences) - Little Inventors",
  "sciences (cap sciences) - mini decouvreurs": "Science (Cap Sciences) - Mini Discoverers",
  "sciences (cap sciences) - mini découvreurs": "Science (Cap Sciences) - Mini Discoverers",
  "sciences (cap sciences) - mini explorateurs": "Science (Cap Sciences) - Mini Explorers",
  "sciences (cap sciences) - mini savants": "Science (Cap Sciences) - Mini Scientists",
  "sciences (cap sciences) - savants fous": "Science (Cap Sciences) - Mad Scientists",
  "sports raquettes": "Racket sports",
  "sports roulettes (freeride)": "Wheeled sports (Freeride)",
  "strass et paillettes": "Rhinestones and glitter",
  danse: "Dance",
  nature: "Nature",
  indiana: "Indiana",
  "theatre": "Theater",
  "théâtre": "Theater",
  velo: "Cycling",
  vélo: "Cycling",
  "video/cinema": "Video/Cinema",
  "vidéo/cinéma": "Video/Cinema",
  roller: "Roller skating",
  "vtt 100% (toute la journee)": "Mountain biking 100% (Full day)",
  "vtt 100% (toute la journée)": "Mountain biking 100% (Full day)",
  football: "Soccer",
  soccer: "Soccer"
};

const SEASONS = {
  ete: "Summer",
  été: "Summer",
  summer: "Summer",
  printemps: "Spring",
  spring: "Spring",
  automne: "Autumn",
  autumn: "Autumn",
  hiver: "Winter",
  winter: "Winter"
};

function parseArgs(argv) {
  const args = {
    format: "json",
    out: "",
    discipline: "",
    includeRaw: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--format") {
      args.format = argv[index + 1] || args.format;
      index += 1;
    } else if (value === "--out") {
      args.out = argv[index + 1] || "";
      index += 1;
    } else if (value === "--discipline") {
      args.discipline = argv[index + 1] || "";
      index += 1;
    } else if (value === "--include-raw") {
      args.includeRaw = true;
    } else if (value === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/parse-mya-stages.js [options]

Options:
  --format json|csv       Output format. Default: json
  --out <path>            Write output to a file instead of stdout
  --discipline <text>     Keep only matching disciplines, e.g. "Mixed games"
  --include-raw           Include raw MYA event/detail objects in JSON output
  --help                  Show this help
`);
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

async function getEventsPage(source, pageNumber) {
  const filters = source.filters || {};

  return trpc("events.getAllEvents", {
    disciplineid: filters.disciplineid || "",
    startdate: "",
    enddate: "",
    provinceid: filters.provinceid || "",
    siteid: filters.siteid || "",
    age: "",
    producttypes: [String(source.productTypeId || PRODUCT_TYPE_STAGES)],
    pagenumber: String(pageNumber),
    pagesize: String(PAGE_SIZE)
  });
}

async function getEventById(id) {
  const result = await trpc("events.getEventById", { id });

  return result.data;
}

async function getEventGroupsPage(eventId, pageNumber, productTypeId = PRODUCT_TYPE_STAGES) {
  return trpc("events.getEventByGroupMemberId", {
    id: Number(eventId),
    memberid: 0,
    pageSize: GROUP_PAGE_SIZE,
    pageNumber,
    producttypeid: Number(productTypeId)
  });
}

async function getEventGroupsById(eventId, productTypeId = PRODUCT_TYPE_STAGES) {
  const groups = [];
  let pageNumber = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await getEventGroupsPage(eventId, pageNumber, productTypeId);

    groups.push(...(page.data || []));
    hasNextPage = Boolean(page.metaData?.hasNextPage);
    pageNumber += 1;
  }

  return groups;
}

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return stripAccents(value).trim().toLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function parsePeriod(name) {
  const text = String(name || "").trim();
  const match = text.match(/^(.+?)\s*-\s*(?:semaine|week)\s*(\d+)/i);

  if (!match) {
    return text;
  }

  const season = SEASONS[normalizeKey(match[1])] || titleCase(match[1]);

  return `${season} - Week ${Number(match[2])}`;
}

function decodeMaybe(value) {
  if (!value || value === "null") {
    return "";
  }

  let decoded = String(value);

  for (let count = 0; count < 2; count += 1) {
    try {
      const next = decodeURIComponent(decoded.replace(/\+/g, "%20"));

      if (next === decoded) {
        break;
      }

      decoded = next;
    } catch (err) {
      break;
    }
  }

  return decoded;
}

function stripHtml(value) {
  return decodeMaybe(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAgeRange(item) {
  if (item.minAge || item.maxAge) {
    return {
      minAge: item.minAge || null,
      maxAge: item.maxAge || null
    };
  }

  const description = stripHtml(item.productDescription || item.description);
  const match = description.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:ans|years)/i);

  return {
    minAge: match ? Number(match[1]) : null,
    maxAge: match ? Number(match[2]) : null
  };
}

function normalizeDisciplineName(item) {
  const rawName = item.discipline || item.name || item.title || "";
  const translated = DISCIPLINE_NAMES[normalizeKey(rawName)] || rawName;
  const { minAge, maxAge } = extractAgeRange(item);

  if (minAge && maxAge) {
    return `${translated} (${minAge} - ${maxAge} years)`;
  }

  return translated;
}

function explicitGroupTime(discipline) {
  const start = discipline.startTime || discipline.startHour || discipline.beginTime || discipline.fromTime;
  const end = discipline.endTime || discipline.endHour || discipline.toTime;

  if (!start || !end) {
    return "";
  }

  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2})[:h](\d{2})/i);

  if (!match) {
    return text;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function extractGroupTime(discipline) {
  const firstSession = discipline.sessionDates?.[0];

  if (firstSession?.startTime && firstSession?.endTime) {
    return `${formatTime(firstSession.startTime)} - ${formatTime(firstSession.endTime)}`;
  }

  const explicit = explicitGroupTime(discipline);

  if (explicit) {
    return explicit;
  }

  return "";
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function firstSessionDate(group) {
  return group.sessionDates?.[0]?.startDate || group.sessionDates?.[0]?.endDate || "";
}

function lastSessionDate(group) {
  const sessions = group.sessionDates || [];
  const lastSession = sessions[sessions.length - 1];

  return lastSession?.endDate || lastSession?.startDate || "";
}

function buildRows(eventItems, details, groupsByEvent, options) {
  const rows = [];
  const wanted = normalizeKey(options.discipline);

  for (let eventIndex = 0; eventIndex < eventItems.length; eventIndex += 1) {
    const { event, source } = eventItems[eventIndex];
    const detail = details.get(event.id);
    const groups = groupsByEvent.get(event.id) || [];

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const disciplineName = normalizeDisciplineName(group);

      if (wanted && !normalizeKey(disciplineName).includes(wanted)) {
        continue;
      }

      const row = {
        company: source.company,
        site: detail?.siteName || event.siteName,
        period: parsePeriod(detail?.name || event.name),
        discipline: disciplineName,
        groupTime: extractGroupTime(group),
        eventId: event.id,
        groupId: group.id,
        disciplineId: group.disciplineId,
        startDate: formatDate(firstSessionDate(group) || detail?.startDate || event.startDate),
        endDate: formatDate(lastSessionDate(group) || detail?.endDate || event.endDate),
        city: detail?.siteCity || event.city,
        postalCode: detail?.postalCode || event.postalCode,
        address: detail?.siteAddress || event.siteAddress,
        price: group.price ?? "",
        _sortOrder: (eventIndex * 1000) + groupIndex
      };

      if (options.includeRaw) {
        row.rawSource = source;
        row.rawEvent = event;
        row.rawDetail = detail;
        row.rawGroup = group;
      }

      rows.push(row);
    }
  }

  return rows.sort((left, right) => (
    left.company.localeCompare(right.company) ||
    left.site.localeCompare(right.site) ||
    left.period.localeCompare(right.period, undefined, { numeric: true }) ||
    left._sortOrder - right._sortOrder
  )).map(({ _sortOrder, ...row }) => row);
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

    let period = site.periods.find((item) => item.period === row.period);

    if (!period) {
      period = {
        period: row.period,
        startDate: row.startDate,
        endDate: row.endDate,
        disciplines: []
      };
      site.periods.push(period);
    }

    if (!period.disciplines.some((item) => (
      item.discipline === row.discipline &&
      item.groupTime === row.groupTime &&
      item.groupId === row.groupId
    ))) {
        period.disciplines.push({
          discipline: row.discipline,
          groupTime: row.groupTime,
          eventId: row.eventId,
          groupId: row.groupId,
          disciplineId: row.disciplineId
        });
    }
  }

  return companies;
}

function toCsv(rows) {
  const headers = [
    "company",
    "site",
    "period",
    "discipline",
    "groupTime",
    "eventId",
    "groupId",
    "disciplineId",
    "startDate",
    "endDate",
    "city",
    "postalCode",
    "address",
    "price"
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

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

async function getEventsForSource(source) {
  const events = [];
  let pageNumber = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await getEventsPage(source, pageNumber);

    events.push(...(page.data || []));
    hasNextPage = Boolean(page.metaData?.hasNextPage);
    pageNumber += 1;
  }

  return events.map((event) => ({ event, source }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceEventItems = [];

  for (const source of SOURCES) {
    sourceEventItems.push(...await getEventsForSource(source));
  }

  const eventAssignments = new Map();

  for (const item of sourceEventItems) {
    eventAssignments.set(`${item.source.company}\0${item.event.id}`, item);
  }

  const eventItems = Array.from(eventAssignments.values());

  const detailItems = await mapLimit(eventItems, DETAIL_CONCURRENCY, async ({ event, source }) => {
    const [detail, groups] = await Promise.all([
      getEventById(event.id),
      getEventGroupsById(event.id, source.productTypeId)
    ]);

    return {
      eventId: event.id,
      detail,
      groups
    };
  });
  const details = new Map(detailItems.map((item) => [item.eventId, item.detail]));
  const groupsByEvent = new Map(detailItems.map((item) => [item.eventId, item.groups]));

  const rows = buildRows(eventItems, details, groupsByEvent, options);
  const output = options.format === "csv"
    ? toCsv(rows)
    : JSON.stringify({
      generatedAt: new Date().toISOString(),
      sources: SOURCES.map((source) => ({
        company: source.company,
        base: source.base,
        url: source.sourceUrl
      })),
      totalEvents: eventItems.length,
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
