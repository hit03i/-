// src/main.js
// Per-company latest 3 news (date desc). No mixed "Top 10" section.

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "NewsBot/1.0" },
});

// 会社ごとのRSS（必要ならURLはあなたのものに合わせてOK）
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

// 必須ワード（ここに当たらない記事は捨てる）
const REQUIRED = ["塗料", "コーティング", "塗装", "paint", "coating"];

// 市場調査/レポート系を強めに除外（ログで混ざってたので増やしています）
const EXCLUDE = [
  "市場調査",
  "市場規模",
  "レポート",
  "ランキング",
  "シェア",
  "予測",
  "見通し",
  "成長分析",
  "需要",
  "トレンド",
  "CAGR",
  "market",
  "report",
  "forecast",
  "size",
  "share",
];

function norm(s) {
  return (s || "").toLowerCase().trim();
}
function containsAny(text, keywords) {
  const t = norm(text);
  return keywords.some((k) => t.includes(norm(k)));
}
function toDate(d) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function dedupeByLink(items) {
  const seen = new Set();
  return items.filter((x) => {
    const key = norm(x.link) || norm(x.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchLatest3(feed) {
  const parsed = await parser.parseURL(feed.url);

  let items = (parsed.items || [])
    .map((it) => ({
      company: feed.name,
      title: (it.title || "").trim(),
      link: (it.link || "").trim(),
      date: toDate(it.pubDate || it.isoDate),
    }))
    .filter((x) => x.title && x.link && x.date);

  // フィルタ
  items = items.filter((x) => {
    if (!containsAny(x.title, REQUIRED)) return false;
    if (containsAny(x.title, EXCLUDE)) return false;
    return true;
  });

  // 同一会社内の重複排除
  items = dedupeByLink(items);

  // 日付の新しい順
  items.sort((a, b) => b.date - a.date);

  // 最新3件だけ
  return items.slice(0, 3);
}

async function main() {
  console.log("=== Paint Industry News Bot (per company latest 3) ===");

  for (const feed of FEEDS) {
    console.log("\n----------------------------------------");
    console.log(`■ ${feed.name}`);

    try {
      const top3 = await fetchLatest3(feed);

      if (top3.length === 0) {
        console.log("No items (after filtering).");
        continue;
      }

      top3.forEach((n, i) => {
        console.log(`\n[${i + 1}] ${n.title}`);
        console.log(`  Date: ${n.date.toISOString()}`);
        console.log(`  URL : ${n.link}`);
      });
    } catch (e) {
      console.log(`ERROR: ${e?.message || e}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
