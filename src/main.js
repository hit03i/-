import Parser from "rss-parser";
import fs from "fs";
import path from "path";

// ==============================
// 設定
// ==============================
const DATA_DIR = "data";
const SENT_PATH = path.join(DATA_DIR, "sent.json");
const KEEP_DAYS = 90;

// news.json はリポジトリ直下に置く（index.html が fetch('news.json') するため）
const OUT_PATH = "news.json";

// 会社ごとの表示件数
const PER_COMPANY_LIMIT = 3;

// 直近何日分を対象にするか（古い記事を拾いに行かない＝軽量化）
const MAX_AGE_DAYS = 30; // ← 14→30に（週次更新だと空になりにくい）

// --------------------
// Google News RSS URL を安全に生成
// --------------------
function googleNewsRssUrl(query, hl = "ja", gl = "JP", ceid = "JP:ja") {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

// --------------------
// RSS 定義（3社）
// --------------------
const FEEDS = [
  {
    name: "関西ペイント",
    url: googleNewsRssUrl(
      "(関西ペイント OR Kansai Paint) (塗料 OR コーティング OR paint OR coating OR 顔料 OR pigment) -ネイル -絵の具 -DIY"
    )
  },
{
  name: "日本ペイント",
  url: googleNewsRssUrl(
    "(日本ペイント OR Nippon Paint OR Nippon Paint Holdings OR ニッペ) (塗料 OR コーティング OR paint OR coating OR 建築 OR 自動車 OR リフィニッシュ OR 顔料 OR pigment) -ネイル -絵の具 -DIY"
  )
},
  {
    name: "BASF",
    url: googleNewsRssUrl(
      "(BASF OR \"BASF Coatings\") (coatings OR coating OR paint OR refinish OR automotive OR pigment) -cosmetics -nail -art"
    )
  }
];

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

function normTitle(t) {
  return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";
  const key = `${source}|${link || `title:${title}`}`;
  return { key, source, title, link, pubDate };
}

// ====== 履歴の読み書き ======
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSent() {
  try {
    if (!fs.existsSync(SENT_PATH)) return {};
    const raw = fs.readFileSync(SENT_PATH, "utf-8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function pruneSent(sentObj) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const pruned = {};
  for (const [k, v] of Object.entries(sentObj || {})) {
    const t = Date.parse(v) || 0;
    if (t >= cutoff) pruned[k] = v;
  }
  return pruned;
}

function saveSent(sentObj) {
  ensureDataDir();
  fs.writeFileSync(SENT_PATH, JSON.stringify(sentObj, null, 2), "utf-8");
}

function withinMaxAge(pubDate) {
  const t = Date.parse(pubDate || "") || 0;
  if (!t) return true;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

// --------------------
// 会社ごとに候補を取り、既出を除外して最新N件選ぶ
// --------------------
async function fetchPerCompanyLatestAvoidSent(perCompanyLimit = 3) {
  const parser = new Parser({ timeout: 20000 });

  let sent = pruneSent(loadSent());

  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const result = {};

  for (const f of FEEDS) {
    let items = [];
    try {
      const feed = await parser.parseURL(f.url);
      items = (feed.items || []).map((it) => normalizeItem(f.name, it));
    } catch (e) {
      console.error(`[WARN] RSS failed: ${f.name}`, e?.message || e);
      items = [];
    }

    const map = new Map();
    for (const it of items) {
      if (!it.title) continue;
      if (!withinMaxAge(it.pubDate)) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }
    const uniq = Array.from(map.values()).sort(sortByDateDesc);

    const seenTitle = new Set();
    const chosen = [];

    for (const it of uniq) {
      if (sent[it.key]) continue;
      const t = normTitle(it.title);
      if (seenTitle.has(t)) continue;
      seenTitle.add(t);
      chosen.push(it);
      if (chosen.length >= perCompanyLimit) break;
    }

    for (const it of chosen) {
      sent[it.key] = todayJst;
    }

    result[f.name] = chosen.map((it) => ({
      date: (it.pubDate || "").slice(0, 10) || todayJst,
      title: (it.title || "").trim(),
      url: (it.link || "").trim()
    }));
  }

  saveSent(sent);
  return result;
}

// --------------------
// main
// --------------------
async function main() {
  const data = await fetchPerCompanyLatestAvoidSent(PER_COMPANY_LIMIT);
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log("OK: wrote", OUT_PATH, "companies:", Object.keys(data));
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
