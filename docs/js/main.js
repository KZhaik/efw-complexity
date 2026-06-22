// ═══════════════════════════════════════════════════════════════════════════
// EFW COMPLEXITY PORTAL — frontend logic
// ═══════════════════════════════════════════════════════════════════════════

const CLUSTER_COLORS = {
  "1A": "#0d2c5e",
  "1B": "#1c5cb5",
  "2A": "#d97706",
  "2B": "#eab308",
  "3":  "#6b7280",
};
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
  const inds = DATA.indicators;
  const pos = DATA.proximity.positions;

  // Two edge layers: MST (stronger) and P90 extras (lighter)
  const mstX = [], mstY = [];
  const p90X = [], p90Y = [];
  DATA.proximity.edges.forEach(e => {
    const a = pos[e.source], b = pos[e.target];
    if (!a || !b) return;
    if (e.kind === "mst") { mstX.push(a[0], b[0], null); mstY.push(a[1], b[1], null); }
    else                  { p90X.push(a[0], b[0], null); p90Y.push(a[1], b[1], null); }
  });
  const edgeP90 = {
    x: p90X, y: p90Y, mode: "lines", type: "scatter",
    line: {width: 0.5, color: "rgba(170,170,170,0.35)"},
    hoverinfo: "none", showlegend: false,
  };
  const edgeMST = {
    x: mstX, y: mstY, mode: "lines", type: "scatter",
    line: {width: 1.3, color: "rgba(70,70,70,0.55)"},
    hoverinfo: "none", showlegend: false,
  };

  const clusterOrder = ["1A", "1B", "2A", "2B", "3"];
  const specs = country
    ? new Set(DATA.specialization[country]
                ? Object.entries(DATA.specialization[country])
                    .filter(([, v]) => v === 1).map(([k]) => k)
                : [])
    : null;

  const minICI = Math.min(...inds.map(d => d.ICI));
  const maxICI = Math.max(...inds.map(d => d.ICI));
  const sizeFor = ici => 14 + ((ici - minICI) / (maxICI - minICI)) * 36;

  const traces = [edgeP90, edgeMST];
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
          specs.has(d.ind) ? CLUSTER_COLORS[cl] : "rgba(200,200,200,0.45)"),
        line: {
          width: items.map(d => specs && specs.has(d.ind) ? 2.5 : 0.8),
          color: items.map(d => specs && specs.has(d.ind) ? "#000" : "white"),
        },
      },
      hovertext: items.map(d =>
        `<b>${d.title}</b><br>Cluster: ${cl} (${CLUSTER_NAMES[cl]})<br>ICI: ${d.ICI.toFixed(2)}<br>Ubiquity: ${d.ubiquity}${specs && specs.has(d.ind) ? "<br><b>★ specialized</b>" : ""}`),
      hoverinfo: "text",
      name: `${cl} — ${CLUSTER_NAMES[cl]}`,
    });
  });

  const layout = {
    showlegend: true,
    legend: {orientation: "h", x: 0, y: -0.05, font: {size: 11}},
    xaxis: {visible: false, range: [-0.05, 1.05]},
    yaxis: {visible: false, range: [-0.05, 1.05], scaleanchor: "x"},
    margin: {t: 20, l: 20, r: 20, b: 80},
    paper_bgcolor: "white",
    plot_bgcolor: "#fafafa",
    hovermode: "closest",
  };

  Plotly.newPlot("space-plot", traces, layout,
    {responsive: true, displaylogo: false,
     modeBarButtonsToRemove: ["lasso2d", "select2d"]});
}

function setupIndicatorSpace() {
  const sel = document.getElementById("space-country-select");
  DATA.countries.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.name} (${c.code})`;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", renderIndicatorSpace);
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
  DATA.countries.forEach(c => {
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
