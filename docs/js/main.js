// ═══════════════════════════════════════════════════════════════════════════
// EFW COMPLEXITY PORTAL — frontend logic
// ═══════════════════════════════════════════════════════════════════════════

// Paper's palette: Rule of Law in reds, Trade/Regulation in blues, Other grey
const CLUSTER_COLORS = {
  "1A": "#7B0000",   // dark maroon — Rule of Law core
  "1B": "#FF1744",   // vivid red   — Openness & Security
  "2A": "#002171",   // dark navy   — Regulation & Trade barriers
  "2B": "#448AFF",   // vivid blue  — Monetary system
  "3":  "#9E9E9E",   // grey        — Residual
};
// Pastel halo around each node — same hue, lighter shade (matches paper figure)
const CLUSTER_HALO = {
  "1A": "#FFCDD2",
  "1B": "#FFEBEE",
  "2A": "#BBDEFB",
  "2B": "#E3F2FD",
  "3":  "#F0F0F0",
};
// Macro-cluster grouping for edge colouring: 1A/1B = Rule of Law, 2A/2B = Trade
const CLUSTER_MACRO = {"1A":"R", "1B":"R", "2A":"T", "2B":"T", "3":"O"};
const MACRO_EDGE_COLOR = {"R": "#7B0000", "T": "#002171", "O": "#BBBBBB"};
const CLUSTER_NAMES = {
  "1A": "Rule of Law — core",
  "1B": "Openness & Security",
  "2A": "Regulation & Trade Barriers",
  "2B": "Monetary System",
  "3":  "Residual (fiscal + labor)",
};

const DATA = {};   // populated by loadAll()

// ─── data loading ──────────────────────────────────────────────────────────
async function loadAll() {
  const files = ["meta", "indicators", "countries", "proximity",
                 "density", "specialization", "thresholds", "raw_scores"];
  await Promise.all(files.map(async name => {
    const r = await fetch(`data/${name}.json`);
    DATA[name] = await r.json();
  }));

  // index country list by code for O(1) lookup
  DATA.byCode = Object.fromEntries(DATA.countries.map(c => [c.code, c]));
  DATA.byInd  = Object.fromEntries(DATA.indicators.map(i => [i.ind, i]));
}

// ─── tab navigation ────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const tabId = link.dataset.tab;
      document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.tab === tabId));
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === tabId));
      // lazy-render plots when their tab becomes active
      if (tabId === "space") renderIndicatorSpace();
      if (tabId === "map")   renderWorldMap();
      window.scrollTo({top: 0, behavior: "smooth"});
    });
  });
}

// ─── Home stats ─────────────────────────────────────────────────────────────
function renderHome() {
  document.getElementById("stat-countries").textContent  = DATA.meta.n_countries;
  document.getElementById("stat-indicators").textContent = DATA.meta.n_indicators;
  document.getElementById("stat-specs").textContent      = DATA.meta.total_specializations.toLocaleString("en-US").replace(/,/g, " ");
  document.getElementById("stat-density").textContent    = DATA.meta.density_pct + "%";
}

