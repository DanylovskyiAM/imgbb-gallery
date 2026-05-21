const API_BASE = process.env.API_BASE || "http://127.0.0.1:3000";

const rootFolders = [
  "Auderghem – Sports Centre",
  "Auderghem – Lutgardiscollege",
  "Auderghem – Lutgardiscollege",
  "Bierges – Le Verseau",
  "Braine-l'Alleud – Cardinal Mercier",
  "Éghezée – Abbé Noël",
  "Embourg – Sartay",
  "Gembloux – Chapelle-Dieu",
  "Grez-Doiceau – Centre sportif",
  "Hamme-Mille – Ecole autonome",
  "Jambes – Athenée",
  "Les Bons Villers – Aquacenter",
  "Liège – Sainte-Véronique",
  "Louvain-la-Neuve – Biéreau/Martin V",
  "Nalinnes – Aquacenter",
  "Nivelles – Sotriamont",
  "Perwez – Jean Paul II",
  "Profondeville – La Hulle",
  "Waterloo – Sacrés-Cœurs Le Clos",
  "Woluwe-Saint-Lambert – Lindthout",
  "Woluwe-Saint-Lambert – Sports Hall"
];

const weekFolders = [
  "Summer - Week 1",
  "Summer - Week 2",
  "Summer - Week 3",
  "Summer - Week 4",
  "Summer - Week 5",
  "Summer - Week 6",
  "Summer - Week 7"
];

const activityFolders = [
  "Mixed games",
  "Psycho Discovery",
  "Dance",
  "Nature",
  "Cycling",
  "Indiana",
  "Soccer"
];

const stats = {
  created: 0,
  existing: 0,
  duplicateInput: 0
};

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function uniqueNames(names) {
  const seen = new Set();

  return names.filter((name) => {
    const key = normalizeName(name);

    if (seen.has(key)) {
      stats.duplicateInput += 1;
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${path}`);
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

async function getOrCreateFolder(folders, name, parentId = null) {
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
      description: ""
    })
  });

  folders.push(data.folder);
  stats.created += 1;

  return data.folder;
}

async function main() {
  const folders = await loadFolders();

  for (const rootName of uniqueNames(rootFolders)) {
    const root = await getOrCreateFolder(folders, rootName);

    for (const weekName of weekFolders) {
      const week = await getOrCreateFolder(folders, weekName, root.id);

      for (const activityName of activityFolders) {
        await getOrCreateFolder(folders, activityName, week.id);
      }
    }
  }

  console.log(`Done. Created: ${stats.created}. Existing: ${stats.existing}. Duplicate input skipped: ${stats.duplicateInput}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
