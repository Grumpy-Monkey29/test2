"""
plot_results.py
Reads the three k6 result files and produces a multi-panel comparison report.

Requirements:
    pip install matplotlib numpy

Run from the project root:
    python plot/plot_results.py
"""

import json
import os
import sys
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from pathlib import Path

matplotlib.rcParams.update({
    "font.family"      : "sans-serif",
    "axes.spines.top"  : False,
    "axes.spines.right": False,
    "axes.grid"        : True,
    "grid.alpha"       : 0.35,
    "grid.linestyle"   : "--",
})

# ─── Colours ─────────────────────────────────────────────────────────────────
REST_COLOR  = "#4A90D9"   # blue
GRPC_COLOR  = "#E8603C"   # orange-red
REST_LIGHT  = "#A8C8EC"
GRPC_LIGHT  = "#F4B49A"

ROOT_DIR    = Path(__file__).parent.parent
RESULTS_DIR = ROOT_DIR / "results"
OUT_DIR     = ROOT_DIR / "results"
OUT_DIR.mkdir(exist_ok=True)


def load(filename: str) -> dict | None:
    path = RESULTS_DIR / filename
    if not path.exists():
        print(f"[WARN] {filename} not found — skipping that panel.")
        return None
    with open(path) as f:
        return json.load(f)


def bar_group(ax, labels, rest_vals, grpc_vals, ylabel, title, fmt="{:.1f}"):
    x     = np.arange(len(labels))
    width = 0.35

    bars_rest = ax.bar(x - width / 2, rest_vals, width, label="REST",
                       color=REST_COLOR, zorder=3)
    bars_grpc = ax.bar(x + width / 2, grpc_vals, width, label="gRPC",
                       color=GRPC_COLOR, zorder=3)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel(ylabel, fontsize=9)
    ax.set_title(title, fontsize=11, fontweight="bold", pad=8)
    ax.legend(fontsize=8)

    for bar in bars_rest:
        h = bar.get_height()
        if h:
            ax.annotate(fmt.format(h), xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 3), textcoords="offset points",
                        ha="center", va="bottom", fontsize=7, color=REST_COLOR)
    for bar in bars_grpc:
        h = bar.get_height()
        if h:
            ax.annotate(fmt.format(h), xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 3), textcoords="offset points",
                        ha="center", va="bottom", fontsize=7, color=GRPC_COLOR)


def line_plot(ax, x_vals, rest_vals, grpc_vals, xlabel, ylabel, title, x_log=False):
    ax.plot(x_vals, rest_vals, "o-", color=REST_COLOR, linewidth=2,
            markersize=6, label="REST", zorder=3)
    ax.plot(x_vals, grpc_vals, "s-", color=GRPC_COLOR, linewidth=2,
            markersize=6, label="gRPC", zorder=3)
    if x_log:
        ax.set_xscale("log")
        ax.set_xticks(x_vals)
        ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.set_xlabel(xlabel, fontsize=9)
    ax.set_ylabel(ylabel, fontsize=9)
    ax.set_title(title, fontsize=11, fontweight="bold", pad=8)
    ax.legend(fontsize=8)


# ─────────────────────────────────────────────────────────────────────────────
# Figure layout  (3 rows × 2 cols grid)
# ─────────────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(16, 14))
fig.suptitle("REST vs gRPC — Performance Comparison", fontsize=16,
             fontweight="bold", y=0.98)

gs = gridspec.GridSpec(3, 2, figure=fig, hspace=0.52, wspace=0.38)

# ═══════════════════════════════════════════════════════════════════════════
# PANEL 1+2 — Throughput (num_requests.json)
# ═══════════════════════════════════════════════════════════════════════════
nr = load("num_requests.json")
ax_tp_lat = fig.add_subplot(gs[0, 0])
ax_tp_rps = fig.add_subplot(gs[0, 1])

if nr:
    rest = nr.get("rest", {})
    grpc = nr.get("grpc", {})

    # Latency percentiles
    pcts      = ["p50", "p90", "p95", "p99"]
    rest_lats = [rest.get(f"{p}_ms") or 0 for p in pcts]
    grpc_lats = [grpc.get(f"{p}_ms") or 0 for p in pcts]
    bar_group(ax_tp_lat, ["p50", "p90", "p95", "p99"],
              rest_lats, grpc_lats,
              "Latency (ms)",
              f"Throughput Test — Latency Percentiles\n(20 VUs × 30 s, payload 1 KB)")

    # RPS + total requests (twin axes)
    protocols = ["REST", "gRPC"]
    rps_vals  = [rest.get("rps") or 0, grpc.get("rps") or 0]
    req_vals  = [rest.get("total_requests") or 0, grpc.get("total_requests") or 0]

    x     = np.arange(2)
    width = 0.4
    ax_tp_rps.bar(x, rps_vals, width, color=[REST_COLOR, GRPC_COLOR], zorder=3)
    ax_tp_rps.set_xticks(x)
    ax_tp_rps.set_xticklabels(protocols)
    ax_tp_rps.set_ylabel("Requests / second", fontsize=9)
    ax_tp_rps.set_title("Throughput Test — Requests/sec\n(20 VUs × 30 s, payload 1 KB)",
                        fontsize=11, fontweight="bold", pad=8)
    for i, (v, r) in enumerate(zip(rps_vals, req_vals)):
        ax_tp_rps.text(i, v + max(rps_vals) * 0.01,
                       f"{v:.1f} RPS\n({int(r)} total)",
                       ha="center", va="bottom", fontsize=8)
