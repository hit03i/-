import Parser from "rss-parser";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

// ==============================
// 月曜以外は送信しない安全装置
// ==============================
const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const jstDay = jst.getDay(); // 0=日, 1=月, 2=火 ...
if (jstDay !== 1) {
  console.log("Not Monday JST. Skip sending.", jst.toISOString());
  process.exit(0);
}
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

// ====== 履歴ファイル（Actions Cacheで永続化する） ======
const DATA_DIR = "data";
const SENT_PATH = path.join(DATA_DIR, "sent.json");

// どれくらい履歴を保持するか（肥大化防止）
// 例えば90日分だけ残す
const KEEP_DAYS = 90;

// --------------------
// Google News RSS URL を安全に生成
// --------------------
function googleNewsRssUrl(query, hl = "ja", gl = "JP", ceid = "JP:ja") {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

// --------------------
// RSS 定義（3社）
// --------------------
const FEEDS = [
  {
    name: "関西ペイント",
    url: googleNewsRssUrl(
      "(関西ペイント OR Kansai Paint) (塗料 OR コーティング OR paint OR coating OR 顔料 OR pigment)"
    )
  },
  {
    name: "日本ペイント",
    url: googleNewsRssUrl(
      "(日本ペイント OR Nippon Paint) (塗料 OR コーティング OR paint OR coating OR 顔料 OR pigment)"
    )
  },
  {
    name: "BASF",
    url: googleNewsRssUrl("(BASF) (coatings OR coating OR paint OR pigment)")
  }
];

function sortByDateDesc(a, b) {
  const da = Date.parse(a.pubDate || "") || 0;
  const db = Date.parse(b.pubDate || "") || 0;
  return db - da;
}

function normTitle(t) {
  return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeItem(source, item) {
  const title = (item.title || "").trim();
  const link = (item.link || "").trim();
  const pubDate = item.isoDate || item.pubDate || "";

  // 送信済み判定キー（会社単位で保持）
  const key = `${source}|${link || `title:${title}`}`;

  return { key, source, title, link, pubDate };
}

// ====== 送信済み履歴の読み書き ======
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSent() {
  try {
    if (!fs.existsSync(SENT_PATH)) return {};
    const raw = fs.readFileSync(SENT_PATH, "utf-8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function pruneSent(sentObj) {
  // sentObj: { [key]: "YYYY-MM-DD" }
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const pruned = {};
  for (const [k, v] of Object.entries(sentObj || {})) {
    const t = Date.parse(v) || 0;
    if (t >= cutoff) pruned[k] = v;
  }
  return pruned;
}

function saveSent(sentObj) {
  ensureDataDir();
  fs.writeFileSync(SENT_PATH, JSON.stringify(sentObj, null, 2), "utf-8");
}

// --------------------
// 会社ごとに候補を取り、送信済みを除外して最新2件選ぶ
// --------------------
async function fetchPerCompanyLatestAvoidSent(perCompanyLimit = 2) {
  const parser = new Parser({ timeout: 20000 });

  // 送信済み履歴
  let sent = pruneSent(loadSent());

  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const picked = [];

  for (const f of FEEDS) {
    let items = [];
    try {
      const feed = await parser.parseURL(f.url);
      items = (feed.items || []).map((it) => normalizeItem(f.name, it));
    } catch (e) {
      console.error(`[WARN] RSS failed: ${f.name}`, e?.message || e);
      items = [];
    }

    // 会社内重複排除（key）
    const map = new Map();
    for (const it of items) {
      if (!it.title) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }
    const uniq = Array.from(map.values()).sort(sortByDateDesc);

    // 送信済み除外＋タイトル軽重複除外しながら2件選ぶ
    const seenTitle = new Set();
    const chosen = [];

    for (const it of uniq) {
      if (sent[it.key]) continue; // ★送信済みならスキップ
      const t = normTitle(it.title);
      if (seenTitle.has(t)) continue;
      seenTitle.add(t);
      chosen.push(it);
      if (chosen.length >= perCompanyLimit) break;
    }

    // 選んだものを履歴へ登録（次回送らない）
    for (const it of chosen) {
      sent[it.key] = todayJst;
    }

    picked.push(...chosen);
  }

  // 保存（Actions Cacheで永続化される想定）
  saveSent(sent);

  return picked.sort(sortByDateDesc);
}

// --------------------
// メール本文作成（1通に各社2件ずつ）
// --------------------
function buildMailBody(items) {
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const lines = [];
  lines.push(`📰 塗料業界ニュース（${todayJst}）`);
  lines.push("");

  const companyOrder = FEEDS.map((f) => f.name);
  const grouped = {};
  for (const c of companyOrder) grouped[c] = [];
  for (const it of items) {
    if (!grouped[it.source]) grouped[it.source] = [];
    grouped[it.source].push(it);
  }

  let globalIndex = 1;
  let any = false;

  for (const company of companyOrder) {
    const list = grouped[company] || [];
    lines.push(`▼ ${company}`);

    if (list.length === 0) {
      lines.push("（新着なし：前回までに送信済み or 該当ニュースなし）");
      lines.push("");
      continue;
    }

    any = true;
    for (const it of list) {
      lines.push(`【${globalIndex}】${it.title}`);
      if (it.pubDate) lines.push(`日付：${it.pubDate}`);
      if (it.link) lines.push(`URL：${it.link}`);
      lines.push("");
      globalIndex += 1;
    }
  }

  if (!any) {
    return `📰 塗料業界ニュース（${todayJst}）\n\n今週は新着がありません（前回までに送信済み、または該当ニュースなし）。\n`;
  }

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

// --------------------
// main
// --------------------
async function main() {
  const items = await fetchPerCompanyLatestAvoidSent(2);

  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const subject = `塗料業界ニュース（週次） ${todayJst}`;
  const body = buildMailBody(items);

  const mid = await sendMail(subject, body);
  console.log("OK:", { count: items.length, messageId: mid });
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
