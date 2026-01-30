import Parser from "rss-parser";
import nodemailer from "nodemailer";

/*
Required secrets:
- MAIL_TO
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS

Optional:
- MAIL_FROM (default: SMTP_USER)
*/

const {
  MAIL_TO,
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS
} = process.env;

// --------------------
// 必須チェック
// --------------------
function must(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

must(MAIL_TO, "MAIL_TO");
must(SMTP_HOST, "SMTP_HOST");
must(SMTP_PORT, "SMTP_PORT");
must(SMTP_USER, "SMTP_USER");
must(SMTP_PASS, "SMTP_PASS");

const FROM = MAIL_FROM || SMTP_USER;

// --------------------
// RSS 定義（3社）
// --------------------
const FEEDS = [
  {
    name: "関西ペイント",
    url: "https://news.google.com/rss/search?q=(関西ペイント OR Kansai Paint) (塗料 OR coating OR paint OR 顔料 OR pigment)&hl=ja&gl=JP&ceid=JP:ja"
  },
  {
    name: "日本ペイント",
    url: "https://news.google.com/rss/search?q=(日本ペイント OR Nippon Paint) (塗料 OR coating OR paint OR 顔料 OR pigment)&hl=ja&gl=JP&ceid=JP:ja"
  },
  {
    name: "BASF",
    url: "https://news.google.com/rss/search?q=(BASF) (coatings OR coating OR paint OR pigment)&hl=ja&gl=JP&ceid=JP:ja"
  }
];

// --------------------
// Utility
// --------------------
function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";

  // 重複判定キー
  const key = link || `title:${title}`;

  return {
    key,
    source,
    title,
    link,
    pubDate
  };
}

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

// --------------------
// RSS 取得＆整理
// --------------------
async function fetchAll() {
  const parser = new Parser({ timeout: 20000 });
  const collected = [];

  for (const feed of FEEDS) {
    try {
      const res = await parser.parseURL(feed.url);
      const items = (res.items || []).map((it) =>
        normalizeItem(feed.name, it)
      );
      collected.push(...items);
    } catch (e) {
      console.error(`[WARN] RSS failed: ${feed.name}`, e.message);
    }
  }

  // 1次重複除去（link / title）
  const uniqueMap = new Map();
  for (const it of collected) {
    if (!it.title) continue;
    if (!uniqueMap.has(it.key)) uniqueMap.set(it.key, it);
  }

  const unique = Array.from(uniqueMap.values()).sort(sortByDateDesc);

  // --------------------
  // 各社 最新2件まで
  // --------------------
  const PER_COMPANY_LIMIT = 2;
  const grouped = {};

  for (const it of unique) {
    if (!grouped[it.source]) grouped[it.source] = [];
    if (grouped[it.source].length < PER_COMPANY_LIMIT) {
      grouped[it.source].push(it);
    }
  }

  // フラット化（全体は日付順）
  return Object.values(grouped).flat().sort(sortByDateDesc);
}

// --------------------
// メール本文作成
// --------------------
function buildMailBody(items) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  if (!items.length) {
    return `📰 塗料業界ニュース（${today}）

本日は該当ニュースが見つかりませんでした。
`;
  }

  const lines = [];
  lines.push(`📰 塗料業界ニュース（${today})`);
  lines.push("");

  let currentSource = "";
  items.forEach((it, idx) => {
    if (it.source !== currentSource) {
      currentSource = it.source;
      lines.push(`▼ ${currentSource}`);
    }

    lines.push(`【${idx + 1}】${it.title}`);
    if (it.pubDate) lines.push(`日付：${it.pubDate}`);
    if (it.link) lines.push(`URL：${it.link}`);
    lines.push("");
  });

  return lines.join("\n");
}

// --------------------
// メール送信
// --------------------
async function sendMail(subject, body) {
  const port = Number(SMTP_PORT);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from: FROM,
    to: MAIL_TO,
    subject,
    text: body
  });

  return info.messageId;
}

// --------------------
// main
// --------------------
async function main() {
  const items = await fetchAll();
  const body = buildMailBody(items);

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const subject = `塗料業界ニュース ${today}`;

  const messageId = await sendMail(subject, body);
  console.log("Mail sent:", messageId);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
