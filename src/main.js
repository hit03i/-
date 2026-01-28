// src/main.js
// Step1: Read multiple Google News RSS feeds and print latest items per company

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsBot/1.0",
  },
});

// 会社別のGoogle News RSS（検索クエリ）
const FEEDS = [
  {
    name: "関西ペイント",
    url: "https://news.google.com/rss/search?q=(%E9%96%A2%E8%A5%BF%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Kansai%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20paint%20OR%20coating)&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "日本ペイント",
    url: "https://news.google.com/rss/search?q=(%E6%97%A5%E6%9C%AC%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Nippon%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20paint%20OR%20coating)&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "BASF",
    url: "https://news.google.com/rss/search?q=(BASF)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20paint%20OR%20coating%20OR%20Coatings)&hl=ja&gl=JP&ceid=JP:ja",
  },
];

function toISODate(d) {
  try {
    return d ? new Date(d).toISOString() : "";
  } catch {
    return "";
  }
}

function keyOf(item) {
  // 重複判定用のキー（linkが一番安定）
  const link = (item.link || "").trim();
  const title = (item.title || "").trim();
  return link || title;
}

async function fetchFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  const items = (parsed.items || [])
    .map((it) => ({
      company: feed.name,
      title: (it.title || "").trim(),
      link: (it.link || "").trim(),
      pubDate: toISODate(it.pubDate || it.isoDate),
      source: (parsed.title || "").trim(),
    }))
    .filter((x) => x.title && x.link);

  // 新しい順っぽく並べ替え（pubDateが取れない場合はそのまま）
  items.sort((a, b) => {
    if (!a.pubDate || !b.pubDate) return 0;
    return b.pubDate.localeCompare(a.pubDate);
  });

  return items;
}

async function main() {
  console.log("=== Paint Industry News Bot (Step1: multi feeds) ===");

  // 3社を並列取得
  const results = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const items = await fetchFeed(f);
        return { feed: f, items, error: null };
      } catch (e) {
        return { feed: f, items: [], error: e?.message || String(e) };
      }
    })
  );

  // 表示：各社 最新N件
  const PER_COMPANY = 5;

  for (const r of results) {
    console.log("\n----------------------------------------");
    console.log(`■ ${r.feed.name}`);
    console.log(`RSS: ${r.feed.url}`);

    if (r.error) {
      console.log(`ERROR: ${r.error}`);
      continue;
    }

    if (r.items.length === 0) {
      console.log("No items.");
      continue;
    }

    const top = r.items.slice(0, PER_COMPANY);
    console.log(`Fetched ${r.items.length} items. Showing latest ${top.length}.`);

    for (const [i, it] of top.entries()) {
      console.log(`\n[${i + 1}] ${it.title}`);
      if (it.pubDate) console.log(`  Date: ${it.pubDate}`);
      console.log(`  URL : ${it.link}`);
    }
  }

  // 参考：3社をまとめた重複排除一覧も出しておく（後のStep3に繋がる）
  console.log("\n========================================");
  console.log("All unique items (deduped by link) - Top 10");
  const all = results.flatMap((r) => r.items);
  const seen = new Set();
  const deduped = [];
  for (const it of all) {
    const k = keyOf(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }
  deduped.sort((a, b) => {
    if (!a.pubDate || !b.pubDate) return 0;
    return b.pubDate.localeCompare(a.pubDate);
  });

  for (const [i, it] of deduped.slice(0, 10).entries()) {
    console.log(`\n[${i + 1}] (${it.company}) ${it.title}`);
    if (it.pubDate) console.log(`  Date: ${it.pubDate}`);
    console.log(`  URL : ${it.link}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