// ─── ICI Hierarchy table ───────────────────────────────────────────────────
function renderICITable() {
  const container = document.getElementById("ici-table");
  const clusterFilter = document.getElementById("ici-cluster-filter").value;
  const sortBy = document.getElementById("ici-sort").value;

  let rows = DATA.indicators.slice();
  if (clusterFilter) rows = rows.filter(r => r.cluster === clusterFilter);

  if (sortBy === "ICI_asc") rows.sort((a, b) => a.ICI - b.ICI);
  else if (sortBy === "ubiquity") rows.sort((a, b) => a.ubiquity - b.ubiquity);
  else if (sortBy === "cluster") rows.sort((a, b) => a.cluster.localeCompare(b.cluster) || b.ICI - a.ICI);
  else rows.sort((a, b) => b.ICI - a.ICI);

  const maxICI = Math.max(...DATA.indicators.map(r => r.ICI));
  const html = `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Code</th>
          <th>Indicator</th>
          <th>Cluster</th>
          <th class="num">ICI</th>
          <th class="num">Ubiquity</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.rank}</td>
            <td><strong>${r.title.split(" ")[0]}</strong></td>
            <td>${r.title.split(" ").slice(1).join(" ")}</td>
            <td><span class="cluster-badge cluster-${r.cluster}">${r.cluster}</span></td>
            <td class="num bar-cell" style="position:relative;">
              <div class="bar" style="width:${(r.ICI / maxICI) * 60}px;"></div>
              <span class="bar-value">${r.ICI.toFixed(2)}</span>
            </td>
            <td class="num">${r.ubiquity}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  container.innerHTML = html;
}

function setupICI() {
  renderICITable();
  document.getElementById("ici-cluster-filter").addEventListener("change", renderICITable);
  document.getElementById("ici-sort").addEventListener("change", renderICITable);
}

// ─── Indicator Space (Plotly network, layout precomputed in build_portal.py) ─
function renderIndicatorSpace() {
  const country = document.getElementById("space-country-select").value;
  const showNames = document.getElementById("space-show-names")?.checked;
  const inds = DATA.indicators;
  const pos = DATA.proximity.positions;
  const indToCluster = Object.fromEntries(inds.map(d => [d.ind, d.cluster]));

  // ── Edge layers ─────────────────────────────────────────────────────────
  // P90 extras: faint grey background
  // MST same-macro:   coloured by macro cluster (dark red for Rule of Law,
  //                    dark navy for Trade & Business)
  // MST cross-macro:  neutral grey
  const p90X = [], p90Y = [];
  const edgesByGroup = {R: [], T: [], cross: []};   // R = Rule of Law, T = Trade
  DATA.proximity.edges.forEach(e => {
    const a = pos[e.source], b = pos[e.target];
    if (!a || !b) return;
    if (e.kind === "p90") {
      p90X.push(a[0], b[0], null); p90Y.push(a[1], b[1], null);
      return;
    }
    const ma = CLUSTER_MACRO[indToCluster[e.source]];
    const mb = CLUSTER_MACRO[indToCluster[e.target]];
    if (ma === mb && (ma === "R" || ma === "T")) edgesByGroup[ma].push([a, b, e.phi]);
    else edgesByGroup.cross.push([a, b, e.phi]);
  });

  const edgeP90 = {
    x: p90X, y: p90Y, mode: "lines", type: "scatter",
    line: {width: 0.5, color: "rgba(170,170,170,0.30)"},
    hoverinfo: "none", showlegend: false,
  };
  const mstTraces = [];
  ["R", "T", "cross"].forEach(grp => {
    const xs = [], ys = [];
    edgesByGroup[grp].forEach(([a, b]) => {
      xs.push(a[0], b[0], null); ys.push(a[1], b[1], null);
    });
    if (!xs.length) return;
    mstTraces.push({
      x: xs, y: ys, mode: "lines", type: "scatter",
      line: {
        width: grp === "cross" ? 1.0 : 1.6,
        color: grp === "cross" ? "rgba(160,160,160,0.55)"
                               : MACRO_EDGE_COLOR[grp] + "AA",
      },
      hoverinfo: "none", showlegend: false,
    });
  });

  // ── Nodes ──────────────────────────────────────────────────────────────
  const clusterOrder = ["1A", "1B", "2A", "2B", "3"];
  const specs = country
    ? new Set(DATA.specialization[country]
                ? Object.entries(DATA.specialization[country])
                    .filter(([, v]) => v === 1).map(([k]) => k)
                : [])
    : null;

  const minICI = Math.min(...inds.map(d => d.ICI));
  const maxICI = Math.max(...inds.map(d => d.ICI));
  const sizeFor = ici => 14 + ((ici - minICI) / (maxICI - minICI)) * 34;

  // First: a halo layer (larger, pastel) — drawn for every cluster as one trace
  const haloTrace = {
    x: inds.map(d => pos[d.ind][0]),
    y: inds.map(d => pos[d.ind][1]),
    mode: "markers", type: "scatter",
    marker: {
      size: inds.map(d => sizeFor(d.ICI) * 1.45),
      color: inds.map(d =>
        !specs ? CLUSTER_HALO[d.cluster]
               : specs.has(d.ind) ? CLUSTER_HALO[d.cluster] : "rgba(220,220,220,0.35)"),
      line: {width: 0},
    },
    hoverinfo: "skip", showlegend: false,
  };

  const traces = [edgeP90, ...mstTraces, haloTrace];

  clusterOrder.forEach(cl => {
    const items = inds.filter(d => d.cluster === cl);
    if (!items.length) return;
    traces.push({
      x: items.map(d => pos[d.ind][0]),
      y: items.map(d => pos[d.ind][1]),
      mode: "markers+text",
      type: "scatter",
      text: items.map(d => d.title.split(" ")[0]),
      textposition: "middle center",
      textfont: {size: 9, color: "white", family: "Inter"},
      marker: {
        size: items.map(d => sizeFor(d.ICI)),
        color: items.map(d =>
          !specs ? CLUSTER_COLORS[cl] :
          specs.has(d.ind) ? CLUSTER_COLORS[cl] : "rgba(200,200,200,0.5)"),
        line: {
          width: items.map(d => specs && specs.has(d.ind) ? 2.2 : 1),
          color: items.map(d => specs && specs.has(d.ind) ? "#000" : "white"),
        },
      },
      hovertext: items.map(d =>
        `<b>${d.title}</b><br>Cluster: ${cl} (${CLUSTER_NAMES[cl]})<br>ICI: ${d.ICI.toFixed(2)}<br>Ubiquity: ${d.ubiquity}${specs && specs.has(d.ind) ? "<br><b>★ specialized</b>" : ""}`),
      hoverinfo: "text",
      name: `${cl} — ${CLUSTER_NAMES[cl]}`,
    });
  });

  // ── Optional indicator-name labels next to nodes ───────────────────────
  const annotations = [];
  if (showNames) {
    // Place each label slightly outward from the graph center
    const allX = inds.map(d => pos[d.ind][0]);
    const allY = inds.map(d => pos[d.ind][1]);
    const cx = allX.reduce((a, b) => a + b, 0) / allX.length;
    const cy = allY.reduce((a, b) => a + b, 0) / allY.length;
    inds.forEach(d => {
      const [x, y] = pos[d.ind];
      const dx = x - cx, dy = y - cy;
      const norm = Math.max(Math.hypot(dx, dy), 0.01);
      const off = 0.025 + (sizeFor(d.ICI) / 1500);
      const fullText = d.title.split(" ").slice(1).join(" ");
      const isPale = specs && !specs.has(d.ind);
      annotations.push({
        x: x + (dx / norm) * off,
        y: y + (dy / norm) * off,
        text: fullText,
        showarrow: false,
        font: {size: 8.5, color: isPale ? "#aaa" : "#444"},
        xanchor: dx >= 0 ? "left" : "right",
        yanchor: dy >= 0 ? "bottom" : "top",
      });
    });
  }

  const layout = {
    showlegend: true,
    legend: {orientation: "h", x: 0, y: -0.05, font: {size: 11}},
    xaxis: {visible: false, range: [-0.08, 1.08]},
    yaxis: {visible: false, range: [-0.08, 1.08], scaleanchor: "x"},
    margin: {t: 20, l: 20, r: 20, b: 80},
    paper_bgcolor: "white",
    plot_bgcolor: "#fafafa",
    hovermode: "closest",
    annotations: annotations,
  };

  Plotly.newPlot("space-plot", traces, layout,
    {responsive: true, displaylogo: false,
     modeBarButtonsToRemove: ["lasso2d", "select2d"]});
}

function setupIndicatorSpace() {
  const sel = document.getElementById("space-country-select");
  const sorted = DATA.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.name} (${c.code})`;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", renderIndicatorSpace);
  document.getElementById("space-show-names").addEventListener("change", renderIndicatorSpace);
}

