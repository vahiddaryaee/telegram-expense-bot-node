"use strict";

/**
 * ربات دفترچه حساب فارسی — سازگار با FadeHost (Node / telegram-starter)
 * long polling با Telegraf + SQLite از طریق sql.js (بدون native build)
 */

require("dotenv").config();

const { Telegraf, session } = require("telegraf");
const { Database, defaultDbPath } = require("./db");
const kb = require("./keyboards");
const { parseAmount, formatAmount, truncate } = require("./helpers");

const WELCOME = `سلام 👋
به <b>ربات دفترچه حساب</b> خوش آمدید.

از منوی زیر یک پلن بسازید یا پلن موجود را باز کنید.`;

const HELP_TEXT = `📖 <b>راهنمای ربات دفترچه حساب</b>

با این ربات می‌توانید چند <b>پلن</b> بسازید و داخل هر پلن تراکنش ثبت کنید:

• <b>بستانکار</b> = ورود پول / طلب
• <b>بدهکار</b> = خرج / بدهی
• <b>موجودی</b> = بستانکار − بدهکار

حتی اگر موجودی منفی شود، ثبت بدهکار مجاز است (با هشدار).

دستورات:
/start — منوی اصلی
/cancel — لغو عملیات جاری`;

function redact(msg) {
  return String(msg).replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***TG_TOKEN***");
}

const log = {
  info: (...a) => console.log(redact(a.join(" "))),
  warn: (...a) => console.warn(redact(a.join(" "))),
  error: (...a) => console.error(redact(a.join(" "))),
};

async function safeAnswer(ctx) {
  try {
    await ctx.answerCbQuery();
  } catch (e) {
    const m = String(e.message || e);
    if (/too old|query id is invalid|message is not modified/i.test(m)) return;
    log.warn("answerCbQuery:", m);
  }
}

async function editOrReply(ctx, text, extra = {}) {
  const opts = { parse_mode: "HTML", ...extra };
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      const m = String(e.message || e);
      if (/message is not modified/i.test(m)) return;
      // fall through to reply
    }
  }
  await ctx.reply(text, opts);
}

async function showPlan(ctx, db, planId) {
  const userId = ctx.from.id;
  const plan = db.getPlan(userId, planId);
  if (!plan) {
    await editOrReply(ctx, "پلن پیدا نشد.", kb.mainMenu());
    return;
  }
  db.setSelectedPlan(userId, planId);
  const totals = db.planTotals(userId, planId);
  let text =
    `📁 پلن: <b>${plan.name}</b>\n\n` +
    `📥 بستانکار: ${formatAmount(totals.credit)}\n` +
    `📤 بدهکار (خرج‌شده): ${formatAmount(totals.debit)}\n` +
    `💰 موجودی: <b>${formatAmount(totals.balance)}</b>`;
  if (totals.balance < 0) text += "\n\n⚠️ موجودی منفی است.";
  await editOrReply(ctx, text, kb.planMenu(planId));
}

