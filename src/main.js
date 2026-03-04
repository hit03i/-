import Parser from "rss-parser";
import fs from "fs";

// ==============================
// 設定（掲示板向け：安定優先）
// ==============================

const OUT_PATH = "news.json";
const PER_COMPANY_LIMIT = 3;
const MAX_AGE_DAYS = 180;
const ENABLE_AGE_FILTER = true;

// --------------------
// Google News RSS URL
// --------------------
function googleNewsRssUrl(query, hl = "ja", gl = "JP", ceid = "JP:ja") {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

// --------------------
// RSS 定義
// --------------------
const FEEDS = [

{
  name: "関西ペイント",
  urls: [
    googleNewsRssUrl('(関西ペイント OR "Kansai Paint")'),
    googleNewsRssUrl(
      '(関西ペイント OR "Kansai Paint") (自動車 OR automotive OR OEM OR refinish OR 塗料 OR paint OR coating)'
    )
  ]
},

{
  name: "日本ペイント",
  url: googleNewsRssUrl(
    '(日本ペイント OR "Nippon Paint" OR ニッペ) (自動車 OR automotive OR OEM OR refinish OR 塗料 OR paint OR coating)'
  )
},

{
  name: "BASF",
  url: googleNewsRssUrl(
    '("BASF Coatings" OR BASF) (automotive OR OEM OR coating OR paint)'
  )
},

// --------------------
// 追加企業
// --------------------

{
  name: "PPG",
  url: googleNewsRssUrl(
    '(PPG coatings OR "PPG automotive") (automotive OR coating OR paint OR refinish)'
  )
},

{
  name: "Toyota",
  url: googleNewsRssUrl(
    '(Toyota OR トヨタ) (automotive paint OR coating OR 塗装 OR color OR design)'
  )
},

{
  name: "Mercedes-Benz",
  url: googleNewsRssUrl(
    '(Mercedes-Benz OR メルセデス) (automotive paint OR coating OR color OR design)'
  )
},

{
  name: "BMW",
  url: googleNewsRssUrl(
    '(BMW) (automotive paint OR coating OR color OR design)'
  )
}

];

// ==============================
// ユーティリティ
// ==============================

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
  if (Number.isNaN(t)) return true;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";
  const key = `${source}|${normTitle(title)}`;
  return { key, source, title, link, pubDate };
}

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

// ==============================
// コア
// ==============================

async function buildNewsJson(perCompanyLimit = 3) {

  const parser = new Parser({ timeout: 20000 });
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const result = {};

  for (const f of FEEDS) {

    let items = [];

    try {

      const urls = f.urls ?? [f.url];

      for (const u of urls) {
        const feed = await parser.parseURL(u);
        items.push(...(feed.items || []).map(it => normalizeItem(f.name, it)));
      }

      console.log(`[INFO] ${f.name} items: ${items.length}`);

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
    const chosen = uniq.slice(0, perCompanyLimit);

    result[f.name] = chosen.map(it => ({
      date: parseDateToISO10(it.pubDate) || todayJst,
      title: it.title,
      url: it.link
    }));

  }

  return result;
}

// ==============================
// main
// ==============================

async function main() {

  const data = await buildNewsJson(PER_COMPANY_LIMIT);

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(
    "OK: wrote",
    OUT_PATH,
    "companies:",
    Object.keys(data).join(", ")
  );

}

main().catch(e => {
  console.error("FAILED:", e);
  process.exit(1);
});
