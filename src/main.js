import Parser from "rss-parser";
import fs from "fs";
import path from "path";

// ==============================
// 設定
// ==============================
const DATA_DIR = "data";
const SENT_PATH = path.join(DATA_DIR, "sent.json");
const KEEP_DAYS = 90;

// GitHub Pages: index.html が fetch('news.json') するため、リポジトリ直下に出力
const OUT_PATH = "news.json";

// 会社ごとの表示件数（最大）
const PER_COMPANY_LIMIT = 3;

// 直近何日分を優先するか（週次なら30〜60が安定）
const MAX_AGE_DAYS = 60;

// 「古い記事を切る」スイッチ（もしまた空になったら true→false にすると原因切り分けが楽）
const ENABLE_AGE_FILTER = true;

// --------------------
// Google News RSS URL を安全に生成
// --------------------
function googleNewsRssUrl(query, hl = "ja", gl = "JP", ceid = "JP:ja") {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

// --------------------
// RSS 定義（3社）※日本ペイントは表記ゆらぎを広めに
// --------------------
const FEEDS = [
 {
  name: "関西ペイント",
  url: googleNewsRssUrl(
    '(関西ペイント OR "Kansai Paint") (automotive OR 自動車 OR OEM OR refinish OR 塗料 OR paint OR coating)'
  )
},
  {
    name: "日本ペイント",
    url: googleNewsRssUrl(
      "(日本ペイント OR Nippon Paint OR ニッペ) (自動車 OR automotive OR OEM OR リフィニッシュ OR 車両) (塗料 OR coating) -市場 -調査 -レポート -ドリームニュース"
    )
  },
  {
    name: "BASF",
    url: googleNewsRssUrl(
      "(BASF Coatings OR BASF automotive) (automotive OR OEM OR refinish) -market -report -analysis"
    )
  }
];

// ==============================
// ユーティリティ
// ==============================
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

function normTitle(t) {
  return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function parseDateToISO10(d) {
  const t = Date.parse(d || "");
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function withinMaxAge(pubDate) {
  if (!ENABLE_AGE_FILTER) return true;
  const t = Date.parse(pubDate || "");
  if (Number.isNaN(t)) return true; // 日付が怪しい場合は通す（空にならないため）
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";
  const key = `${source}|${link || `title:${title}`}`;
  return { key, source, title, link, pubDate };
}

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

// ==============================
// コア：会社ごとに取得して、"新着優先 + 足りなければ既出で埋める"
// ==============================
async function buildNewsJson(perCompanyLimit = 3) {
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
      const count = (feed.items || []).length;
      console.log(`[INFO] ${f.name} items: ${count}`);
      items = (feed.items || []).map((it) => normalizeItem(f.name, it));
    } catch (e) {
      console.error(`[WARN] RSS failed: ${f.name}`, e?.message || e);
      items = [];
    }

    // 会社内でキー重複を消しつつ、必要なら日付フィルタ
    const map = new Map();
    for (const it of items) {
      if (!it.title) continue;
      if (!withinMaxAge(it.pubDate)) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }
    const uniq = Array.from(map.values()).sort(sortByDateDesc);

    // まず新着（未出）だけで選ぶ → 足りない分は既出も含めて埋める
    const seenTitle = new Set();
    const chosen = [];

    // 1) 新着優先
    for (const it of uniq) {
      if (sent[it.key]) continue;
      const t = normTitle(it.title);
      if (seenTitle.has(t)) continue;
      seenTitle.add(t);
      chosen.push(it);
      if (chosen.length >= perCompanyLimit) break;
    }

    // 2) 足りなければ既出も混ぜる（空配列回避）
    if (chosen.length < perCompanyLimit) {
      for (const it of uniq) {
        const t = normTitle(it.title);
        if (seenTitle.has(t)) continue;
        seenTitle.add(t);
        chosen.push(it);
        if (chosen.length >= perCompanyLimit) break;
      }
    }

    // もしRSS自体が0で何も取れない場合でも、必ず配列を作る
    result[f.name] = chosen.map((it) => ({
      date: parseDateToISO10(it.pubDate) || todayJst,
      title: (it.title || "").trim(),
      url: (it.link || "").trim()
    }));

    // 未出で選べたものだけ「既出」に記録（既出補充分まで記録すると次回さらに薄くなるため）
    for (const it of chosen) {
      // 既出補充分も含めて記録したいなら、下の if を外す
      if (!sent[it.key]) sent[it.key] = todayJst;
    }
  }

  saveSent(sent);
  return result;
}

// ==============================
// main
// ==============================
async function main() {
  const data = await buildNewsJson(PER_COMPANY_LIMIT);
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log("OK: wrote", OUT_PATH, "companies:", Object.keys(data).join(", "));
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
