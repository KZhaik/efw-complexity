"""
================================================================================
BUILD PORTAL DATA
================================================================================
Reads the analytical tables from out/ and emits compact JSON files used by the
static web portal in portal/. Run this after complexity_analysis.py whenever
you change methodology or want to refresh the portal.

Usage:
    python build_portal.py

Output files (portal/data/):
    indicators.json    - 45 indicators with ICI/cluster/title/ubiquity
    countries.json     - 165 countries with CCI/diversity/GDP/rank/specializations
    proximity.json     - 45x45 proximity matrix phi
    density.json       - 165x45 density matrix (KAZ row pre-extracted)
    thresholds.json    - Jenks thresholds for each indicator
    raw_scores.json    - 165x45 raw EFW scores (for frac_of_threshold)
    meta.json          - global stats (totals, paper sections, etc)
================================================================================
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

import json
import pandas as pd
import numpy as np
import networkx as nx
from pathlib import Path

ROOT   = Path(__file__).parent
OUT    = ROOT / "out"
PORTAL = ROOT / "docs" / "data"
PORTAL.mkdir(parents=True, exist_ok=True)

# ─── Indicators (ICI + cluster + ubiquity + title) ─────────────────────────────
print("[1/7] Building indicators.json...")
ici = pd.read_excel(OUT / "ICI_CCI.xlsx", sheet_name="ICI_indicators")
clusters = pd.read_excel(OUT / "Indicator_clusters.xlsx", sheet_name="Indicators")
clusters = clusters.set_index("ind")["cluster"].to_dict()

indicators = []
for _, r in ici.sort_values("ICI", ascending=False).iterrows():
    indicators.append({
        "ind":       r["ind"],
        "title":     r["title"],
        "cluster":   clusters.get(r["ind"], "3"),
        "ICI":       round(float(r["ICI"]), 3),
        "ICI_hidalgo": round(float(r["ICI_hidalgo"]), 3),
        "ubiquity":  int(r["ubiquity"]),
        "rank":      int(r["rank_ICI"]),
    })
with open(PORTAL / "indicators.json", "w", encoding="utf-8") as f:
    json.dump(indicators, f, ensure_ascii=False, indent=2)
print(f"    saved {len(indicators)} indicators")

# ─── Countries (CCI + diversity + GDP + specializations) ──────────────────────
print("[2/7] Building countries.json...")
cci = pd.read_excel(OUT / "ICI_CCI.xlsx", sheet_name="CCI_countries")
M = pd.read_excel(OUT / "M_jenks.xlsx").set_index("country_code")
density = pd.read_excel(OUT / "Density_all_countries.xlsx", index_col=0)
raw = pd.read_excel(ROOT / "data" / "IEF_2023_raw.xlsx", sheet_name="2023 base").set_index("country_code")
# keep only the 45 indicator columns used in the analysis
ind_codes = [r["ind"] for r in indicators]
M = M[ind_codes]
raw = raw[ind_codes]

countries = []
for _, r in cci.sort_values("CCI", ascending=False).iterrows():
    code = r["country_code"]
    if code not in M.index:
        continue
    specs = M.loc[code][M.loc[code] == 1].index.tolist()
    countries.append({
        "code":         code,
        "name":         r["country_name"],
        "gdp_pc_2023":  None if pd.isna(r["gdp_pc_2023"]) else round(float(r["gdp_pc_2023"]), 1),
        "diversity":    int(r["diversity"]),
        "CCI":          round(float(r["CCI"]), 2),
        "CCI_hidalgo":  round(float(r["CCI_hidalgo"]), 3),
        "rank":         int(r["rank_CCI"]),
        "specializations": specs,
    })
with open(PORTAL / "countries.json", "w", encoding="utf-8") as f:
    json.dump(countries, f, ensure_ascii=False, indent=2)
print(f"    saved {len(countries)} countries")

# ─── Proximity matrix + MST/P90 graph + Kamada-Kawai positions ────────────────
print("[3/7] Building proximity.json (with MST+P90 edges and precomputed layout)...")
phi = pd.read_excel(OUT / "Proximity_phi.xlsx", index_col=0)
phi = phi.loc[ind_codes, ind_codes]   # consistent order
phi_arr = phi.values.copy()
np.fill_diagonal(phi_arr, 0.0)
phi_arr = (phi_arr + phi_arr.T) / 2

inds_list = list(phi.columns)
n_inds = len(inds_list)
upper = phi_arr[np.triu_indices(n_inds, k=1)]
p90 = float(np.percentile(upper, 90))

# Build full graph, then MST + edges with phi >= P90 (same as in the paper)
G_full = nx.Graph()
for i in range(n_inds):
    for j in range(i + 1, n_inds):
        if phi_arr[i, j] > 0:
            G_full.add_edge(inds_list[i], inds_list[j], weight=float(phi_arr[i, j]))
mst = nx.maximum_spanning_tree(G_full, weight="weight")

G_vis = mst.copy()
for i in range(n_inds):
    for j in range(i + 1, n_inds):
        if phi_arr[i, j] >= p90 and not G_vis.has_edge(inds_list[i], inds_list[j]):
            G_vis.add_edge(inds_list[i], inds_list[j], weight=float(phi_arr[i, j]))

# Mark edges as MST vs P90 so the frontend can style them differently
edges = []
mst_pairs = set(frozenset((u, v)) for u, v in mst.edges())
for u, v, d in G_vis.edges(data=True):
    kind = "mst" if frozenset((u, v)) in mst_pairs else "p90"
    edges.append({"source": u, "target": v, "phi": round(d["weight"], 4), "kind": kind})

# Kamada-Kawai layout on the visualisation graph (deterministic given a seed)
# Run several rotations and keep the one that elongates horizontally
pos = nx.kamada_kawai_layout(G_vis, weight="weight")

# Rotate so the main variance axis is horizontal (PCA alignment)
all_pts = np.array([pos[n] for n in inds_list])
center  = all_pts.mean(axis=0)
pts_c   = all_pts - center
cov     = np.cov(pts_c.T)
eigvals, eigvecs = np.linalg.eigh(cov)
main_vec = eigvecs[:, np.argmax(eigvals)]
angle = -np.arctan2(main_vec[1], main_vec[0])
ca, sa = np.cos(angle), np.sin(angle)
R = np.array([[ca, -sa], [sa, ca]])
pos = {n: tuple(R @ (np.array(pos[n]) - center)) for n in inds_list}

# Map indicator -> cluster from precomputed clusters file
ind_to_cluster = {r["ind"]: r["cluster"] for r in indicators}

# Orient so cluster 1A (Rule of Law core) is on the right side
xs = {cl: np.mean([pos[i][0] for i in inds_list if ind_to_cluster[i] == cl])
      for cl in ["1A", "3"]}
if xs["1A"] < xs["3"]:
    pos = {n: (-x, y) for n, (x, y) in pos.items()}

# Normalize to [0, 1] for the frontend
all_pts = np.array([pos[n] for n in inds_list])
xmin, ymin = all_pts.min(axis=0)
xmax, ymax = all_pts.max(axis=0)
pos_norm = {n: [round((x - xmin) / (xmax - xmin), 4),
                round((y - ymin) / (ymax - ymin), 4)]
            for n, (x, y) in pos.items()}

# Compact matrix for hover/details
phi_dict = {ind: {k: round(float(v), 4) for k, v in phi.loc[ind].to_dict().items() if k != ind}
            for ind in inds_list}

with open(PORTAL / "proximity.json", "w", encoding="utf-8") as f:
    json.dump({"edges": edges, "p90": round(p90, 4),
               "positions": pos_norm, "matrix": phi_dict},
              f, ensure_ascii=False, indent=2)
print(f"    saved {len(edges)} edges (MST={sum(1 for e in edges if e['kind']=='mst')}, "
      f"P90 extras={sum(1 for e in edges if e['kind']=='p90')})")

# ─── Density matrix (165 x 45) ─────────────────────────────────────────────────
print("[4/7] Building density.json...")
density = density.loc[M.index, ind_codes]
density_dict = {}
for c in density.index:
    density_dict[c] = {ind: round(float(density.loc[c, ind]), 4) for ind in ind_codes}
with open(PORTAL / "density.json", "w", encoding="utf-8") as f:
    json.dump(density_dict, f, ensure_ascii=False)
print(f"    saved {len(density_dict)} country rows")

# ─── M matrix (specialization 0/1) ─────────────────────────────────────────────
print("[5/7] Building specialization.json...")
spec_dict = {}
for c in M.index:
    spec_dict[c] = {ind: int(M.loc[c, ind]) for ind in ind_codes}
with open(PORTAL / "specialization.json", "w", encoding="utf-8") as f:
    json.dump(spec_dict, f, ensure_ascii=False)
print(f"    saved {len(spec_dict)} country rows")

# ─── Raw scores + Jenks thresholds (for frac_of_threshold) ─────────────────────
print("[6/7] Building thresholds.json + raw_scores.json...")

# Re-derive thresholds via Jenks (same as in the main pipeline)
import jenkspy
thresholds = {}
for ind in ind_codes:
    valid = raw[ind].dropna().values.astype(float)
    if len(valid) >= 3:
        breaks = jenkspy.jenks_breaks(valid, n_classes=3)
        thresholds[ind] = round(float(breaks[2]), 4)
    else:
        thresholds[ind] = None

raw_scores = {}
for c in raw.index:
    raw_scores[c] = {ind: (None if pd.isna(raw.loc[c, ind]) else round(float(raw.loc[c, ind]), 3))
                     for ind in ind_codes}

with open(PORTAL / "thresholds.json", "w", encoding="utf-8") as f:
    json.dump(thresholds, f, ensure_ascii=False, indent=2)
with open(PORTAL / "raw_scores.json", "w", encoding="utf-8") as f:
    json.dump(raw_scores, f, ensure_ascii=False)
print(f"    saved thresholds for {len(thresholds)} indicators")

# ─── Meta (global stats + reference paper info) ────────────────────────────────
print("[7/7] Building meta.json...")
total_M = int(M.values.sum())
meta = {
    "title":      "Unlocking Economic Freedom",
    "subtitle":   "Prioritizing institutional reforms in developing countries through economic complexity",
    "author":     "Kuanysh Zhaikov",
    "affiliation":"Desht Lab, Astana, Kazakhstan",
    "email":      "k.zhaik@desht.org",
    "year":       2026,
    "data_source":"Economic Freedom of the World 2025 Annual Report (Fraser Institute), 2023 cross-section",
    "n_countries": len(countries),
    "n_indicators": len(indicators),
    "total_specializations": total_M,
    "density_pct": round(100 * total_M / (len(countries) * len(indicators)), 1),
    "p90_phi":    round(p90, 4),
    "clusters": [
        {"label": "1A", "name": "Rule of Law — core",                "mean_ICI": 3.45, "color": "#0d2c5e"},
        {"label": "1B", "name": "Openness & Security",               "mean_ICI": 2.98, "color": "#1c5cb5"},
        {"label": "2A", "name": "Regulation & Trade Barriers",       "mean_ICI": 2.34, "color": "#d97706"},
        {"label": "2B", "name": "Monetary System",                   "mean_ICI": 1.93, "color": "#eab308"},
        {"label": "3",  "name": "Residual (fiscal + labor)",         "mean_ICI": 1.25, "color": "#6b7280"},
    ],
}
with open(PORTAL / "meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)

print(f"\nDone. All JSON files saved to: {PORTAL}")
print("Files:")
for p in sorted(PORTAL.glob("*.json")):
    size_kb = p.stat().st_size / 1024
    print(f"  {p.name:30s}  {size_kb:8.1f} KB")
