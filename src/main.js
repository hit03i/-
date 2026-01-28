// src/main.js
// Step1 (refined): Multi-company Google News RSS -> filter to paint/coating + (auto / anticorrosion / building)
// - Exclude market report noise
// - Print latest per company + all-company deduped list

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsBot/1.0",
  },
});

/**
 * Google News RSS feeds (company + paint-related context)
 * Tips:
 * - We keep query reasonably broad, then apply strict keyword filtering in code
 * - Add negative keywords to reduce "market report" noise
 */
const FEEDS = [
  {
    name: "関西ペイント",
    url: "https://news.google.com/rss/search?q=(%E9%96%A2%E8%A5%BF%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Kansai%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)%20-%E5%B8%82%E5%A0%B4%20-%E8%AA%BF%E6%9F%BB%20-%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%20-%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%B0%20-%E4%BA%88%E6%B8%AC%20-%E8%A6%8B%E9%80%9A%E3%81%97&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "日本ペイント",
    url: "https://news.google.com/rss/search?q=(%E6%97%A5%E6%9C%AC%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Nippon%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)%20-%E5%B8%82%E5%A0%B4%20-%E8%AA%BF%E6%9F%BB%20-%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%20-%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%B0%20-%E4%BA%88%E6%B8%AC%20-%E8%A6%8B%E9%80%9A%E3%81%97&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    name: "BASF",
    url: "https://news.google.com/rss/search?q=(BASF%20Coatings%20OR%20BASF%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20BASF)%20(%E5%A1%97%E6%96%99%20OR%20%E3%82%B3%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%20OR%20%E5%A1%97%E8%A3%85%20OR%20paint%20OR%20coating)%20-%E5%B8%82%E5%A0%B4%20-%E8%AA%BF%E6%9F%BB%20-%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%20-%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%B0%20-%E4%BA%88%E6%B8%AC%20-%E8%A6%8B%E9%80%9A%E3%81%97&hl=ja&gl=JP&ceid=JP:ja",
  },
];

// ---- Filtering rules ----

// 必須：塗料/コーティング/塗装関連（どれか1つでも含む）
const REQUIRED_TOPIC_KEYWORDS = [
  "塗料",
  "コーティング",
  "塗装",
  "paint",
  "coating",
];

// 追加で「自動車塗料・防食・建築系」などを狙う（どれか1つでも含めばOK）
// ※ここは“必須ではなく”スコア加点に使う（厳しすぎて記事が減りすぎるのを防ぐ）
const PREFERRED_DOMAIN_KEYWORDS = [
  "自動車",
  "自動車塗料",
  "車体",
  "OEM",
  "防食",
  "重防食",
  "防錆",
  "耐食",
  "橋梁",
  "鋼構造",
  "船舶",
  "建築",
  "外壁",
  "内装",
  "建材",
  "建設",
];

// ノイズ除外（市場調査・ランキング・予測・レポート系）
const EXCLUDE_KEYWORDS = [
  "市場調査",
  "市場規模",
  "レポート",
  "ランキング",
  "シェア",
  "予測",
  "見通し",
  "市場",
  "CAGR",
  "forecast",
  "market",
  "report",
];

// 追加ノイズ（必要なら増やす）
// const EXCLUDE_SOURCES = ["newscast.jp", "ニコニコニュース"]; // タイトルや出典で除外したい場合に使用

function toISODate(d) {
  try {
    return d ? new Date(d).toISOString() : "";
  } catch {
    return "";
  }
}

function containsAny(text, keywords) {
  const t = (text || "").toLowerCase();
  return keywords.some((k) => t.includes(String(k).toLowerCase()));
}

function preferenceScore(title) {
  // 好ましいドメイン語が入っているほど上に出るようにする簡易スコア
  const t = (title || "").toLowerCase();
  let score = 0;

  for (const k of PREFERRED_DOMAIN_KEYWORDS) {
    if (t.includes(String(k).toLowerCase())) score += 1;
  }

  // 例：自動車塗料は強めに上げたい
  if (t.includes("自動車塗料")) score += 2;
  if (t.includes("防食") || t.includes("重防食") || t.includes("防錆")) score += 2;
  if (t.includes("建築") || t.includes("外壁") || t.includes("建材")) score += 1;

  return score;
}

function keyOf(item) {
  return (item.link || "").trim() || (item.title || "").trim();
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

  // フィルタ：必須トピック + ノイズ除外
  const filtered = items.filter((x) => {
    const title = x.title;

    // 必須（塗料/コーティング/塗装/paint/coating）
    if (!containsAny(title, REQUIRED_TOPIC_KEYWORDS)) return false;

    // ノイズ除外（市場調査など）
    if (containsAny(title, EXCLUDE_KEYWORDS)) return false;

    return true;
  });

  // 並べ替え：
  // 1) preferenceScore 高い順（自動車・防食・建築に寄せる）
  // 2) pubDate 新しい順
  filtered.sort((a, b) => {
    const sa = preferenceScore(a.title);
    const sb = preferenceScore(b.title);
    if (sb !== sa) return sb - sa;

    if (a.pubDate && b.pubDate) return b.pubDate.localeCompare(a.pubDate);
    if (b.pubDate) return 1;
    if (a.pubDate) return -1;
    return 0;
  });

  return filtered;
}

async function main() {
  console.log("=== Paint Industry News Bot (Step1: filtered) ===");
  console.log("Required:", REQUIRED_TOPIC_KEYWORDS.join(", "));
  console.log("Preferred (boost):", PREFERRED_DOMAIN_KEYWORDS.join(", "));
  console.log("Exclude:", EXCLUDE_KEYWORDS.join(", "));

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
      console.log("No items (after filtering).");
      continue;
    }

    const top = r.items.slice(0, PER_COMPANY);
    console.log(`Fetched ${r.items.length} items (after filtering). Showing top ${top.length}.`);

    for (const [i, it] of top.entries()) {
      console.log(`\n[${i + 1}] ${it.title}`);
      console.log(`  Score: ${preferenceScore(it.title)}`);
      if (it.pubDate) console.log(`  Date : ${it.pubDate}`);
      console.log(`  URL  : ${it.link}`);
    }
  }

  // 3社まとめ（重複排除）Top 10
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

  // まとめ側も同じソート（優先ドメイン→新しさ）
  deduped.sort((a, b) => {
    const sa = preferenceScore(a.title);
    const sb = preferenceScore(b.title);
    if (sb !== sa) return sb - sa;

    if (a.pubDate && b.pubDate) return b.pubDate.localeCompare(a.pubDate);
    if (b.pubDate) return 1;
    if (a.pubDate) return -1;
    return 0;
  });

  for (const [i, it] of deduped.slice(0, 10).entries()) {
    console.log(`\n[${i + 1}] (${it.company}) ${it.title}`);
    console.log(`  Score: ${preferenceScore(it.title)}`);
    if (it.pubDate) console.log(`  Date : ${it.pubDate}`);
    console.log(`  URL  : ${it.link}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
