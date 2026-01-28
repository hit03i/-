// src/main.js
import Parser from "rss-parser";
import nodemailer from "nodemailer";
import fetch from "node-fetch"; // ★ 追加：Google News RSS 403/429対策でfetch経由にする

// =========================
// 0) 実行環境・挙動設定（必要なら env で上書き可）
// =========================
const CONFIG = {
  LIMIT_PER_COMPANY: Number(process.env.LIMIT_PER_COMPANY || 3),
  // 何も取れなかった時にメールを送るか（false推奨）
  SEND_IF_EMPTY: (process.env.SEND_IF_EMPTY || "false").toLowerCase() === "true",
  // HTMLメールも送る（true推奨）
  SEND_HTML: (process.env.SEND_HTML || "true").toLowerCase() === "true",
  // RSSの取得リトライ回数
  RSS_RETRY: Number(process.env.RSS_RETRY || 2),
  // RSSのタイムアウト(ms)
  RSS_TIMEOUT_MS: Number(process.env.RSS_TIMEOUT_MS || 20000),
  // JST表示
  TZ: process.env.TZ || "Asia/Tokyo",
};

const parser = new Parser({
  timeout: CONFIG.RSS_TIMEOUT_MS,
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

// 市場調査/レポート系は除外
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
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// =========================
// ★ 追加：Google News RSS を fetch→parseString で取得（403/429対策）
// =========================
async function fetchRssXml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.RSS_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
        Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function parseFeedWithRetry(url, retries = CONFIG.RSS_RETRY) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const xml = await fetchRssXml(url);
      return await parser.parseString(xml);
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      console.log(`RSS retry ${i + 1}/${retries + 1} failed: ${msg}`);
      // 429/一時障害っぽい時は少し待つ
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

async function fetchLatest(feed, limit = CONFIG.LIMIT_PER_COMPANY) {
  // ★ 変更：parser.parseURL(feed.url) → fetch+parseString
  const parsed = await parseFeedWithRetry(feed.url);

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
  const nowJST = new Date().toLocaleString("ja-JP", { timeZone: CONFIG.TZ });

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

// ★ 追加：HTMLメールも作る（見やすい＆改行崩れ防止）
function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml(resultsByCompany) {
  const nowJST = new Date().toLocaleString("ja-JP", { timeZone: CONFIG.TZ });

  const sections = resultsByCompany
    .map((r) => {
      if (!r.items.length) {
        return `<h3 style="margin:16px 0 6px;">■ ${escapeHtml(r.company)}</h3><div>(該当なし)</div>`;
      }

      const lis = r.items
        .map((it, idx) => {
          const d = it.date.toISOString();
          return `
            <li style="margin:10px 0;">
              <div><b>[${idx + 1}] ${escapeHtml(it.title)}</b></div>
              <div style="font-size:12px; color:#555;">${escapeHtml(d)}</div>
              <div><a href="${escapeHtml(it.link)}">${escapeHtml(it.link)}</a></div>
            </li>
          `;
        })
        .join("");

      return `<h3 style="margin:16px 0 6px;">■ ${escapeHtml(r.company)}</h3><ul style="padding-left:18px; margin-top:6px;">${lis}</ul>`;
    })
    .join("");

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height:1.5;">
      <div style="font-size:18px; font-weight:700;">塗料業界ニュース（自動配信）</div>
      <div style="color:#666; margin:6px 0 14px;">${escapeHtml(nowJST)}</div>
      ${sections}
      <hr style="margin:18px 0; border:none; border-top:1px solid #ddd;" />
      <div style="font-size:12px; color:#888;">Sent by GitHub Actions</div>
    </div>
  `;
}

function countAllItems(resultsByCompany) {
  return resultsByCompany.reduce((sum, r) => sum + (r.items?.length || 0), 0);
}

async function sendMailOrLog(bodyText, bodyHtml, totalItems) {
  const { SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

  // Secrets チェック（値は出さない）
  console.log("SMTP_USER set:", !!SMTP_USER);
  console.log("SMTP_PASS set:", !!SMTP_PASS);
  console.log("MAIL_TO set:", !!MAIL_TO);
  console.log("MAIL_FROM set:", !!MAIL_FROM);
  console.log("Total items:", totalItems);
  console.log("SEND_IF_EMPTY:", CONFIG.SEND_IF_EMPTY);
  console.log("SEND_HTML:", CONFIG.SEND_HTML);

  if (!SMTP_USER || !SMTP_PASS || !MAIL_TO || !MAIL_FROM) {
    console.log("SMTP secrets missing -> skip email sending.");
    return;
  }

  // 0件なら送らない（スパム化防止）
  if (!CONFIG.SEND_IF_EMPTY && totalItems === 0) {
    console.log("No news items -> skip email sending (SEND_IF_EMPTY=false).");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const mail = {
    from: MAIL_FROM,
    to: MAIL_TO,
    subject: "塗料業界ニュース（GitHub Actions）",
    text: bodyText,
  };

  if (CONFIG.SEND_HTML) {
    mail.html = bodyHtml;
  }

  await transporter.sendMail(mail);

  console.log("Email successfully sent to:", MAIL_TO);
}

async function main() {
  console.log("=== Paint Industry News Bot (RSS + Email) ===");
  console.log("Node:", process.version);
  console.log("TZ:", CONFIG.TZ);

  const resultsByCompany = [];

  for (const feed of FEEDS) {
    console.log("\n----------------------------------------");
    console.log(`■ ${feed.name}`);
    console.log(`RSS: ${feed.url}`);

    try {
      const items = await fetchLatest(feed, CONFIG.LIMIT_PER_COMPANY);
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

  const totalItems = countAllItems(resultsByCompany);

  const emailText = buildEmailText(resultsByCompany);
  const emailHtml = buildEmailHtml(resultsByCompany);

  await sendMailOrLog(emailText, emailHtml, totalItems);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});

const { SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

console.log("SMTP_USER set:", !!SMTP_USER);
console.log("SMTP_PASS set:", !!SMTP_PASS);
console.log("MAIL_TO:", MAIL_TO || "(empty)");
console.log("MAIL_FROM:", MAIL_FROM || "(empty)");

if (!SMTP_USER || !SMTP_PASS || !MAIL_TO || !MAIL_FROM) {
  console.log("SMTP secrets missing -> skip email sending.");
} else {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const lines = (allItems || [])
    .slice(0, 10)
    .map((it, i) => `[${i + 1}] ${it.title}\n${it.date?.toISOString?.() || ""}\n${it.link}\n`)
    .join("\n");

  const body = `塗料業界ニュース（GitHub Actions）\n${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n\n${lines}`;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    subject: "塗料業界ニュース（GitHub Actions）",
    text: body,
  });

  console.log("Email successfully sent to:", MAIL_TO);
}
// 

