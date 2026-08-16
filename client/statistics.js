const searchInput = document.getElementById("statisticsSearch");
const locationFilter = document.getElementById("statisticsLocationFilter");
const companyFilter = document.getElementById("statisticsCompanyFilter");
const statusFilter = document.getElementById("statisticsStatusFilter");
const sortSelect = document.getElementById("statisticsSort");
const summary = document.getElementById("statisticsSummary");
const tableBody = document.getElementById("statisticsTableBody");
const completionSummary = document.getElementById("completionSummary");
const completionTableHead = document.getElementById("completionTableHead");
const completionTableBody = document.getElementById("completionTableBody");

let rows = [];
let completionRows = [];

function getVisibleCount(row) {
  if (statusFilter.value === "approved") return row.approved;
  if (statusFilter.value === "pending") return row.pending;
  return row.total;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function getTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function renderStatistics() {
  const query = searchInput.value.trim().toLowerCase();
  const location = locationFilter.value;
  const company = companyFilter.value;
  const [sortKey, direction] = sortSelect.value.split("-");
  const multiplier = direction === "asc" ? 1 : -1;
  const filteredRows = rows
    .filter(row => !location || row.location === location)
    .filter(row => !company || row.company === company)
    .filter(row => getVisibleCount(row) > 0)
    .filter(row => !query || `${row.company} ${row.location} ${row.period}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftValue = sortKey === "uploadedAt"
        ? getTimestamp(left.uploadedAt)
        : (sortKey === "completion" ? `${left.company} ${left.location}` : left[sortKey]);
      const rightValue = sortKey === "uploadedAt"
        ? getTimestamp(right.uploadedAt)
        : (sortKey === "completion" ? `${right.company} ${right.location}` : right[sortKey]);
      return typeof leftValue === "string"
        ? multiplier * leftValue.localeCompare(rightValue)
        : multiplier * (leftValue - rightValue);
    });
  const fileCount = filteredRows.reduce((total, row) => total + getVisibleCount(row), 0);

  summary.textContent = `${filteredRows.length} ${filteredRows.length === 1 ? "period" : "periods"} · ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  tableBody.innerHTML = "";

  if (!filteredRows.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="statistics-empty">No matching upload statistics.</td></tr>';
  } else {
    filteredRows.forEach(row => {
      const tr = document.createElement("tr");
      [row.company, row.location, row.period, row.total, row.approved, row.pending, formatDate(row.uploadedAt)].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        tr.appendChild(cell);
      });
      tableBody.appendChild(tr);
    });
  }

  renderCompletionMatrix();
}

function isLateUpload(row) {
  if (!row.firstUploadedAt || !row.startDate) return false;

  const deadline = new Date(`${row.startDate}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 7);
  return new Date(row.firstUploadedAt) > deadline;
}

function getCompletionMetrics(locationRow, periods, today) {
  let applicablePeriods = 0;
  let uploadedPeriods = 0;
  let hasLateUpload = false;

  periods.forEach(period => {
    // Keep upcoming periods visible in the matrix, but do not count them yet.
    if (period.startDate && period.startDate > today) return;

    const row = locationRow.periods.get(period.key);

    if (!row) return;

    applicablePeriods += 1;
    if (row.total > 0) {
      uploadedPeriods += 1;
      hasLateUpload ||= isLateUpload(row);
    }
  });

  return {
    percent: applicablePeriods ? Math.round((uploadedPeriods / applicablePeriods) * 100) : 0,
    hasLateUpload
  };
}

function renderCompletionMatrix() {
  const query = searchInput.value.trim().toLowerCase();
  const location = locationFilter.value;
  const company = companyFilter.value;
  const today = new Date().toISOString().slice(0, 10);
  const filteredCompletionRows = completionRows
    .filter(row => !location || row.location === location)
    .filter(row => !company || row.company === company)
    .filter(row => !query || `${row.company} ${row.location}`.toLowerCase().includes(query));
  const periods = [...new Map(filteredCompletionRows.map(row => [
    `${row.startDate}|${row.period}`,
    { key: `${row.startDate}|${row.period}`, name: row.period, startDate: row.startDate }
  ])).values()].sort((a, b) => (
    (a.startDate || "9999-12-31").localeCompare(b.startDate || "9999-12-31") || a.name.localeCompare(b.name)
  ));
  const locations = new Map();

  filteredCompletionRows
    .forEach(row => {
      const key = `${row.company}\u0000${row.location}`;
      const item = locations.get(key) || { company: row.company, location: row.location, periods: new Map() };
      item.periods.set(`${row.startDate}|${row.period}`, row);
      locations.set(key, item);
    });

  completionTableHead.innerHTML = "";
  const headRow = document.createElement("tr");
  ["Location", "Percent", ...periods.map(period => period.name)].forEach(label => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headRow.appendChild(cell);
  });
  completionTableHead.appendChild(headRow);
  completionTableBody.innerHTML = "";

  const locationRows = [...locations.values()].sort((a, b) => {
    if (sortSelect.value === "completion-desc") {
      const difference = getCompletionMetrics(b, periods, today).percent - getCompletionMetrics(a, periods, today).percent;
      if (difference) return difference;
    }

    return `${a.company} ${a.location}`.localeCompare(`${b.company} ${b.location}`);
  });
  completionSummary.textContent = `${locationRows.length} ${locationRows.length === 1 ? "location" : "locations"}`;

  if (!locationRows.length) {
    completionTableBody.innerHTML = `<tr><td colspan="${periods.length + 2}" class="statistics-empty">No matching locations.</td></tr>`;
    return;
  }

  locationRows.forEach(locationRow => {
    const tr = document.createElement("tr");
    const locationCell = document.createElement("td");
    locationCell.textContent = locationRow.company === "—"
      ? locationRow.location
      : `${locationRow.company} · ${locationRow.location}`;
    tr.appendChild(locationCell);

    const metrics = getCompletionMetrics(locationRow, periods, today);
    const percentCell = document.createElement("td");
    percentCell.textContent = `${metrics.percent}%`;
    percentCell.className = metrics.percent === 100
      ? (metrics.hasLateUpload ? "completion-late" : "completion-on-time")
      : "completion-missing";
    tr.appendChild(percentCell);

    periods.forEach(period => {
      const cell = document.createElement("td");
      const row = locationRow.periods.get(period.key);

      if (row) {
        cell.textContent = row.total;
        if (row.total === 0 && period.startDate && period.startDate > today) {
          cell.className = "completion-future";
        } else if (row.total === 0) {
          cell.className = "completion-missing";
        } else if (isLateUpload(row)) {
          cell.className = "completion-late";
        } else {
          cell.className = "completion-on-time";
        }
      }

      tr.appendChild(cell);
    });
    completionTableBody.appendChild(tr);
  });
}

async function loadStatistics() {
  summary.textContent = "Loading statistics…";

  try {
    const response = await fetch("/api/statistics");
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Failed to load statistics.");

    rows = data.rows || [];
    completionRows = data.completionRows || [];
    [...new Set([...rows, ...completionRows].map(row => row.location).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .forEach(location => locationFilter.append(new Option(location, location)));
    [...new Set([...rows, ...completionRows].map(row => row.company).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .forEach(company => companyFilter.append(new Option(company, company)));
    renderStatistics();
  } catch (err) {
    summary.textContent = err.message || "Failed to load statistics.";
  }
}

[searchInput, locationFilter, companyFilter, statusFilter, sortSelect].forEach(input => {
  input.addEventListener("input", renderStatistics);
  input.addEventListener("change", renderStatistics);
});

loadStatistics();
