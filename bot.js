import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";
dotenv.config('./.env');

import { getGoldPrices } from "./gia_vang.js";
import { getFuelPrices } from "./gia_xang.js";
import { getTemperatures } from "./nhiet_do.js";
import { getRouteHome, PRESET_LOCATIONS, LOCATION_BUTTON_PREFIX } from "./ve_nha.js";
import { listJobs, scheduleJob } from "./scheduler.js";
import { getServerStatus, listPm2Apps, restartPm2App, tailLines } from "./server_status.js";
import { checkPm2, checkSites } from "./monitor.js";
import { addNote, deleteNote, getNote, renderNotesPage, renderSearch } from "./notes.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
// User id của chủ bot: gõ /myid khi chat riêng với bot để lấy, rồi điền vào .env.
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

// Create a bot using polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Mạng chập chờn làm polling lỗi liên tục (ESOCKETTIMEDOUT, 502...), thư viện tự thử lại.
// Mỗi loại lỗi chỉ log tối đa 1 lần/phút, không thì log phình lên hàng trăm MB.
const lastPollingErrorAt = {};
bot.on("polling_error", (error) => {
  const key = `${error.code}:${error.message}`;
  const now = Date.now();
  if (now - (lastPollingErrorAt[key] || 0) < 60_000) return;
  lastPollingErrorAt[key] = now;
  console.error(`[polling_error] ${new Date().toISOString()} ${key}`);
});

