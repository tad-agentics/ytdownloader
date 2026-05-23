import { useState, useRef, useCallback } from "react";

// ─── helpers ──────────────────────────────────────────────────────────────────
const delay  = (ms)       => new Promise(r => setTimeout(r, ms));
const jitter = (lo, hi)   => delay(lo + Math.random() * (hi - lo));
const fmtNum = (n)        => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);
const fmtMB  = (mb)       => mb >= 1000 ? `${(mb/1024).toFixed(1)} GB` : `${mb} MB`;
const fmtDur = (s)        => s >= 3600 ? `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}` : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

// ─── mock YouTube search ──────────────────────────────────────────────────────
const MOCK_VIDEOS = [
  { videoId:"v001", title:"Cách kiếm tiền affiliate Shopee 2025 - $500/tháng không cần vốn", channel:"MoneyVN",    views:842000,  dur:847,  mb:118 },
  { videoId:"v002", title:"Hook công thức viral TikTok - 3 giây đầu quyết định tất cả",      channel:"CreatorHub", views:1200000, dur:612,  mb:86  },
  { videoId:"v003", title:"Shopee affiliate cho người mới - Hướng dẫn từ A đến Z",           channel:"MoneyVN",    views:390000,  dur:1243, mb:174 },
  { videoId:"v004", title:"Review sản phẩm TikTok triệu view - bí quyết quay phim đẹp",     channel:"TikTokPro",  views:2100000, dur:534,  mb:75  },
  { videoId:"v005", title:"Kiếm tiền online 2025 - affiliate marketing từ con số 0",          channel:"VlogMoney",  views:654000,  dur:982,  mb:137 },
  { videoId:"v006", title:"Bí kíp TikTok Shop - tăng doanh thu gấp 5 lần trong 30 ngày",    channel:"EcomVN",     views:445000,  dur:756,  mb:106 },
  { videoId:"v007", title:"Hook video hay nhất - tổng hợp 20 cách mở đầu viral nhất 2025",  channel:"CreatorHub", views:887000,  dur:1098, mb:153 },
  { videoId:"v008", title:"Hướng dẫn Shopee affiliate chi tiết - link sản phẩm hot nhất",    channel:"ShopeeVN",   views:321000,  dur:689,  mb:96  },
];

async function mockSearch(keyword, max) {
  await delay(1400 + Math.random() * 600);
  const n = Math.min(max, MOCK_VIDEOS.length);
  return MOCK_VIDEOS.slice(0, n).map(v => ({
    ...v,
    title: v.title,
    keyword,
    status: "queued",    // queued | downloading | uploading | done | failed
    progress: 0,
    r2key: null,
  }));
}

// ─── styles ───────────────────────────────────────────────────────────────────
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');`;

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --black:#111;--white:#fff;--bg:#e8e9eb;
  --teal:#7fd4d8;--teal-lt:#c4eaec;--teal-dk:#1a5c60;
  --tx:#111;--tx2:#888;--tx3:#aaa;
  --bdr:#e2e2e2;--bdr2:#d0d0d0;
  --f:'DM Sans',sans-serif;--m:'DM Mono',monospace;
}
body{background:var(--bg);font-family:var(--f);color:var(--tx);font-size:14px;min-height:100vh}
.root{min-height:100vh;display:flex;flex-direction:column}

