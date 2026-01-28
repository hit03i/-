// src/main.js
import Parser from "rss-parser";
import nodemailer from "nodemailer";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "NewsBot/1.0" },
});

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

// 必須ワード
const REQUIRED = ["塗料", "コーティング", "塗装", "paint", "coating"];

// 市場調査/レポート系は除外（あなたのログで多かったので強め）
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

async function fetchLatest(feed, limit = 3) {
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

  items = dedupeByLink(items);
  items.sort((a, b) => b.date - a.date);
  return items.slice(0, limit);
}

function buildEmailText(resultsByCompany) {
  const nowJST = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  let body = `塗料業界ニュース（自動配信）\n${nowJST}\n\n`;

  for (const r of resultsByCompany) {
    body += `■ ${r.company}\n`;
    if (!r.items.length) {
      body += `  (該当なし)\n\n`;
      continue;
    }
    r.items.forEach((it, idx) => {
      body += `  [${idx + 1}] ${it.title}\n`;
      body += `      ${it.date.toISOString()}\n`;
      body += `      ${it.link}\n`;
    });
    body += "\n";
  }

  return body;
}

async function sendMailOrLog(bodyText) {
  const { SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

  // まず Secrets が渡っているかをログで確認（値は出さない）
  console.log("SMTP_USER set:", !!SMTP_USER);
  console.log("SMTP_PASS set:", !!SMTP_PASS);
  console.log("MAIL_TO:", MAIL_TO || "(empty)");
  console.log("MAIL_FROM:", MAIL_FROM || "(empty)");

  if (!SMTP_USER || !SMTP_PASS || !MAIL_TO || !MAIL_FROM) {
    console.log("SMTP secrets missing -> skip email sending.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    subject: "塗料業界ニュース（GitHub Actions）",
    text: bodyText,
  });

  console.log("Email successfully sent to:", MAIL_TO);
}

async function main() {
  console.log("=== Paint Industry News Bot (RSS + Email) ===");

  const resultsByCompany = [];

  for (const feed of FEEDS) {
    console.log("\n----------------------------------------");
    console.log(`■ ${feed.name}`);
    console.log(`RSS: ${feed.url}`);

    try {
      const items = await fetchLatest(feed, 3);
      resultsByCompany.push({ company: feed.name, items });

      console.log(`Fetched ${items.length} items. Showing latest ${items.length}.`);
      items.forEach((it, i) => {
        console.log(`\n[${i + 1}] ${it.title}`);
        console.log(`  Date: ${it.date.toISOString()}`);
        console.log(`  URL : ${it.link}`);
      });
    } catch (e) {
      console.log(`ERROR: ${e?.message || e}`);
      resultsByCompany.push({ company: feed.name, items: [] });
    }
  }

  const emailText = buildEmailText(resultsByCompany);
  await sendMailOrLog(emailText);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