// ─── World Map ─────────────────────────────────────────────────────────────
function renderWorldMap() {
  const metric = document.getElementById("map-metric").value;
  const cs = DATA.countries;

  const labelMap = {
    "CCI":         "CCI (share-based)",
    "CCI_hidalgo": "CCI (Hidalgo z-score)",
    "diversity":   "Diversity",
  };
  const colorscale = metric === "diversity"
    ? "Viridis"
    : [[0, "#a50026"], [0.25, "#f46d43"], [0.5, "#fee08b"],
       [0.75, "#abdda4"], [1, "#1a9850"]];

  const trace = {
    type: "choropleth",
    locations: cs.map(c => c.code),
    z: cs.map(c => c[metric]),
    text: cs.map(c => `<b>${c.name}</b><br>CCI: ${c.CCI.toFixed(2)} (rank ${c.rank})<br>Diversity: ${c.diversity}/45<br>GDP/cap 2023: ${c.gdp_pc_2023 ? "$" + c.gdp_pc_2023.toLocaleString("en-US") : "n/a"}`),
    hovertemplate: "%{text}<extra></extra>",
    colorscale: colorscale,
    autocolorscale: false,
    reversescale: false,
    colorbar: {title: labelMap[metric], thickness: 14, len: 0.7},
    marker: {line: {color: "white", width: 0.4}},
  };
  const layout = {
    geo: {
      projection: {type: "natural earth"},
      showframe: false,
      showcoastlines: false,
      bgcolor: "#fafafa",
    },
    margin: {t: 10, b: 10, l: 0, r: 0},
    paper_bgcolor: "white",
    plot_bgcolor: "#fafafa",
  };
  Plotly.newPlot("map-plot", [trace], layout,
    {responsive: true, displaylogo: false});
}

