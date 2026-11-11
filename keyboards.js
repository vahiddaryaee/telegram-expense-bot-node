"use strict";

const { Markup } = require("telegraf");

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ ایجاد پلن", "menu:create_plan")],
    [Markup.button.callback("📋 لیست پلن‌ها", "menu:list_plans")],
    [Markup.button.callback("❓ راهنما", "menu:help")],
  ]);
}

function planMenu(planId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📥 بستانکار", `plan:${planId}:credit`),
      Markup.button.callback("📤 بدهکار", `plan:${planId}:debit`),
    ],
    [Markup.button.callback("📊 گزارش / موجودی", `plan:${planId}:report`)],
    [Markup.button.callback("🕒 تراکنش‌های اخیر", `plan:${planId}:recent`)],
    [Markup.button.callback("🗑 حذف پلن", `plan:${planId}:delete_ask`)],
    [Markup.button.callback("🏠 منوی اصلی", "menu:home")],
  ]);
}

function plansList(plans, selectedId = null) {
  const rows = plans.map((p) => {
    const mark = selectedId === p.id ? "✅ " : "";
    return [Markup.button.callback(`${mark}${p.name}`, `plan:${p.id}:open`)];
  });
  rows.push([Markup.button.callback("🏠 منوی اصلی", "menu:home")]);
  return Markup.inlineKeyboard(rows);
}

function confirmDeletePlan(planId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ بله، حذف شود", `plan:${planId}:delete_yes`),
      Markup.button.callback("❌ انصراف", `plan:${planId}:open`),
    ],
  ]);
}

function recentTxKeyboard(planId, txs) {
  const rows = txs.map((tx) => {
    const kind = tx.kind === "credit" ? "بستانکار" : "بدهکار";
    return [
      Markup.button.callback(
        `حذف #${tx.id} (${kind})`,
        `tx:${tx.id}:delete_ask:${planId}`
      ),
    ];
  });
  rows.push([
    Markup.button.callback("↩️ بازگشت به پلن", `plan:${planId}:open`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function confirmDeleteTx(txId, planId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ بله، حذف شود",
        `tx:${txId}:delete_yes:${planId}`
      ),
      Markup.button.callback("❌ انصراف", `plan:${planId}:recent`),
    ],
  ]);
}

function cancelFlow() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("❌ انصراف", "flow:cancel")],
  ]);
}

function skipNote() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏭ بدون یادداشت", "flow:skip_note")],
    [Markup.button.callback("❌ انصراف", "flow:cancel")],
  ]);
}

module.exports = {
  mainMenu,
  planMenu,
  plansList,
  confirmDeletePlan,
  recentTxKeyboard,
  confirmDeleteTx,
  cancelFlow,
  skipNote,
};
