// src/main.js
// Step1 final: Per-company latest 3 news (sorted by date, deduped)

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsBot/1.0",
  },
});

/* =========================
   Company RSS definitions
   ========================= */
const FEEDS = [
  {
    name: "関西ペイント",
    url: "https://news.google.com/rss/search?q=(%E9%96%A2%E8%A5%BF%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Kansai%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "日本ペイント",
    url: "https://news.google.com/rss/search?q=(%E6%97%A5%E6%9C%AC%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Nippon%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "BASF",
    url: "https://news.google.com/rss/search?q=(BASF%20Coatings%20OR%20BASF)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)&hl=ja&gl=JP&ceid=JP:ja",
  },
];

/* =========================
   Filtering rules
   ========================= */
const REQUIRED_KEYWORDS = ["塗料", "コーティング", "塗装", "paint", "coating"];

const EXCLUDE_KEYWORDS = [
  "市場調査",
  "市場規模",
  "レポート",
  "ランキング",
  "シェア",
  "予測",
  "見通し",
  "market",
  "report",
];

function normalize(text) {
  return (text || "").toLowerCase().trim();
}

function containsAny(text, keywords) {
  const t = normalize(text);
  return keywords.some((k) => t.includes(normalize(k)));
}

function toDate(d) {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

/* =========================
   Core logic
   ========================= */
async function fetchCompanyNews(feed) {
  const parsed = await parser.parseURL(feed.url);

  // 1. 整形
  let items = (parsed.items || []).map((it) => ({
    company: feed.name,
    title: it.title?.trim() || "",
    link: it.link?.trim() || "",
    date: toDate(it.pubDate || it.isoDate),
  }));

  // 2. 基本フィルタ
  items = items.filter(
    (x) =>
      x.title &&
      x.link &&
      x.date &&
      containsAny(x.title, REQUIRED_KEYWORDS) &&
      !containsAny(x.title, EXCLUDE_KEYWORDS)
  );

  // 3. 重複排除（同一会社内）
  const seen = new Set();
  items = items.filter((x) => {
    const key = normalize(x.link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. 日付降順
  items.sort((a, b) => b.date - a.date);

  // 5. 最新3件のみ
  return items.slice(0, 3);
}

async function main() {
  console.log("=== Paint Industry News Bot (per company latest 3) ===");

  for (const feed of FEEDS) {
    console.log("\n----------------------------------------");
    console.log(`■ ${feed.name}`);

    try {
      const news = await fetchCompanyNews(feed);

      if (news.length === 0) {
        console.log("No relevant news found.");
        continue;
      }

      news.forEach((n, i) => {
        console.log(`\n[${i + 1}] ${n.title}`);
        console.log(`  Date: ${n.date.toISOString()}`);
        console.log(`  URL : ${n.link}`);
      });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