function setupWorldMap() {
  document.getElementById("map-metric").addEventListener("change", renderWorldMap);
}

// ─── Country Detail ─────────────────────────────────────────────────────────
function renderCountryDetail(code) {
  if (!code) {
    document.getElementById("country-summary").innerHTML = "";
    document.getElementById("country-priorities").innerHTML = "";
    document.getElementById("country-full-table").innerHTML = "<p class='empty-state'>Select a country to see details.</p>";
    return;
  }

  const c = DATA.byCode[code];
  const spec = DATA.specialization[code];
  const dens = DATA.density[code];
  const raw  = DATA.raw_scores[code];
  const thr  = DATA.thresholds;

  // Summary cards
  document.getElementById("country-summary").innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card-label">Country</div>
        <div class="summary-card-value">${c.name}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">CCI</div>
        <div class="summary-card-value">${c.CCI.toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Rank</div>
        <div class="summary-card-value">${c.rank} / 165</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Diversity</div>
        <div class="summary-card-value">${c.diversity} / 45</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">GDP per capita 2023</div>
        <div class="summary-card-value">${c.gdp_pc_2023 ? "$" + c.gdp_pc_2023.toLocaleString("en-US") : "n/a"}</div>
      </div>
    </div>
  `;

  // Reform priorities (top 5 by ICI × density × frac_of_threshold)
  const priorities = DATA.indicators
    .filter(ind => spec[ind.ind] === 0)
    .map(ind => {
      const r = raw[ind.ind];
      const t = thr[ind.ind];
      const frac = (r != null && t != null && t > 0) ? r / t : 0;
      return {
        ind: ind.ind,
        title: ind.title,
        cluster: ind.cluster,
        ICI: ind.ICI,
        density: dens[ind.ind],
        raw: r,
        threshold: t,
        frac: frac,
        score: ind.ICI * dens[ind.ind] * frac,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  document.getElementById("country-priorities").innerHTML = `
    <div class="priorities-box">
      <h3>Top reform priorities for ${c.name}</h3>
      <p style="font-size:13px; color:#6b6b6b; margin-bottom:14px;">
        Ranked by composite score = ICI × density × (current_score / Jenks_threshold). Top 8 of unspecialized indicators.
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Code</th><th>Indicator</th><th>Cluster</th>
            <th class="num">ICI</th><th class="num">Density</th>
            <th class="num">Score</th><th class="num">Threshold</th><th class="num">% of thr</th>
          </tr>
        </thead>
        <tbody>
          ${priorities.map((p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${p.title.split(" ")[0]}</strong></td>
              <td>${p.title.split(" ").slice(1).join(" ")}</td>
              <td><span class="cluster-badge cluster-${p.cluster}">${p.cluster}</span></td>
              <td class="num">${p.ICI.toFixed(2)}</td>
              <td class="num">${(p.density * 100).toFixed(1)}%</td>
              <td class="num"><strong>${(p.score * 100).toFixed(2)}</strong></td>
              <td class="num">${p.raw != null ? p.raw.toFixed(2) : "n/a"} / ${p.threshold != null ? p.threshold.toFixed(2) : "n/a"}</td>
              <td class="num">${p.raw != null && p.threshold != null ? (p.frac * 100).toFixed(0) + "%" : "n/a"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Full table
  const rows = DATA.indicators
    .slice()
    .sort((a, b) => b.ICI - a.ICI)
    .map(ind => {
      const r = raw[ind.ind];
      const t = thr[ind.ind];
      const isSpec = spec[ind.ind] === 1;
      return `
        <tr>
          <td>${ind.rank}</td>
          <td><strong>${ind.title.split(" ")[0]}</strong></td>
          <td>${ind.title.split(" ").slice(1).join(" ")}</td>
          <td><span class="cluster-badge cluster-${ind.cluster}">${ind.cluster}</span></td>
          <td class="num">${ind.ICI.toFixed(2)}</td>
          <td class="num">${r != null ? r.toFixed(2) : "n/a"}</td>
          <td class="num">${t != null ? t.toFixed(2) : "n/a"}</td>
          <td class="num">${(dens[ind.ind] * 100).toFixed(1)}%</td>
          <td class="${isSpec ? 'spec-1' : 'spec-0'}">${isSpec ? "★ yes" : "—"}</td>
        </tr>
      `;
    }).join("");

  document.getElementById("country-full-table").innerHTML = `
    <h3>All 45 indicators (sorted by ICI)</h3>
    <table>
      <thead>
        <tr>
          <th>Rank</th><th>Code</th><th>Indicator</th><th>Cluster</th>
          <th class="num">ICI</th><th class="num">Score</th>
          <th class="num">Threshold</th><th class="num">Density</th>
          <th>Specialized?</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function setupCountryDetail() {
  const sel = document.getElementById("country-select");
  const sorted = DATA.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.name} (${c.code})`;
    sel.appendChild(opt);
  });
  // Pre-select Kazakhstan as the paper's running example
  sel.value = "KAZ";
  renderCountryDetail("KAZ");
  sel.addEventListener("change", e => renderCountryDetail(e.target.value));
}

// ─── BOOT ──────────────────────────────────────────────────────────────────
(async function () {
  try {
    await loadAll();
    setupTabs();
    renderHome();
    setupICI();
    setupIndicatorSpace();
    setupWorldMap();
    setupCountryDetail();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#b91c1c;font-family:monospace;">
      <h2>Failed to load portal data</h2>
      <pre>${err.message}\n\n${err.stack || ""}</pre>
      <p>Check the browser console and verify that data/*.json files exist.</p>
    </div>`;
  }
})();
