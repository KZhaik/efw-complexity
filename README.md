# EFW Complexity — replication code & interactive portal

Companion repository for:

> Zhaikov, K. (2026). *Unlocking Economic Freedom: Prioritizing institutional
> reforms in developing countries through economic complexity*. Working paper,
> Desht Lab.

This repo contains **(1)** a single Python script that reproduces every
figure in the paper from the raw EFW workbook, and **(2)** an interactive
web portal that lets readers explore the indicator hierarchy, the indicator
space, the country complexity world map, and per-country reform priorities.

**Live portal:** https://kzhaik.github.io/efw-complexity/

---

## Repository structure

```
.
├── README.md
├── methodology_explained.md   # line-by-line walkthrough of the pipeline
├── complexity_analysis.py     # reproducible analysis (one script)
├── build_portal.py            # generates JSON data for the portal
├── data/                      # raw EFW inputs
│   ├── IEF_2023_raw.xlsx
│   └── ief_database_full.dta
├── out/                       # analytical tables (generated)
│   ├── M_jenks.xlsx
│   ├── ICI_CCI.xlsx
│   ├── Proximity_phi.xlsx
│   ├── Density_all_countries.xlsx
│   ├── Kazakhstan_priorities.xlsx
│   ├── Panel_stability.xlsx
│   ├── Indicator_clusters.xlsx
│   └── verification.txt
└── docs/                      # the portal (served by GitHub Pages)
    ├── index.html
    ├── css/style.css
    ├── js/main.js
    └── data/*.json
```

---

## Reproducing the analysis

```bash
pip install pandas numpy scipy scikit-learn jenkspy networkx openpyxl
python complexity_analysis.py        # ~1 minute; writes everything to out/
python build_portal.py                # regenerates portal JSON from out/
```

Optional for visualizations: `matplotlib`, `plotly`, `kaleido`.

`complexity_analysis.py` finishes with a verification table comparing 22 key
figures from the paper against computed values. 21 of 22 pass; the one
discrepancy is documented in `methodology_explained.md` (Section 10).

---

## Hosting the portal on GitHub Pages

The portal lives in `docs/` so that GitHub Pages picks it up automatically.

### One-time setup

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Source: **Deploy from a branch**
4. Branch: **main**, folder: **/docs**
5. Save. After ~30 seconds the portal is live at
   `https://<your-username>.github.io/efw-complexity/`.

### Updating the portal after re-running analysis

```bash
python complexity_analysis.py
python build_portal.py
git add -A
git commit -m "Refresh portal data"
git push
```

GitHub Pages rebuilds automatically within ~30 seconds.

---

## Citation

```bibtex
@unpublished{Zhaikov2026,
  author = {Kuanysh Zhaikov},
  title  = {Unlocking Economic Freedom: Prioritizing institutional reforms in
            developing countries through economic complexity},
  year   = {2026},
  note   = {Working paper. SSRN.},
  url    = {https://github.com/KZhaik/efw-complexity},
}
```

## Data source

Gwartney, J., Lawson, R., Hall, J., & Murphy, R. (2025). *Economic Freedom of
the World: 2025 Annual Report*. Fraser Institute. Free for academic use; see
[fraserinstitute.org/economic-freedom](https://www.fraserinstitute.org/economic-freedom/).

## Contact

Kuanysh Zhaikov — k.zhaik@desht.org · Desht Lab, Astana, Kazakhstan