// Regex cho lệnh: chỉ khớp khi tin nhắn bắt đầu bằng lệnh (kể cả dạng /lenh@TenBot trong group).
// match[1] là phần chữ phía sau lệnh. "/note" không khớp "/notes".
function cmd(name) {
  return new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`);
}

function isOwner(msg) {
  return Boolean(OWNER_CHAT_ID) && String(msg.from?.id) === OWNER_CHAT_ID;
}

// Bọc handler của lệnh chỉ chủ bot được dùng. Chưa cấu hình OWNER_CHAT_ID thì chặn hết.
function ownerOnly(handler) {
  return (msg, match) => {
    if (!isOwner(msg)) {
      return bot.sendMessage(msg.chat.id, "⛔ Lệnh này chỉ dành cho chủ bot.");
    }
    return handler(msg, match);
  };
}

// Báo riêng cho chủ bot.
function notifyOwner(text) {
  if (!OWNER_CHAT_ID) return;
  bot.sendMessage(OWNER_CHAT_ID, text).catch((error) => console.error("notifyOwner error:", error.message));
}

// Dùng làm onError của scheduleJob. Job chạy mỗi phút mà lỗi hoài thì mỗi giờ chỉ báo 1 lần.
const lastJobErrorAt = {};
function reportJobError(name, error) {
  const now = Date.now();
  if (now - (lastJobErrorAt[name] || 0) < 60 * 60_000) return;
  lastJobErrorAt[name] = now;
  notifyOwner(`⚠️ Job ${name} lỗi: ${error.message}`);
}

// Canh chừng: web sập (gọi thử từng app) và app pm2 crash, mỗi phút một lần.
scheduleJob("canh-web", "* * * * *", () => checkSites(notifyOwner), reportJobError);
scheduleJob("canh-pm2", "* * * * *", () => checkPm2(notifyOwner), reportJobError);


// Command listener
bot.onText(cmd("giavang"), async (msg) => {
  const chatId = msg.chat.id;
  const price = await getGoldPrices();
  bot.sendMessage(chatId, price);
});

bot.onText(cmd("giaxang"), async (msg) => {
    const chatId = msg.chat.id;
    const price = await getFuelPrices();
    bot.sendMessage(chatId, price);
  });

bot.onText(cmd("nhietdo"), async (msg) => {
    const chatId = msg.chat.id;
    const weather = await getTemperatures();
    bot.sendMessage(chatId, weather);
  });

// Nút inline (callback) hoạt động cả trong group, kể cả khi bot bật privacy mode.
bot.onText(cmd("venha"), (msg) => {
  const inline_keyboard = PRESET_LOCATIONS.map((l, i) => [{ text: LOCATION_BUTTON_PREFIX + l.name, callback_data: `venha:${i}` }]);
  bot.sendMessage(msg.chat.id, "Bạn đang ở đâu?", { reply_markup: { inline_keyboard } });

  // Nút gửi vị trí hiện tại chỉ dùng được khi chat riêng với bot.
  if (msg.chat.type === "private") {
    bot.sendMessage(msg.chat.id, "Hoặc gửi vị trí hiện tại:", {
      reply_markup: {
        keyboard: [[{ text: "📡 Gửi vị trí hiện tại", request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }
});

async function replyRouteHome(chatId, origin) {
  const text = await getRouteHome(origin);
  bot.sendMessage(chatId, text, { reply_markup: { remove_keyboard: true }, disable_web_page_preview: true });
}

bot.on("callback_query", async (query) => {
  const match = query.data?.match(/^venha:(\d+)$/);
  if (!match || !query.message) return;
  const origin = PRESET_LOCATIONS[Number(match[1])];
  await bot.answerCallbackQuery(query.id);
  if (origin) replyRouteHome(query.message.chat.id, origin);
});

bot.on("location", (msg) => {
  replyRouteHome(msg.chat.id, {
    name: "vị trí hiện tại",
    latitude: msg.location.latitude,
    longitude: msg.location.longitude,
  });
});

bot.onText(cmd("myid"), (msg) => {
  bot.sendMessage(msg.chat.id, `User id của bạn: ${msg.from.id}\nChat id: ${msg.chat.id}`);
});

bot.onText(cmd("status"), ownerOnly((msg) => {
  const uptimeMinutes = Math.round(process.uptime() / 60);
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const jobs = listJobs();
  const jobLines = jobs.length ? jobs.map((j) => `• ${j.name} (${j.expression})`).join("\n") : "• (chưa có)";
  bot.sendMessage(
    msg.chat.id,
    `🤖 Bot đang chạy ${Math.floor(uptimeMinutes / 60)} giờ ${uptimeMinutes % 60} phút\n` +
      `💾 RAM: ${memoryMb} MB\n` +
      `⏰ Lịch tự động:\n${jobLines}`,
  );
}));

// /server: tình trạng server + nút restart từng app pm2 (phải bấm xác nhận lần nữa).
const BOT_PM2_NAME = "hieuplasma_bot";

function serverKeyboard(apps) {
  const rows = [];
  for (let i = 0; i < apps.length; i += 2) {
    rows.push(apps.slice(i, i + 2).map((a) => ({ text: `🔄 ${a.name}`, callback_data: `srv:ask:${a.name}` })));
  }
  rows.push([{ text: "📊 Làm mới", callback_data: "srv:refresh" }]);
  return { inline_keyboard: rows };
}

// Không có messageId thì gửi tin mới, có thì cập nhật tin cũ.
async function sendServerStatus(chatId, messageId) {
  const { text, apps } = await getServerStatus();
  const reply_markup = serverKeyboard(apps);
  if (!messageId) return bot.sendMessage(chatId, text, { reply_markup });
  return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup }).catch((error) => {
    if (!/message is not modified/.test(error.message)) throw error;
  });
}

bot.onText(cmd("server"), ownerOnly((msg) =>
  sendServerStatus(msg.chat.id).catch((error) => console.error("/server error:", error.message)),
));

async function handleServerCallback(query, action, name) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (action === "ask") {
    await bot.answerCallbackQuery(query.id);
    return bot.editMessageReplyMarkup(
      {
        inline_keyboard: [[
          { text: `✅ Restart ${name}`, callback_data: `srv:yes:${name}` },
          { text: "❌ Hủy", callback_data: "srv:no" },
        ]],
      },
      { chat_id: chatId, message_id: messageId },
    );
  }

  if (action === "yes") {
    const apps = await listPm2Apps();
    if (!apps.some((a) => a.name === name)) {
      return bot.answerCallbackQuery(query.id, { text: `Không có app ${name}`, show_alert: true });
    }
    await bot.answerCallbackQuery(query.id, { text: `Đang restart ${name}...` });
    // Restart chính bot thì tiến trình này bị tắt ngay, nên báo trước.
    if (name === BOT_PM2_NAME) {
      await bot.sendMessage(chatId, "🔄 Đang restart bot, chờ vài giây rồi gõ /server để kiểm tra.");
    }
    try {
      await restartPm2App(name);
    } catch (error) {
      return bot.sendMessage(chatId, `❌ Restart ${name} lỗi: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await bot.sendMessage(chatId, `✅ Đã restart ${name}`);
    return sendServerStatus(chatId, messageId);
  }

  // refresh hoặc hủy: hiện lại trạng thái + bàn phím đầy đủ.
  await bot.answerCallbackQuery(query.id);
  return sendServerStatus(chatId, messageId);
}

