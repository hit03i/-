import Parser from "rss-parser";
import fs from "fs";

// ==============================
// 設定（掲示板向け：安定優先）
// ==============================

// GitHub Pages: index.html が fetch('news.json') するため、リポジトリ直下に出力
const OUT_PATH = "news.json";

// 会社ごとの表示件数（最大）
const PER_COMPANY_LIMIT = 3;

// 直近何日分を対象にするか（週次なら60〜180が安定）
const MAX_AGE_DAYS = 180;

// 「古い記事を切る」スイッチ（空になる切り分け用）
const ENABLE_AGE_FILTER = true;

// --------------------
// Google News RSS URL を安全に生成
// --------------------
function googleNewsRssUrl(query, hl = "ja", gl = "JP", ceid = "JP:ja") {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

// --------------------
// RSS 定義（3社）
// コツ：
// - “自動車×塗料”に寄せたいが、ANDで縛りすぎると0件になりやすい
// - 除外語（-市場等）は一旦入れない（効きすぎて0件になりやすい）
// --------------------
const FEEDS = [
 {
  name: "関西ペイント",
  urls: [
    // ① 広く拾う（これが保険で効く）
    googleNewsRssUrl('(関西ペイント OR "Kansai Paint")'),
    // ② 自動車×塗料寄り（取れたら混ぜる）
    googleNewsRssUrl(
      '(関西ペイント OR "Kansai Paint") (自動車 OR automotive OR OEM OR refinish OR 塗料 OR paint OR coating OR コーティング)'
    )
  ]
},
  {
    name: "日本ペイント",
    url: googleNewsRssUrl(
      '(日本ペイント OR "Nippon Paint" OR ニッペ) (自動車 OR automotive OR OEM OR refinish OR 車両 OR 塗料 OR paint OR coating OR コーティング)'
    )
  },
  {
    name: "BASF",
    url: googleNewsRssUrl(
      '("BASF Coatings" OR "BASF automotive" OR BASF) (automotive OR OEM OR refinish OR coating OR paint)'
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
  if (Number.isNaN(t)) return true; // 日付が怪しい場合は通す（空にならないため）
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";

  // Google Newsは同一記事でもURLが変わることがあるので
  // 「タイトル正規化 + ソース」で軽く安定させる（過剰な既出管理はしない）
  const key = `${source}|${normTitle(title)}`;

  return { key, source, title, link, pubDate };
}

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

// ==============================
// コア：会社ごとに取得して、毎回「最新N件」を出す（空回避）
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
      const feed = await parser.parseURL(f.url);
      const count = (feed.items || []).length;
      console.log(`[INFO] ${f.name} items: ${count}`);
      items = (feed.items || []).map((it) => normalizeItem(f.name, it));
    } catch (e) {
      console.error(`[WARN] RSS failed: ${f.name}`, e?.message || e);
      items = [];
    }

    // 会社内で「タイトル重複」を消しつつ、日付フィルタ → 新しい順 → 上からN件
    const map = new Map();
    for (const it of items) {
      if (!it.title) continue;
      if (!withinMaxAge(it.pubDate)) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }

    const uniq = Array.from(map.values()).sort(sortByDateDesc);

    const chosen = uniq.slice(0, perCompanyLimit);

    result[f.name] = chosen.map((it) => ({
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
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log("OK: wrote", OUT_PATH, "companies:", Object.keys(data).join(", "));
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
