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
// Google News RSS URL を安全に生成（日本語/スペース/括弧を自動エンコード）
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

// --------------------
// Utility
// --------------------
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

  // ★重要：source をキーに含める（会社を跨いで重複排除しない）
  const key = `${source}|${link || `title:${title}`}`;

  return { key, source, title, link, pubDate };
}

// --------------------
// 会社ごとに最新2件を取得（会社間で消えない設計）
// --------------------
async function fetchPerCompanyLatest(perCompanyLimit = 2) {
  const parser = new Parser({ timeout: 20000 });

  // 会社ごとの配列
  const byCompany = {};
  for (const f of FEEDS) byCompany[f.name] = [];

  // 会社ごとに取得
  for (const f of FEEDS) {
    try {
      const feed = await parser.parseURL(f.url);

      // デバッグしたいときはこの1行をコメント解除
      // console.log("[DEBUG] items:", f.name, (feed.items || []).length);

      const items = (feed.items || []).map((it) => normalizeItem(f.name, it));
      byCompany[f.name].push(...items);
    } catch (e) {
      console.error(`[WARN] RSS failed: ${f.name}`, e?.message || e);
    }
  }

  // 会社ごとに：重複排除→新しい順→タイトル重複も軽く排除→上位2件
  const picked = [];

  for (const company of Object.keys(byCompany)) {
    const raw = byCompany[company] || [];

    // 1) key（会社内）で重複排除
    const map = new Map();
    for (const it of raw) {
      if (!it.title) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }
    const uniq = Array.from(map.values()).sort(sortByDateDesc);

    // 2) タイトルで軽く重複排除（Googleニュースの微妙な揺れ対策）
    const seenTitle = new Set();
    const final = [];
    for (const it of uniq) {
      const t = normTitle(it.title);
      if (seenTitle.has(t)) continue;
      seenTitle.add(t);
      final.push(it);
      if (final.length >= perCompanyLimit) break;
    }

    picked.push(...final);
  }

  // メール全体は日付順に並べる
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

  // 会社ごとにまとめる
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
      lines.push("（該当ニュースなし）");
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
    return `📰 塗料業界ニュース（${todayJst}）\n\n本日は該当ニュースが見つかりませんでした。\n`;
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
  const items = await fetchPerCompanyLatest(2);

  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const subject = `塗料業界ニュース ${todayJst}`;
  const body = buildMailBody(items);

  const mid = await sendMail(subject, body);
  console.log("OK:", { count: items.length, messageId: mid });
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
