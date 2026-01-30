import Parser from "rss-parser";
import nodemailer from "nodemailer";

/**
 * =========================
 * 1) 設定（環境変数）
 * =========================
 * 必須:
 *  - MAIL_TO
 *  - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * 任意:
 *  - MAIL_FROM (未指定なら SMTP_USER)
 *  - MAX_ITEMS (未指定なら 8)
 */

const {
  MAIL_TO,
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAX_ITEMS
} = process.env;

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
const LIMIT = Number(MAX_ITEMS || 8);

// ここにRSSを足していく（まずは少数で安定させる）
const FEEDS = [
  {
    name: "関西ペイント",
    url: "https://news.google.com/rss/search?q=(%E9%96%A2%E8%A5%BF%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Kansai%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20coating%20OR%20paint%20OR%20%E9%A1%94%E6%96%99%20OR%20pigment)&hl=ja&gl=JP&ceid=JP:ja"
  },
  {
    name: "日本ペイント",
    url: "https://news.google.com/rss/search?q=(%E6%97%A5%E6%9C%AC%E3%83%9A%E3%82%A4%E3%83%B3%E3%83%88%20OR%20Nippon%20Paint)%20(%E5%A1%97%E6%96%99%20OR%20coating%20OR%20paint%20OR%20%E9%A1%94%E6%96%99%20OR%20pigment)&hl=ja&gl=JP&ceid=JP:ja"
  }
];

// GoogleニュースRSSは item.link が “ニュース経由URL” だったりするので、最低限の整形
function normalizeItem(feedName, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";
  const source = feedName;

  // 重複除去キー：link優先、無ければ title
  const key = link ? link : `title:${title}`;

  return { key, source, title, link, pubDate };
}

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

// メール本文（テキスト）を作る：空メール防止で最低1行は必ず出す
function buildMailBody(items) {
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);

  if (!items.length) {
    return `📰 塗料業界ニュース（${ymd}）\n\n本日は該当ニュースが見つかりませんでした。\n`;
  }

  const lines = [];
  lines.push(`📰 塗料業界ニュース（${ymd}）`);
  lines.push("");
  items.forEach((it, idx) => {
    lines.push(`【${idx + 1}】${it.title}`);
    lines.push(`出典：${it.source}`);
    if (it.pubDate) lines.push(`日付：${it.pubDate}`);
    if (it.link) lines.push(`URL：${it.link}`);
    lines.push("");
  });
  return lines.join("\n");
}

async function fetchAll() {
  const parser = new Parser({ timeout: 20000 });
  const all = [];

  for (const f of FEEDS) {
    try {
      const feed = await parser.parseURL(f.url);
      const items = (feed.items || []).map((it) => normalizeItem(f.name, it));
      all.push(...items);
    } catch (e) {
      // 1フィード死んでも全体は続行（Actions失敗にしない）
      console.error(`[WARN] feed failed: ${f.name}`, e?.message || e);
    }
  }

  // 重複排除
  const map = new Map();
  for (const it of all) {
    if (!it.title) continue;
    if (!map.has(it.key)) map.set(it.key, it);
  }

  const uniq = Array.from(map.values()).sort(sortByDateDesc);

  // タイトルでもう一段ゆるく重複排除（Googleニュースでlinkが揺れる時対策）
  const titleSet = new Set();
  const final = [];
  for (const it of uniq) {
    const tkey = it.title.replace(/\s+/g, " ").trim();
    if (titleSet.has(tkey)) continue;
    titleSet.add(tkey);
    final.push(it);
    if (final.length >= LIMIT) break;
  }

  return final;
}

async function sendMail(subject, body) {
  const port = Number(SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465ならtrue、それ以外はfalseが基本
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const info = await transporter.sendMail({
    from: FROM,
    to: MAIL_TO,
    subject,
    text: body
  });

  return info.messageId || "sent";
}

async function main() {
  const items = await fetchAll();
  const body = buildMailBody(items);

  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const ymd = jst.toISOString().slice(0, 10);
  const subject = `塗料業界ニュース ${ymd}`;

  const mid = await sendMail(subject, body);
  console.log("OK:", { count: items.length, messageId: mid });
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
