"use strict";

const PERSIAN_DIGITS = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

function normalizeDigits(text) {
  return String(text).replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGITS[ch] || ch);
}

function parseAmount(text) {
  let raw = normalizeDigits(String(text || "").trim());
  raw = raw.replace(/[,٬،\s]/g, "");
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString("en-US").replace(/,/g, "٬");
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/,/g, "٬");
}

function truncate(text, limit = 40) {
  const t = String(text || "").trim();
  if (t.length <= limit) return t;
  return t.slice(0, limit - 1) + "…";
}

module.exports = {
  normalizeDigits,
  parseAmount,
  formatAmount,
  truncate,
};
