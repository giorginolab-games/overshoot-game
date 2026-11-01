"""Paper figures from traces.json (run: python3 paper/figures/plot.py)."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "traces.json")))
plt.rcParams.update({"font.family": "serif", "font.size": 8.5, "axes.linewidth": 0.6,
                     "axes.spines.top": False, "axes.spines.right": False,
                     "xtick.major.width": 0.6, "ytick.major.width": 0.6, "legend.frameon": False,
                     "lines.linewidth": 1.1, "savefig.bbox": "tight", "savefig.pad_inches": 0.02})
INK, GREY = "#2340b8", "#8d8392"
COL = {"INa": "#e8590c", "ICaL": "#2b8a3e", "Ito": "#c2255c", "IKr": "#6741d9", "IKs": "#1971c2",
       "IK1": "#0c7480", "INaCa": "#a07000", "INaK": "#74695f"}
LAYER = ["#3b5bdb", "#9c36b5", "#d9480f"]


def panel_label(ax, s):
    ax.text(-0.13, 1.04, s, transform=ax.transAxes, fontweight="bold", fontsize=10, va="bottom")


# ---- Figure 2: target waveforms of four cell types --------------------------------------
fig, axs = plt.subplots(2, 2, figsize=(6.3, 3.9))
spec = [("squid", "Squid giant axon (HH 1952)", (0, 20)), ("pyramidal", "Pyramidal neuron, 2.5 µA cm$^{-2}$ step", (0, 800)),
        ("thalamus", "Thalamic neuron, rebound burst", (0, 700)), ("epi", "Human ventricular myocyte (TNNP 2004)", (0, 600))]
for ax, (k, title, xl), lab in zip(axs.flat, spec, "abcd"):
    ax.plot(D[k]["t"], D[k]["V"], color=INK)
    ax.set_xlim(*xl); ax.set_title(title, fontsize=8.5, loc="left")
    ax.set_xlabel("time (ms)"); ax.set_ylabel("V (mV)")
    panel_label(ax, lab)
    s = D[k]["stim"]
    if any(abs(x) > 0 for x in s):
        m = max(abs(x) for x in s)
        ax2 = ax.inset_axes([0, -0.02, 1, 0.08]); ax2.plot(D[k]["t"], [x / m for x in s], color="#b8233a", lw=0.8)
        ax2.set_xlim(*xl); ax2.axis("off")
fig.tight_layout()
fig.savefig(os.path.join(HERE, "fig_targets.pdf"))

# ---- Figure 3: ventricular currents -------------------------------------------------------
fig, axs = plt.subplots(1, 2, figsize=(6.3, 2.3), gridspec_kw={"width_ratios": [1, 1.25]})
t = D["epi"]["t"]
axs[0].plot(t, D["epi"]["V"], color=INK); axs[0].set_xlim(0, 450)
axs[0].set_xlabel("time (ms)"); axs[0].set_ylabel("V (mV)"); panel_label(axs[0], "a")
for k in ["ICaL", "Ito", "IKr", "IKs", "IK1", "INaCa", "INaK"]:
    axs[1].plot(t, D["epiI"][k], color=COL[k], label=k.replace("I", "$I_{", 1) + "}$")
axs[1].set_xlim(0, 450); axs[1].set_ylim(-4, 4); axs[1].axhline(0, color="#ccc", lw=0.5, zorder=0)
axs[1].set_xlabel("time (ms)"); axs[1].set_ylabel("current (pA pF$^{-1}$)")
axs[1].legend(ncol=2, fontsize=7, loc="lower right"); panel_label(axs[1], "b")
axs[1].text(60, 3.3, r"$I_\mathrm{Na}$ peak $\approx -300$ pA pF$^{-1}$ (off scale)", fontsize=7, color=COL["INa"])
fig.tight_layout()
fig.savefig(os.path.join(HERE, "fig_currents.pdf"))

# ---- Figure 5: pseudo-ECGs -----------------------------------------------------------------
W, G = D["wall"], D["drug"]
fig, axs = plt.subplots(1, 3, figsize=(6.6, 2.2))
tw = W["t"]
axs[0].plot(tw, W["ecgUniform"], color=GREY, label="uniform wall")
axs[0].plot(tw, W["ecgLayered"], color=INK, label="endo / M / epi")
axs[0].set_xlim(0, 400); axs[0].set_ylim(-0.3, 1.1); axs[0].set_ylabel(r"$\phi_e$ (QRS = 1)"); axs[0].set_xlabel("time (ms)")
axs[0].legend(fontsize=7, loc="upper right"); panel_label(axs[0], "a")
for r, (nm, c) in enumerate(zip(["endo", "mid", "epi"], LAYER)):
    axs[1].plot(tw, W["apsLayered"][r], color=c, label=nm)
axs[1].set_xlim(0, 400); axs[1].set_xlabel("time (ms)"); axs[1].set_ylabel("V (mV)")
axs[1].legend(fontsize=7, loc="lower left"); panel_label(axs[1], "b")
axs[2].plot(G["t"], G["control"], color=GREY, label="control")
axs[2].plot(G["t"], G["herg"], color="#6741d9", label="hERG 40 %")
axs[2].plot(G["t"], G["hergCa"], color="#2b8a3e", ls="--", label="hERG 40 % + Ca$_\\mathrm{L}$ 70 %")
axs[2].set_xlim(150, 400); axs[2].set_ylim(-0.05, 0.3); axs[2].set_xlabel("time (ms)"); axs[2].set_ylabel(r"$\phi_e$ (QRS = 1)")
axs[2].legend(fontsize=6.5, loc="upper left"); panel_label(axs[2], "c")
fig.tight_layout()
fig.savefig(os.path.join(HERE, "fig_ecg.pdf"))
print("figures written")