else:
    ax_tp_lat.text(0.5, 0.5, "num_requests.json\nnot found",
                   ha="center", va="center", transform=ax_tp_lat.transAxes)
    ax_tp_rps.text(0.5, 0.5, "num_requests.json\nnot found",
                   ha="center", va="center", transform=ax_tp_rps.transAxes)

# ═══════════════════════════════════════════════════════════════════════════
# PANEL 3+4 — Payload size (payload_size.json)
# ═══════════════════════════════════════════════════════════════════════════
ps = load("payload_size.json")
ax_ps_avg = fig.add_subplot(gs[1, 0])
ax_ps_p95 = fig.add_subplot(gs[1, 1])

if ps:
    sizes      = list(ps["sizes"].keys())            # ["1kb", "10kb", "100kb", "500kb"]
    size_labels = [s.upper() for s in sizes]
    rest_avgs  = [ps["sizes"][s]["rest"]["avg_ms"] if ps["sizes"][s]["rest"] else 0 for s in sizes]
    grpc_avgs  = [ps["sizes"][s]["grpc"]["avg_ms"] if ps["sizes"][s]["grpc"] else 0 for s in sizes]
    rest_p95s  = [ps["sizes"][s]["rest"]["p95_ms"] if ps["sizes"][s]["rest"] else 0 for s in sizes]
    grpc_p95s  = [ps["sizes"][s]["grpc"]["p95_ms"] if ps["sizes"][s]["grpc"] else 0 for s in sizes]

    bar_group(ax_ps_avg, size_labels, rest_avgs, grpc_avgs,
              "Avg Latency (ms)", "Payload Size — Avg Latency (10 VUs)")
    bar_group(ax_ps_p95, size_labels, rest_p95s, grpc_p95s,
              "p95 Latency (ms)", "Payload Size — p95 Latency (10 VUs)")
else:
    for ax in (ax_ps_avg, ax_ps_p95):
        ax.text(0.5, 0.5, "payload_size.json\nnot found",
                ha="center", va="center", transform=ax.transAxes)

# ═══════════════════════════════════════════════════════════════════════════
# PANEL 5+6 — Parallel / concurrency (parallel.json)
# ═══════════════════════════════════════════════════════════════════════════
par = load("parallel.json")
ax_par_lat = fig.add_subplot(gs[2, 0])
ax_par_p99 = fig.add_subplot(gs[2, 1])

if par:
    vu_keys  = list(par["vu_levels"].keys())            # ["1vu", "5vu", ...]
    vu_nums  = [int(k.replace("vu", "")) for k in vu_keys]
    rest_avgs = []
    grpc_avgs = []
    rest_p99s = []
    grpc_p99s = []
    for k in vu_keys:
        rd = par["vu_levels"][k]["rest"]
        gd = par["vu_levels"][k]["grpc"]
        rest_avgs.append(rd["avg_ms"] if rd else 0)
        grpc_avgs.append(gd["avg_ms"] if gd else 0)
        rest_p99s.append(rd["p99_ms"] if rd else 0)
        grpc_p99s.append(gd["p99_ms"] if gd else 0)

    line_plot(ax_par_lat, vu_nums, rest_avgs, grpc_avgs,
              "Concurrent VUs", "Avg Latency (ms)",
              "Concurrency — Avg Latency vs VUs", x_log=True)
    line_plot(ax_par_p99, vu_nums, rest_p99s, grpc_p99s,
              "Concurrent VUs", "p99 Latency (ms)",
              "Concurrency — p99 Latency vs VUs (tail latency)", x_log=True)
else:
    for ax in (ax_par_lat, ax_par_p99):
        ax.text(0.5, 0.5, "parallel.json\nnot found",
                ha="center", va="center", transform=ax.transAxes)

# ─── Save ─────────────────────────────────────────────────────────────────────
out_path = OUT_DIR / "comparison_report.png"
fig.savefig(out_path, dpi=150, bbox_inches="tight")
print(f"\n✅  Chart saved → {out_path}")

# Also save individual PNGs for easy embedding
fig2, axes2 = plt.subplots(1, 1, figsize=(8, 5))
if ps:
    size_labels_kb = [int(s.replace("kb", "")) for s in sizes]
    axes2.plot(size_labels_kb, rest_avgs, "o-", color=REST_COLOR, linewidth=2, markersize=7, label="REST")
    axes2.plot(size_labels_kb, grpc_avgs, "s-", color=GRPC_COLOR, linewidth=2, markersize=7, label="gRPC")
    axes2.set_xscale("log")
    axes2.set_xticks(size_labels_kb)
    axes2.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    axes2.set_xlabel("Payload Size (KB)", fontsize=10)
    axes2.set_ylabel("Avg Latency (ms)", fontsize=10)
    axes2.set_title("REST vs gRPC — Latency vs Payload Size", fontsize=12, fontweight="bold")
    axes2.legend()
    axes2.grid(True, alpha=0.35, linestyle="--")
    axes2.spines["top"].set_visible(False)
    axes2.spines["right"].set_visible(False)
    out2 = OUT_DIR / "payload_size_line.png"
    fig2.savefig(out2, dpi=150, bbox_inches="tight")
    print(f"✅  Chart saved → {out2}")

plt.show()