bot.on("callback_query", async (query) => {
  const match = query.data?.match(/^srv:(refresh|ask|yes|no)(?::(.+))?$/);
  if (!match || !query.message) return;
  try {
    if (!isOwner(query)) {
      return await bot.answerCallbackQuery(query.id, { text: "⛔ Chỉ chủ bot mới dùng được.", show_alert: true });
    }
    await handleServerCallback(query, match[1], match[2]);
  } catch (error) {
    console.error("server callback error:", error.message);
  }
});

// /logs: xem log của app pm2. "/logs" hiện nút chọn app, "/logs uongbia [out] [số dòng]".
const LOG_DEFAULT_LINES = 30;
const LOG_MAX_LINES = 200;
const TELEGRAM_MAX_TEXT = 4000;

async function sendAppLog(chatId, name, kind = "err", lines = LOG_DEFAULT_LINES) {
  const app = (await listPm2Apps()).find((a) => a.name === name);
  if (!app) return bot.sendMessage(chatId, `Không có app ${name}. Gõ /logs để chọn.`);
  const file = kind === "out" ? app.outLogPath : app.errLogPath;
  let body;
  try {
    body = (await tailLines(file, lines)).join("\n") || "(trống)";
  } catch (error) {
    body = `Không đọc được ${file}: ${error.message}`;
  }
  const header = `📜 ${name} - log ${kind === "out" ? "thường" : "lỗi"}, ${lines} dòng cuối:\n\n`;
  // Quá dài thì cắt bớt phần cũ, giữ phần mới nhất.
  const room = TELEGRAM_MAX_TEXT - header.length;
  if (body.length > room) body = "…" + body.slice(-(room - 1));
  return bot.sendMessage(chatId, header + body, { disable_web_page_preview: true });
}

bot.onText(cmd("logs"), ownerOnly(async (msg, match) => {
  try {
    const args = (match[1] || "").trim().split(/\s+/).filter(Boolean);
    const name = args.find((a) => a !== "out" && !/^\d+$/.test(a));
    if (!name) {
      const apps = await listPm2Apps();
      const inline_keyboard = apps.map((a) => [
        { text: `❗ ${a.name}`, callback_data: `logs:err:${a.name}` },
        { text: `📄 ${a.name}`, callback_data: `logs:out:${a.name}` },
      ]);
      return await bot.sendMessage(msg.chat.id, "Xem log app nào? (❗ log lỗi, 📄 log thường)", { reply_markup: { inline_keyboard } });
    }
    const kind = args.includes("out") ? "out" : "err";
    const count = Math.min(Number(args.find((a) => /^\d+$/.test(a))) || LOG_DEFAULT_LINES, LOG_MAX_LINES);
    await sendAppLog(msg.chat.id, name, kind, count);
  } catch (error) {
    console.error("/logs error:", error.message);
  }
}));

bot.on("callback_query", async (query) => {
  const match = query.data?.match(/^logs:(err|out):(.+)$/);
  if (!match || !query.message) return;
  try {
    if (!isOwner(query)) {
      return await bot.answerCallbackQuery(query.id, { text: "⛔ Chỉ chủ bot mới dùng được.", show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);
    await sendAppLog(query.message.chat.id, match[2], match[1]);
  } catch (error) {
    console.error("logs callback error:", error.message);
  }
});

// ---------------------------------------------------------------- ghi chú
// /note <nội dung>: ghi. /note không kèm gì: bot hỏi lại, trả lời tin đó là được.
// Chuyển tiếp (forward) tin nhắn có chữ vào chat riêng với bot cũng được lưu thành ghi chú.
// /notes: xem (phân trang, nút xóa). /notes <từ khóa>: tìm, không cần gõ dấu.
const NOTE_PROMPT = "📝 Ghi gì? (trả lời tin này)";

function saveNote(chatId, text) {
  const note = addNote(text);
  return bot.sendMessage(chatId, `📝 Đã lưu ghi chú #${note.id}. Xem lại: /notes`);
}

bot.onText(cmd("note"), ownerOnly((msg, match) => {
  const text = match[1]?.trim();
  if (text) return saveNote(msg.chat.id, text);
  return bot.sendMessage(msg.chat.id, NOTE_PROMPT, {
    reply_markup: { force_reply: true, input_field_placeholder: "Nội dung ghi chú" },
  });
}));

bot.on("message", (msg) => {
  if (!isOwner(msg)) return;
  const text = msg.text || msg.caption;
  if (!text) return;

  // Trả lời câu hỏi "Ghi gì?" của bot.
  const replied = msg.reply_to_message;
  if (replied?.from?.is_bot && replied.text === NOTE_PROMPT && !text.startsWith("/")) {
    return saveNote(msg.chat.id, text);
  }

  // Tin chuyển tiếp trong chat riêng.
  const origin = msg.forward_origin;
  if (msg.chat.type === "private" && (origin || msg.forward_date)) {
    const from =
      origin?.sender_user?.first_name || origin?.sender_user_name || origin?.chat?.title || origin?.sender_chat?.title;
    return saveNote(msg.chat.id, from ? `${text}\n— chuyển tiếp từ ${from}` : text);
  }
});

bot.onText(cmd("notes"), ownerOnly((msg, match) => {
  const query = match[1]?.trim();
  const { text, reply_markup } = query ? renderSearch(query) : renderNotesPage(0);
  return bot.sendMessage(msg.chat.id, text, { reply_markup, disable_web_page_preview: true });
}));

function editNotesMessage(query, { text, reply_markup }) {
  return bot
    .editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup,
      disable_web_page_preview: true,
    })
    .catch((error) => {
      if (!/message is not modified/.test(error.message)) throw error;
    });
}