/* HEADER */
.hdr{background:var(--black);height:52px;display:flex;align-items:center;padding:0 28px;gap:0;flex-shrink:0}
.logo{display:flex;align-items:center;gap:9px}
.lmark{width:29px;height:29px;border-radius:50%;background:#1a1a1a;border:1.5px solid #333;display:flex;align-items:center;justify-content:center}
.licon{width:15px;height:15px;fill:none;stroke:var(--teal);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lname{color:#fff;font-size:13.5px;font-weight:600;letter-spacing:-.2px}
.lname span{color:var(--teal)}
.hbadges{display:flex;align-items:center;gap:7px;margin-left:auto}
.hbadge{display:flex;align-items:center;gap:5px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:3px 10px 3px 7px;font-size:11px;color:#777;font-family:var(--m)}
.hdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.hdot.on{background:#4ade80}
.hdot.warn{background:#fb923c}
.hpill{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:7px;padding:3px 9px;font-size:11px;color:#999;font-family:var(--m)}

/* PAGE */
.page{flex:1;padding:20px;background:var(--bg)}
.card{background:var(--white);border-radius:16px;padding:30px;max-width:1180px;margin:0 auto;display:flex;gap:36px}

/* LEFT */
.left{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}
.pg-title{font-size:24px;font-weight:600;letter-spacing:-.5px;margin-bottom:22px}

/* STEP LABELS */
.step-strip{display:flex;align-items:center;gap:0;margin-bottom:16px}
.step{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:var(--tx3)}
.step.active{color:var(--tx)}
.step.done{color:var(--teal-dk)}
.step-num{width:18px;height:18px;border-radius:50%;border:1.5px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;flex-shrink:0}
.step.done .step-num{background:var(--teal);border-color:var(--teal);color:#fff}
.step-arrow{color:#d0d0d0;margin:0 8px;font-size:12px}

/* KEYWORD INPUT */
.kw-panel{background:#fafafa;border:1px solid var(--bdr);border-radius:10px;padding:16px;margin-bottom:16px}
.kw-row{display:flex;gap:7px;margin-bottom:10px}
.kw-inp{flex:1;background:#fff;border:1px solid var(--bdr);border-radius:7px;padding:7px 11px;font-family:var(--f);font-size:12.5px;color:var(--tx);outline:none;transition:border-color .15s}
.kw-inp:focus{border-color:var(--teal)}
.kw-inp::placeholder{color:var(--tx3)}
.kw-inp:disabled{opacity:.45;cursor:not-allowed}
.tag-pool{display:flex;flex-wrap:wrap;gap:5px;min-height:22px}
.tag{display:flex;align-items:center;gap:4px;background:#fff;border:1px solid var(--bdr2);border-radius:5px;padding:3px 9px;font-size:11.5px;animation:ti .15s ease}
@keyframes ti{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
.tag-x{background:none;border:none;cursor:pointer;color:var(--tx3);font-size:13px;line-height:1;padding:0;transition:color .1s}
.tag-x:hover{color:#e55}

/* CONFIG + RUN */
.cfg-run{display:flex;align-items:center;gap:8px;margin-bottom:18px}
.sel{background:#fff;border:1px solid var(--bdr);border-radius:7px;padding:6px 9px;font-family:var(--f);font-size:11.5px;color:var(--tx);outline:none;cursor:pointer}
.sel:focus{border-color:var(--teal)}
.sel:disabled{opacity:.45}
.run-btn{margin-left:auto;background:var(--black);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--f);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;position:relative;overflow:hidden}
.run-btn:hover:not(:disabled){background:#2a2a2a}
.run-btn:disabled{opacity:.4;cursor:not-allowed}
.run-btn.running{background:#1a3a3c;color:var(--teal)}
.run-btn.running::after{content:'';position:absolute;top:0;left:-80%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(127,212,216,.2),transparent);animation:sh 1.4s infinite}
@keyframes sh{to{left:160%}}

/* SEARCH STATE */
.search-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:12px;color:var(--tx2);font-size:13px}
.spinner{width:28px;height:28px;border:2.5px solid var(--bdr);border-top-color:var(--teal);border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.empty-hint{text-align:center;padding:36px 0;color:var(--tx3);font-size:12.5px;line-height:1.8}

/* VIDEO GRID */
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:9px;margin-bottom:0}
.vcard{background:#fff;border:1px solid var(--bdr);border-radius:8px;overflow:hidden;transition:border-color .2s}
.vcard.status-downloading{border-color:#f59e0b}
.vcard.status-uploading{border-color:#a78bfa}
.vcard.status-done{border-color:var(--teal)}
.vcard.status-failed{border-color:#fca5a5}
.vthumb{width:100%;aspect-ratio:16/9;position:relative;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.vthumb-bg{width:100%;height:100%;position:absolute;inset:0;object-fit:cover}
.vthumb-placeholder{width:100%;height:100%;background:linear-gradient(135deg,#e8e8e8 0%,#d8d8d8 100%)}
.vdur{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.75);color:#fff;font-size:9px;font-family:var(--m);padding:1px 5px;border-radius:3px}
.vstatus-badge{position:absolute;top:4px;right:4px;font-size:8.5px;font-weight:600;padding:2px 6px;border-radius:4px}
.vstatus-badge.downloading{background:#fbbf24;color:#78350f}
.vstatus-badge.uploading{background:#a78bfa;color:#fff}
.vstatus-badge.done{background:var(--teal);color:var(--teal-dk)}
.vstatus-badge.failed{background:#fca5a5;color:#991b1b}
.vprog-bar{height:2px;background:#f0f0f0}
.vprog-fill{height:100%;transition:width .3s ease}
.vprog-fill.downloading{background:#f59e0b}
.vprog-fill.uploading{background:#a78bfa}
.vprog-fill.done{background:var(--teal)}
.vinfo{padding:7px 8px}
.vtitle{font-size:10px;color:var(--tx);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px;font-weight:500}
.vmeta{display:flex;justify-content:space-between;font-size:9.5px;color:var(--tx3);font-family:var(--m)}

/* PROGRESS SUMMARY BAR */
.prog-summary{background:#f5f5f5;border-radius:8px;padding:10px 14px;margin-top:12px;display:flex;align-items:center;gap:12px;font-size:11.5px}
.prog-summary.stopped{background:#fff8f0}
.prog-overall-bar{flex:1;height:5px;background:#e0e0e0;border-radius:3px;overflow:hidden}
.prog-overall-fill{height:100%;background:var(--teal);border-radius:3px;transition:width .4s ease}
.prog-overall-fill.stopped{background:#fb923c}
.prog-label{font-family:var(--m);color:var(--tx2);flex-shrink:0;font-size:11px}
.stop-btn{background:#fff;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:8px 16px;font-family:var(--f);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
.stop-btn:hover{background:#fff1f2;border-color:#f87171}
.stop-btn:disabled{opacity:.4;cursor:not-allowed}
.vcard.status-cancelled{border-color:#d1d5db}
.vstatus-badge.cancelled{background:#e5e7eb;color:#6b7280}

/* DIVIDER */
.vdiv{width:1px;background:var(--bdr);flex-shrink:0}

/* RIGHT */
.right{width:304px;flex-shrink:0;display:flex;flex-direction:column;gap:20px}
.r-title{font-size:20px;font-weight:600;letter-spacing:-.4px;padding-bottom:13px;border-bottom:1px solid var(--bdr)}
.stor-row{display:flex;gap:0}
.stor-col{flex:1}
.stor-lbl{font-size:11px;color:var(--tx2);margin-bottom:4px}
.stor-val{font-size:27px;font-weight:600;letter-spacing:-.7px;line-height:1}
.stor-sub{font-size:11px;color:var(--tx3);margin-top:3px;font-family:var(--m)}

.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.sc{border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:14px;min-height:92px}
.sc.gray{background:#d4d5d8}
.sc.dark{background:#111}
.sc.teal{background:var(--teal)}
.sc-ic{width:30px;height:30px;opacity:.55}
.sc-lbl{font-size:10px;font-weight:500}
.sc.gray .sc-lbl{color:#555}
.sc.dark .sc-lbl{color:#666}
.sc.teal .sc-lbl{color:var(--teal-dk)}
.sc-val{font-size:18px;font-weight:600;letter-spacing:-.4px;line-height:1}
.sc.gray .sc-val{color:#111}
.sc.dark .sc-val{color:#fff}
.sc.teal .sc-val{color:var(--teal-dk)}

.alloc-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
.alloc-title{font-size:15px;font-weight:600;letter-spacing:-.3px}
.alloc-leg{display:flex;gap:10px}
.leg{display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--tx2)}
.leg-dot{width:7px;height:7px;border-radius:50%}
.leg-dot.s{background:var(--teal)}
.leg-dot.p{background:#ddd;border:1px solid #ccc}
.alloc-rows{display:flex;flex-direction:column;gap:9px}
.arow{display:flex;align-items:center;gap:7px}
.aic{width:19px;height:19px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:600;color:#555;flex-shrink:0}
.anm{font-size:11.5px;font-weight:500;width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
.abar{flex:1;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;display:flex}
.afill{height:100%;background:var(--teal);border-radius:4px}
.arest{height:100%;flex:1;background-image:repeating-linear-gradient(90deg,var(--teal) 0,var(--teal) 2px,transparent 2px,transparent 5px);opacity:.25}
.apct{font-size:11px;font-weight:500;color:var(--tx2);width:26px;text-align:right;flex-shrink:0}

/* BUTTONS */
.btn{font-family:var(--f);font-size:11px;font-weight:500;padding:5px 11px;border-radius:6px;cursor:pointer;border:none;transition:all .12s}
.btn.add{background:#f0f0f0;color:var(--tx)}
.btn.add:hover{background:#e5e5e5}
.btn.add:disabled{opacity:.4;cursor:not-allowed}
`;

// ─── alloc data ────────────────────────────────────────────────────────────────
const ALLOC = [
  { ic:"SA", nm:"shopee affiliate", pct:68 },
  { ic:"TC", nm:"tiktok creator",   pct:55 },
  { ic:"HF", nm:"hook formula",     pct:43 },
  { ic:"VV", nm:"viral vietnam",    pct:28 },
];

// ─── step indicator ─────────────────────────────────────────────────────────────
function StepStrip({ phase }) {
  const steps = [
    { id:"input",      label:"Keywords" },
    { id:"searching",  label:"Search" },
    { id:"results",    label:"Download & Upload" },
  ];
  const order = ["input","searching","results","processing","stopped","done"];
  const cur = order.indexOf(phase);
  const stepOrder = ["input","searching","results"];

  return (
    <div className="step-strip">
      {steps.map((s, i) => {
        const si = order.indexOf(s.id === "results" ? "results" : s.id);
        const isDone   = cur > si;
        const isActive = cur === si || (s.id === "results" && (phase === "processing" || phase === "done"));
        const cls = isDone || (s.id === "results" && phase === "done") ? "step done"
                  : isActive ? "step active" : "step";
        return (
          <span key={s.id} style={{display:"flex",alignItems:"center"}}>
            <span className={cls}>
              <span className="step-num">{isDone ? "✓" : i+1}</span>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="step-arrow">›</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── video card ─────────────────────────────────────────────────────────────────
function VideoCard({ v }) {
  const colors = ["#dbeafe","#fce7f3","#dcfce7","#fef9c3","#ede9fe","#ffedd5"];
  const bg = colors[Math.abs(v.videoId.charCodeAt(1)) % colors.length];
  return (
    <div className={`vcard status-${v.status}`}>
      <div className="vthumb">
        <div className="vthumb-placeholder" style={{ background: `linear-gradient(135deg,${bg},${bg}cc)` }} />
        <span className="vdur">{fmtDur(v.dur)}</span>
        {v.status !== "queued" && (
          <span className={`vstatus-badge ${v.status}`}>
            { v.status === "downloading" ? "↓ DL"
            : v.status === "uploading"   ? "↑ R2"
            : v.status === "done"        ? "✓"
            : "✗" }
          </span>
        )}
      </div>
      <div className="vprog-bar">
        <div className={`vprog-fill ${v.status}`} style={{ width: `${v.progress}%` }} />
      </div>
      <div className="vinfo">
        <div className="vtitle">{v.title}</div>
        <div className="vmeta">
          <span>{fmtNum(v.views)}</span>
          <span>{v.mb} MB</span>
        </div>
      </div>
    </div>
  );
}

// ─── main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [keywords, setKeywords] = useState([]);
  const [kwInput,  setKwInput]  = useState("");
  const [maxRes,   setMaxRes]   = useState("8");
  const [quality,  setQuality]  = useState("720p");
  const [phase,    setPhase]    = useState("input");   // input|searching|results|processing|stopped|done
  const [videos,   setVideos]   = useState([]);
  const runRef  = useRef(false);
  const stopRef = useRef(false); // abort signal — checked at each loop tick

  // ── keyword management ────────────────────────────────────────────────────────
  const addKw = () => {
    const k = kwInput.trim();
    if (!k || keywords.includes(k)) return;
    setKeywords(p => [...p, k]);
    setKwInput("");
  };
  const removeKw = (k) => setKeywords(p => p.filter(x => x !== k));

  // ── pipeline ──────────────────────────────────────────────────────────────────
  const handleStop = () => { stopRef.current = true; };

  const handleRun = async () => {
    if (runRef.current || keywords.length === 0) return;
    runRef.current  = true;
    stopRef.current = false; // reset abort signal on each new run

    // Phase 1 → searching
    setPhase("searching");
    setVideos([]);

    let allVideos = [];
    for (const kw of keywords) {
      if (stopRef.current) break; // abort during multi-keyword search
      const found = await mockSearch(kw, parseInt(maxRes) || 8);
      allVideos = [...allVideos, ...found];
    }

    if (stopRef.current) {
      setPhase("stopped");
      runRef.current = false;
      return;
    }

    setVideos(allVideos);
    setPhase("results");
    await delay(400);

    // Phase 2 → download + upload per video
    setPhase("processing");

    for (const video of allVideos) {
      if (stopRef.current) break; // check before starting each video

      // downloading
      setVideos(p => p.map(v => v.videoId === video.videoId ? { ...v, status:"downloading", progress:0 } : v));
      for (let pct = 0; pct <= 100; pct += Math.floor(Math.random()*18+8)) {
        if (stopRef.current) break; // check inside progress loop
        await delay(55 + Math.random()*80);
        setVideos(p => p.map(v => v.videoId === video.videoId ? { ...v, progress:Math.min(pct,100) } : v));
      }
      if (stopRef.current) break;

      // 8% failure
      if (Math.random() < 0.08) {
        setVideos(p => p.map(v => v.videoId === video.videoId ? { ...v, status:"failed", progress:0 } : v));
        await jitter(300, 700);
        continue;
      }

      // uploading
      setVideos(p => p.map(v => v.videoId === video.videoId ? { ...v, status:"uploading", progress:0 } : v));
      for (let pct = 0; pct <= 100; pct += Math.floor(Math.random()*22+12)) {
        if (stopRef.current) break; // check inside upload loop
        await delay(40 + Math.random()*60);
        setVideos(p => p.map(v => v.videoId === video.videoId ? { ...v, progress:Math.min(pct,100) } : v));
      }
      if (stopRef.current) break;

      // done
      const slug = video.keyword.replace(/\s+/g,"-").toLowerCase();
      setVideos(p => p.map(v => v.videoId === video.videoId
        ? { ...v, status:"done", progress:100, r2key:`${slug}/${video.videoId}_${Date.now()}.mp4` }
        : v));

      await jitter(600, 1400);
    }

    if (stopRef.current) {
      // Reset any in-progress video back to queued — it was never fully stored
      setVideos(p => p.map(v =>
        ["downloading","uploading"].includes(v.status)
          ? { ...v, status:"queued", progress:0 }
          : v
      ));
      setPhase("stopped");
    } else {
      setPhase("done");
    }

    runRef.current = false;
  };

  // ── derived stats ─────────────────────────────────────────────────────────────
  const done    = videos.filter(v => v.status === "done").length;
  const failed  = videos.filter(v => v.status === "failed").length;
  const active  = videos.filter(v => ["downloading","uploading"].includes(v.status)).length;
  const total   = videos.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const storedMB = videos.filter(v => v.status === "done").reduce((s,v) => s+v.mb, 0);
  const storedGB = (storedMB / 1024).toFixed(2);

  const isRunning = phase === "searching" || phase === "processing";
  const maxPct    = Math.max(...ALLOC.map(a => a.pct));

  const runLabel = phase === "searching"  ? "Searching…"
                 : phase === "processing" ? `Processing ${active > 0 ? `(${active} active)` : "…"}`
                 : (phase === "done" || phase === "stopped") ? "Run again"
                 : "Run Pipeline";

  return (
    <>
      <style>{FONTS + CSS}</style>
      <div className="root">

        {/* HEADER */}
        <header className="hdr">
          <div className="logo">
            <div className="lmark">
              <svg viewBox="0 0 16 16" className="licon">
                <polygon points="8,1 15,5 15,11 8,15 1,11 1,5"/>
                <line x1="8" y1="1" x2="8" y2="15"/>
                <line x1="1" y1="5" x2="15" y2="11"/>
                <line x1="15" y1="5" x2="1" y2="11"/>
              </svg>
            </div>
            <span className="lname">YT<span>Downloader</span></span>
          </div>
          <div className="hbadges">
            <div className="hbadge"><span className="hdot on"/>YT API · active</div>
            <div className="hbadge"><span className="hdot on"/>R2 · connected</div>
            <div className="hpill">VN · {quality}</div>
          </div>
        </header>

        {/* PAGE */}
        <div className="page">
          <div className="card">

            {/* ── LEFT: PIPELINE FLOW ───────────────────────── */}
            <div className="left">
              <div className="pg-title">Pipeline</div>
              <StepStrip phase={phase} />

              {/* STEP 1 — KEYWORDS */}
              <div className="kw-panel">
                <div className="kw-row">
                  <input
                    className="kw-inp"
                    placeholder="Enter keyword… e.g. shopee affiliate vietnam"
                    value={kwInput}
                    onChange={e => setKwInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") addKw();
                      if (e.key === "Backspace" && !kwInput && keywords.length) setKeywords(p => p.slice(0,-1));
                    }}
                    disabled={isRunning}
                  />
                  <button className="btn add" onClick={addKw} disabled={isRunning || !kwInput.trim()}>Add</button>
                </div>
                <div className="tag-pool">
                  {keywords.length === 0
                    ? <span style={{fontSize:11,color:"var(--tx3)"}}>No keywords — type and press Enter or click Add</span>
                    : keywords.map(k => (
                        <div key={k} className="tag">
                          {k}
                          <button className="tag-x" onClick={() => removeKw(k)} disabled={isRunning}>×</button>
                        </div>
                      ))
                  }
                </div>
              </div>

              {/* STEP 1 CONFIG + RUN */}
              <div className="cfg-run">
                <select className="sel" value={maxRes} onChange={e=>setMaxRes(e.target.value)} disabled={isRunning}>
                  {["5","8","10","20","50"].map(v=><option key={v} value={v}>{v} videos / keyword</option>)}
                </select>
                <select className="sel" value={quality} onChange={e=>setQuality(e.target.value)} disabled={isRunning}>
                  {["360p","480p","720p","1080p"].map(v=><option key={v}>{v}</option>)}
                </select>
                <button
                  className={`run-btn${isRunning?" running":""}`}
                  onClick={(phase === "done" || phase === "stopped")
                    ? () => { setPhase("input"); setVideos([]); }
                    : handleRun}
                  disabled={isRunning || (phase !== "done" && phase !== "stopped" && keywords.length === 0)}
                >
                  {runLabel}
                </button>
                {isRunning && (
                  <button className="stop-btn" onClick={handleStop}>
                    ■ Stop
                  </button>
                )}
              </div>

              {/* STEP 2 — SEARCHING */}
              {phase === "searching" && (
                <div className="search-state">
                  <div className="spinner"/>
                  <span>Searching YouTube for {keywords.length} keyword{keywords.length>1?"s":""}…</span>
                  <span style={{fontSize:11,color:"var(--tx3)",fontFamily:"var(--m)"}}>youtube.com/v3/search · region=VN</span>
                </div>
              )}

              {/* STEP 3 — RESULTS + PROGRESS */}
              {videos.length > 0 && (
                <>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontSize:15,fontWeight:600,letterSpacing:"-.3px"}}>
                      {total} video{total>1?"s":""} found
                    </span>
                    <span style={{fontSize:11,color:"var(--tx3)",fontFamily:"var(--m)"}}>
                      {done} stored
                      {failed > 0 ? ` · ${failed} failed` : ""}
                      {total - done - failed > 0 ? ` · ${total - done - failed} pending` : ""}
                    </span>
                  </div>

                  <div className="vgrid">
                    {videos.map(v => <VideoCard key={v.videoId} v={v} />)}
                  </div>

                  {(phase === "processing" || phase === "done" || phase === "stopped") && (
                    <div className={`prog-summary${phase==="stopped"?" stopped":""}`}>
                      <span className="prog-label">{pct}%</span>
                      <div className="prog-overall-bar">
                        <div className={`prog-overall-fill${phase==="stopped"?" stopped":""}`} style={{width:`${pct}%`}}/>
                      </div>
                      <span className="prog-label">
                        {phase === "done"    ? `Done — ${done} stored, ${fmtMB(storedMB)} to R2`
                       : phase === "stopped" ? `Stopped — ${done} stored, ${total-done-failed} remaining`
                       : `${done}/${total} complete`}
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* EMPTY HINT */}
              {phase === "input" && keywords.length === 0 && (
                <div className="empty-hint">
                  Add keywords above, then click <strong>Run Pipeline</strong>.<br/>
                  YTDownloader will search YouTube, download each video,<br/>
                  and upload it to your Cloudflare R2 bucket.
                </div>
              )}
            </div>

            <div className="vdiv"/>

            {/* ── RIGHT: STORAGE ─────────────────────────────── */}
            <div className="right">
              <div className="r-title">Storage</div>

              {/* TOTALS */}
              <div className="stor-row">
                <div className="stor-col">
                  <div className="stor-lbl">Total stored</div>
                  <div className="stor-val">{storedGB > 0 ? storedGB + " GB" : "—"}</div>
                  <div className="stor-sub">{done} file{done!==1?"s":""}</div>
                </div>
                <div className="stor-col">
                  <div className="stor-lbl">R2 available</div>
                  <div className="stor-val" style={{color:"#4ade80"}}>52.8 GB</div>
                  <div className="stor-sub">of 100 GB</div>
                </div>
              </div>

              {/* STAT CARDS */}
              <div className="stat-grid">
                <div className="sc gray">
                  <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#444" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M15 3L27 9v12L15 27 3 21V9z"/>
                    <line x1="15" y1="3" x2="15" y2="27"/>
                    <line x1="3" y1="9" x2="27" y2="21"/>
                    <line x1="27" y1="9" x2="3" y2="21"/>
                  </svg>
                  <div><div className="sc-lbl">Downloaded</div><div className="sc-val">{done}</div></div>
                </div>
                <div className="sc dark">
                  <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#888" strokeWidth="1.4" strokeLinecap="round">
                    <circle cx="15" cy="15" r="10"/>
                    <line x1="15" y1="11" x2="15" y2="16"/>
                    <circle cx="15" cy="20" r=".8" fill="#888"/>
                  </svg>
                  <div><div className="sc-lbl">Failed</div><div className="sc-val">{failed}</div></div>
                </div>
                <div className="sc teal">
                  <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#1a5c60" strokeWidth="1.8" strokeLinecap="round">
                    <polyline points="6,16 11,21 24,10"/>
                  </svg>
                  <div>
                    <div className="sc-lbl">Success</div>
                    <div className="sc-val">{total > 0 ? Math.round((done/total)*100)+"%" : "—"}</div>
                  </div>
                </div>
              </div>

              {/* KEYWORD DISTRIBUTION */}
              <div>
                <div className="alloc-hdr">
                  <div className="alloc-title">Keywords</div>
                  <div className="alloc-leg">
                    <div className="leg"><span className="leg-dot s"/>Stored</div>
                    <div className="leg"><span className="leg-dot p"/>Pending</div>
                  </div>
                </div>
                <div className="alloc-rows">
                  {ALLOC.map((a,i) => {
                    const w = Math.round((a.pct/maxPct)*62);
                    return (
                      <div key={i} className="arow">
                        <div className="aic">{a.ic}</div>
                        <div className="anm">{a.nm}</div>
                        <div className="abar">
                          <div className="afill" style={{width:`${w}%`}}/>
                          <div className="arest"/>
                        </div>
                        <div className="apct">{a.pct}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