async function main() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    console.error(
      "خطا: TELEGRAM_BOT_TOKEN تنظیم نشده. در پنل FadeHost Env را ست کنید."
    );
    process.exit(1);
  }

  const dbPath = defaultDbPath();
  const db = await new Database(dbPath).init();
  log.info("SQLite:", dbPath);

  const bot = new Telegraf(token);
  bot.use(session());

  bot.catch((err, ctx) => {
    const m = String(err.message || err);
    if (/409|Conflict.*getUpdates/i.test(m)) {
      log.warn("conflict getUpdates (نمونهٔ دیگر در حال polling؟)");
      return;
    }
    if (/too old|query id is invalid|message is not modified/i.test(m)) {
      log.info("نادیده:", m);
      return;
    }
    log.error("handler error:", m);
  });

  bot.start(async (ctx) => {
    ctx.session = {};
    await ctx.reply(WELCOME, { parse_mode: "HTML", ...kb.mainMenu() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML", ...kb.mainMenu() });
  });

  bot.command("cancel", async (ctx) => {
    ctx.session = {};
    await ctx.reply("عملیات لغو شد.", kb.mainMenu());
  });

  // ---- text flows ----
  bot.on("text", async (ctx, next) => {
    const flow = ctx.session && ctx.session.flow;
    if (!flow) return next();

    const text = ctx.message.text || "";
    const userId = ctx.from.id;

    if (flow === "create_plan") {
      const name = text.trim();
      if (!name || name.length > 64) {
        await ctx.reply("نام معتبر بفرستید (۱ تا ۶۴ نویسه).", kb.cancelFlow());
        return;
      }
      const plan = db.createPlan(userId, name);
      ctx.session = {};
      await ctx.reply(
        `✅ پلن «${plan.name}» ساخته و انتخاب شد.`,
        kb.planMenu(plan.id)
      );
      return;
    }

    if (flow === "enter_amount") {
      const amount = parseAmount(text);
      if (amount == null) {
        await ctx.reply(
          "مبلغ نامعتبر است. یک عدد مثبت بفرستید (مثلاً ۱۵۰۰۰۰ یا 1500.5).",
          kb.cancelFlow()
        );
        return;
      }
      ctx.session.txAmount = amount;
      ctx.session.flow = "enter_note";
      const label =
        ctx.session.txKind === "credit" ? "بستانکار" : "بدهکار";
      await ctx.reply(
        `مبلغ ${formatAmount(amount)} برای ${label} ثبت می‌شود.\n` +
          `یادداشت اختیاری بفرستید یا «بدون یادداشت» را بزنید:`,
        kb.skipNote()
      );
      return;
    }

    if (flow === "enter_note") {
      const note = text.trim();
      if (note.length > 200) {
        await ctx.reply("یادداشت حداکثر ۲۰۰ نویسه باشد.", kb.skipNote());
        return;
      }
      await saveTx(ctx, db, note);
      return;
    }

    return next();
  });

  async function saveTx(ctx, database, note) {
    const userId = ctx.from.id;
    const planId = Number(ctx.session.txPlanId);
    const kind = ctx.session.txKind;
    const amount = Number(ctx.session.txAmount);
    const plan = database.getPlan(userId, planId);
    if (!plan) {
      ctx.session = {};
      await editOrReply(ctx, "پلن پیدا نشد.", kb.mainMenu());
      return;
    }
    database.addTransaction(userId, planId, kind, amount, note || null);
    const totals = database.planTotals(userId, planId);
    const label = kind === "credit" ? "بستانکار" : "بدهکار";
    const noteLine = note ? `\nیادداشت: ${note}` : "";
    let text =
      `✅ ${label} به مبلغ ${formatAmount(amount)} ثبت شد.${noteLine}\n\n` +
      `💰 موجودی فعلی: <b>${formatAmount(totals.balance)}</b>`;
    if (totals.balance < 0) text += "\n⚠️ موجودی منفی شد.";
    ctx.session = {};
    await editOrReply(ctx, text, kb.planMenu(planId));
  }

  // ---- callbacks ----
  bot.on("callback_query", async (ctx) => {
    await safeAnswer(ctx);
    const data = ctx.callbackQuery.data || "";
    const userId = ctx.from.id;

    if (data === "menu:home" || data === "flow:cancel") {
      ctx.session = {};
      await editOrReply(
        ctx,
        data === "flow:cancel" ? "عملیات لغو شد." : WELCOME,
        data === "flow:cancel"
          ? kb.mainMenu()
          : { parse_mode: "HTML", ...kb.mainMenu() }
      );
      return;
    }

    if (data === "menu:help") {
      await editOrReply(ctx, HELP_TEXT, {
        parse_mode: "HTML",
        ...kb.mainMenu(),
      });
      return;
    }

    if (data === "menu:list_plans") {
      const plans = db.listPlans(userId);
      if (!plans.length) {
        await editOrReply(
          ctx,
          "هنوز پلنی ندارید. ابتدا یک پلن بسازید.",
          kb.mainMenu()
        );
        return;
      }
      const selected = db.getSelectedPlanId(userId);
      await editOrReply(
        ctx,
        "📋 پلن‌های شما — یکی را انتخاب کنید:",
        kb.plansList(plans, selected)
      );
      return;
    }

    if (data === "menu:create_plan") {
      ctx.session = { flow: "create_plan" };
      await editOrReply(
        ctx,
        "نام پلن جدید را بفرستید:\n(مثلاً: خانه، سفر، فروشگاه)",
        kb.cancelFlow()
      );
      return;
    }

    if (data === "flow:skip_note") {
      if (!ctx.session || ctx.session.flow !== "enter_note") {
        await editOrReply(ctx, "عملیات منقضی شد.", kb.mainMenu());
        return;
      }
      await saveTx(ctx, db, null);
      return;
    }

    if (data.startsWith("plan:")) {
      const parts = data.split(":");
      const planId = Number(parts[1]);
      const action = parts[2];
      const plan = db.getPlan(userId, planId);

      if (!plan && action !== "open") {
        await editOrReply(ctx, "پلن پیدا نشد.", kb.mainMenu());
        return;
      }

      if (action === "open") {
        await showPlan(ctx, db, planId);
        return;
      }

      if (action === "report") {
        const totals = db.planTotals(userId, planId);
        let text =
          `📊 <b>گزارش پلن «${plan.name}»</b>\n\n` +
          `📥 جمع بستانکار: ${formatAmount(totals.credit)}\n` +
          `📤 جمع بدهکار (خرج‌شده): ${formatAmount(totals.debit)}\n` +
          `💰 موجودی: <b>${formatAmount(totals.balance)}</b>`;
        if (totals.balance < 0) {
          text +=
            "\n\n⚠️ موجودی منفی است — خرج از بستانکار بیشتر شده.";
        }
        await editOrReply(ctx, text, {
          parse_mode: "HTML",
          ...kb.planMenu(planId),
        });
        return;
      }

      if (action === "recent") {
        const txs = db.listTransactions(userId, planId, 10);
        if (!txs.length) {
          await editOrReply(
            ctx,
            `در پلن «${plan.name}» تراکنشی نیست.`,
            kb.planMenu(planId)
          );
          return;
        }
        const lines = [`🕒 <b>تراکنش‌های اخیر — ${plan.name}</b>\n`];
        for (const tx of txs) {
          const kind =
            tx.kind === "credit" ? "📥 بستانکار" : "📤 بدهکار";
          const note = tx.note ? ` — ${truncate(tx.note)}` : "";
          lines.push(
            `#${tx.id} ${kind}: ${formatAmount(tx.amount)}${note}`
          );
        }
        lines.push("\nبرای حذف، دکمهٔ مربوط را بزنید.");
        await editOrReply(ctx, lines.join("\n"), {
          parse_mode: "HTML",
          ...kb.recentTxKeyboard(planId, txs),
        });
        return;
      }

      if (action === "delete_ask") {
        await editOrReply(
          ctx,
          `آیا پلن «${plan.name}» و همهٔ تراکنش‌هایش حذف شود؟\nاین کار برگشت‌ناپذیر است.`,
          kb.confirmDeletePlan(planId)
        );
        return;
      }

      if (action === "delete_yes") {
        const name = plan.name;
        db.deletePlan(userId, planId);
        await editOrReply(ctx, `پلن «${name}» حذف شد.`, kb.mainMenu());
        return;
      }

      if (action === "credit" || action === "debit") {
        ctx.session = {
          flow: "enter_amount",
          txKind: action,
          txPlanId: planId,
        };
        const label = action === "credit" ? "بستانکار" : "بدهکار";
        await editOrReply(
          ctx,
          `مبلغ <b>${label}</b> را وارد کنید:\n` +
            `(عدد صحیح یا اعشاری؛ ارقام فارسی هم قبول است)`,
          { parse_mode: "HTML", ...kb.cancelFlow() }
        );
        return;
      }
    }

    if (data.startsWith("tx:")) {
      const parts = data.split(":");
      const txId = Number(parts[1]);
      const action = parts[2];
      const planId = Number(parts[3]);
      const tx = db.getTransaction(userId, txId);
      if (!tx) {
        await editOrReply(
          ctx,
          "تراکنش پیدا نشد.",
          db.getPlan(userId, planId) ? kb.planMenu(planId) : kb.mainMenu()
        );
        return;
      }
      if (action === "delete_ask") {
        const kind = tx.kind === "credit" ? "بستانکار" : "بدهکار";
        const note = tx.note ? `\nیادداشت: ${tx.note}` : "";
        await editOrReply(
          ctx,
          `حذف تراکنش #${txId}؟\n${kind}: ${formatAmount(tx.amount)}${note}`,
          kb.confirmDeleteTx(txId, planId)
        );
        return;
      }
      if (action === "delete_yes") {
        db.deleteTransaction(userId, txId);
        await editOrReply(
          ctx,
          `تراکنش #${txId} حذف شد.`,
          kb.planMenu(planId)
        );
        return;
      }
    }
  });

  log.info("شروع long polling…");
  // پاک کردن webhook احتمالی و تلاش مجدد در صورت 409
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (e) {
    log.warn("deleteWebhook:", e.message || e);
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      // launch() تا زمان stop resolve نمی‌شود — قبلش لاگ می‌زنیم
      log.info("Application started");
      await bot.launch({ dropPendingUpdates: false });
      break;
    } catch (e) {
      const m = String(e.message || e);
      if (/409|Conflict/i.test(m) && attempt < 30) {
        log.warn(`getUpdates conflict (تلاش ${attempt}/30) — صبر و retry…`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw e;
    }
  }
}

main().catch((err) => {
  console.error(redact(String(err && err.stack ? err.stack : err)));
  process.exit(1);
});
