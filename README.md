# ربات دفترچه حساب (Node.js) — FadeHost

نسخهٔ Node همان محصول فارسی: پلن، بستانکار، بدهکار، موجودی. مناسب قالب قفل‌شدهٔ `telegram-starter-bot` روی FadeHost.

## اجرا محلی

```bash
npm install
cp .env.example .env
# TELEGRAM_BOT_TOKEN را بگذارید
npm start
```

## استقرار روی FadeHost

پکیج زیپ آماده:

`/cursor/stores/self/docs/telegram-expense-bot-node-fadehost.zip`

### مراحل

1. در پنل FadeHost اپ را **Stop** کنید.
2. کد قالب پیش‌فرض (مثلاً `index.js` قدیمی grammY) را با محتویات این پروژه عوض کنید:
   - یا **Push به همان ریپوی GitHub** وصل‌شده به اپ
   - یا اگر Files باز است، آپلود فایل‌ها
3. فایل‌های لازم در ریشه: `package.json`, `index.js`, `db.js`, `helpers.js`, `keyboards.js`
4. Env در پنل (نه فایل `.env`):
   ```
   TELEGRAM_BOT_TOKEN=<توکن BotFather>
   SQLITE_PATH=/data/ledger.db
   ```
5. Start command:
   ```
   npm install && npm start
   ```
   یا: `node index.js` (اگر install جداگانه انجام می‌شود)
6. Start/Redeploy — در console باید ببینید: `شروع long polling…` و `Application started`
7. در تلگرام `/start` → منوی فارسی (ایجاد پلن / لیست / راهنما)

⚠️ همزمان Cursor VM یا نسخهٔ Python را با همین توکن روشن نکنید (409 Conflict).

## وابستگی‌ها

- `telegraf` — long polling
- `sql.js` — SQLite بدون native build (مناسب هاست رایگان)
- `dotenv` — فقط برای اجرای محلی

## دستورات

`/start` `/help` `/cancel`
