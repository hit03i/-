// src/main.js
// Step1 (deduped): Multi-company Google News RSS -> filter + dedupe
// - Dedup FEEDS by (name + url) so the same company won't appear twice
// - Dedup items per company by canonical key (link || title)
// - Exclude market-report noise, and boost auto/anticorrosion/building topics

import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsBot/1.0",
  },
});

const FEEDS_RAW = [
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

// 必須：塗料/コーティング/塗装関連
const REQUIRED_TOPIC_KEYWORDS = ["塗料", "コーティング", "塗装", "paint", "coating"];

// 優先：自動車/防食/建築（スコアで上に）
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