bot.on("callback_query", async (query) => {
  const match = query.data?.match(/^notes:(p|del|yes):(\d+)(?::(\d+))?$/);
  if (!match || !query.message) return;
  try {
    if (!isOwner(query)) {
      return await bot.answerCallbackQuery(query.id, { text: "⛔ Chỉ chủ bot mới dùng được.", show_alert: true });
    }
    const [, action, a, b] = match;

    if (action === "p") {
      await bot.answerCallbackQuery(query.id);
      return await editNotesMessage(query, renderNotesPage(Number(a)));
    }

    const id = Number(a);
    const page = Number(b || 0);
    if (action === "del") {
      // Hỏi lại trước khi xóa, hiện nội dung để khỏi bấm nhầm.
      const note = getNote(id);
      if (!note) {
        await bot.answerCallbackQuery(query.id, { text: `Ghi chú #${id} không còn.` });
        return await editNotesMessage(query, renderNotesPage(page));
      }
      await bot.answerCallbackQuery(query.id);
      const preview = note.text.length > 200 ? note.text.slice(0, 200) + "…" : note.text;
      return await editNotesMessage(query, {
        text: `🗑 Xóa ghi chú #${id}?\n\n${preview}`,
        reply_markup: {
          inline_keyboard: [[
            { text: `✅ Xóa #${id}`, callback_data: `notes:yes:${id}:${page}` },
            { text: "❌ Hủy", callback_data: `notes:p:${page}` },
          ]],
        },
      });
    }

    // action === "yes"
    const deleted = deleteNote(id);
    await bot.answerCallbackQuery(query.id, { text: deleted ? `Đã xóa #${id}` : `Ghi chú #${id} không còn.` });
    return await editNotesMessage(query, renderNotesPage(page));
  } catch (error) {
    console.error("notes callback error:", error.message);
  }
});

// Danh sách lệnh dùng chung cho menu "/" của Telegram và /help.
const COMMANDS = [
  { command: "giavang", description: "Xem giá vàng" },
  { command: "giaxang", description: "Xem giá xăng dầu" },
  { command: "nhietdo", description: "Xem nhiệt độ Hà Nội, Hải Thịnh, Phù Khê" },
  { command: "venha", description: "Tìm đường nhanh nhất về nhà bằng xe máy" },
  { command: "note", description: "Ghi chú nhanh, vd /note mua dầu nhớt (chỉ chủ bot)" },
  { command: "notes", description: "Xem / tìm / xóa ghi chú, vd /notes dau nhot (chỉ chủ bot)" },
  { command: "myid", description: "Xem user id / chat id" },
  { command: "status", description: "Tình trạng bot (chỉ chủ bot)" },
  { command: "server", description: "Tình trạng server + restart app pm2 (chỉ chủ bot)" },
  { command: "logs", description: "Xem log app pm2, vd /logs uongbia (chỉ chủ bot)" },
  { command: "help", description: "Xem các lệnh hỗ trợ" },
];
bot.setMyCommands(COMMANDS).catch((error) => console.error("setMyCommands error:", error.message));

// Help command
const help = COMMANDS.map((c) => `/${c.command} - ${c.description}`).join("\n");
bot.onText(cmd("start"), (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Chào mừng bạn đến với bot Hieuplasma!\n" + "Vui lòng nhập /help để xem các lệnh hỗ trợ.");
}
);
bot.onText(cmd("help"), (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, help);
}
);
