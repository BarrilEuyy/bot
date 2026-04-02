const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const OWNER_NUMBER = "6285803026940@s.whatsapp.net"; // GANTI PAKE NOMOR WA KAMU (Pake @s.whatsapp.net)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
  // 1. Setup Auth (Penyimpanan Sesi)
  const { state, saveCreds } = await useMultiFileAuthState("session_auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    printQRInTerminal: false, // Matikan QR karena pakai Pairing Code
    logger: pino({ level: "fatal" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"], // Supaya terdeteksi sebagai browser di WA
  });

  // 2. Logika Pairing Code
  if (!sock.authState.creds.registered) {
    const phoneNumber = await question(
      "Masukkan nomor WA kamu (Contoh: 628123456789): ",
    );
    const code = await sock.requestPairingCode(phoneNumber.trim());
    console.log(`\n======================================`);
    console.log(`KODE PAIRING KAMU: ${code}`);
    console.log(`======================================\n`);
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        "Koneksi terputus, mencoba menyambung ulang...",
        shouldReconnect,
      );

      if (shouldReconnect) {
        await delay(5000); // Kasi jeda 5 detik sebelum nyambung lagi
        startBot();
      }
    } else if (connection === "open") {
      console.log("✅ Bot Berhasil Terhubung!");
    }
  });

  // Simpan kredensial setiap kali ada perubahan
  sock.ev.on("creds.update", saveCreds);

  const APPROVED_GROUPS_FILE = "./database_groups.json";

  function getApprovedGroups() {
    try {
      if (
        !fs.existsSync(APPROVED_GROUPS_FILE) ||
        fs.readFileSync(APPROVED_GROUPS_FILE).length === 0
      ) {
        fs.writeFileSync(APPROVED_GROUPS_FILE, JSON.stringify([]));
        return [];
      }
      return JSON.parse(fs.readFileSync(APPROVED_GROUPS_FILE));
    } catch (e) {
      fs.writeFileSync(APPROVED_GROUPS_FILE, JSON.stringify([]));
      return [];
    }
  }

  function saveApprovedGroups(data) {
    fs.writeFileSync(APPROVED_GROUPS_FILE, JSON.stringify(data, null, 2));
  }

  const PAYMENT_FILE = "./database_payment.json";

  function getPaymentDB() {
    try {
      if (
        !fs.existsSync(PAYMENT_FILE) ||
        fs.readFileSync(PAYMENT_FILE).length === 0
      ) {
        fs.writeFileSync(PAYMENT_FILE, JSON.stringify({}));
        return {};
      }
      return JSON.parse(fs.readFileSync(PAYMENT_FILE));
    } catch (e) {
      fs.writeFileSync(PAYMENT_FILE, JSON.stringify({}));
      return {};
    }
  }

  function savePaymentDB(data) {
    fs.writeFileSync(PAYMENT_FILE, JSON.stringify(data, null, 2));
  }

  // File untuk simpan data produk
  const DATA_FILE = "./database_produk.json";
  const BLACKLIST_FILE = "./database_blacklist.json";

  function getBlacklist() {
    try {
      if (
        !fs.existsSync(BLACKLIST_FILE) ||
        fs.readFileSync(BLACKLIST_FILE).length === 0
      ) {
        fs.writeFileSync(BLACKLIST_FILE, JSON.stringify([]));
        return [];
      }
      return JSON.parse(fs.readFileSync(BLACKLIST_FILE));
    } catch (e) {
      // Jika file rusak/corrupt, reset jadi list kosong
      fs.writeFileSync(BLACKLIST_FILE, JSON.stringify([]));
      return [];
    }
  }

  function saveBlacklist(data) {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2));
  }

  // Fungsi ambil data produk
  function getDatabase() {
    try {
      if (
        !fs.existsSync(DATA_FILE) ||
        fs.readFileSync(DATA_FILE).length === 0
      ) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({}));
        return {};
      }
      return JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (e) {
      // Jika file rusak/corrupt, reset jadi objek kosong
      fs.writeFileSync(DATA_FILE, JSON.stringify({}));
      return {};
    }
  }

  // Fungsi simpan data produk
  function saveDatabase(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith("@g.us");
    if (!isGroup) return; // Khusus Grup

    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const command = text.toLowerCase().trim();
    const prefix = "."; // Tentukan prefix kamu di sini jika ingin pakai titik
    const db = getDatabase();

    // --- IDENTIFIKASI DASAR (TANPA AWAIT METADATA) ---
    const sender = msg.key.participant || msg.key.remoteJid;
    const ownerIdentities = [
      OWNER_NUMBER,
      "67091851939896@lid", // Masukkan LID hasil debug tadi di sini
      OWNER_NUMBER.replace(/\D/g, "") + "@s.whatsapp.net",
    ];

    const isOwner = ownerIdentities.includes(sender) || msg.key.fromMe;
    const approvedGroups = getApprovedGroups();
    const isApproved = approvedGroups.includes(jid);

    // --- GLOBAL MIDDLEWARE (REPLY STYLE) ---
    const replyWithStyle = async (konten) => {
      await sock.sendPresenceUpdate("composing", jid);
      await delay(1500);
      await sock.sendMessage(jid, { text: konten }, { quoted: msg });
      await sock.sendPresenceUpdate("paused", jid);
    };

    // ============================================================
    // 17. FITUR: Approve & Unapprove (Owner Only)
    // Ditaruh di atas proteksi agar Owner bisa approve grup baru
    // ============================================================
    if (command === "approve") {
      if (!isOwner) return;
      let groups = getApprovedGroups();
      if (groups.includes(jid))
        return await replyWithStyle("Grup ini sudah aktif sebelumnya.");
      groups.push(jid);
      saveApprovedGroups(groups);
      return await replyWithStyle(
        "✅ *BERHASIL!* Bot sekarang aktif di grup ini.",
      );
    }

    if (command === "unapprove") {
      if (!isOwner) return;
      let groups = getApprovedGroups();
      const updatedGroups = groups.filter((g) => g !== jid);
      saveApprovedGroups(updatedGroups);
      return await replyWithStyle(
        "🚫 *NON-AKTIF!* Bot telah dimatikan untuk grup ini.",
      );
    }

    // ============================================================
    // --- PROTEKSI GRUP ---
    // Filter agar user biasa tidak bisa pakai bot jika belum di-approve
    // ============================================================
    if (!isApproved && !isOwner) {
      // Jika pesan diawali prefix (misal titik) tapi grup belum approve
      if (text.startsWith(".")) {
        return await sock.sendMessage(jid, {
          text: "⚠️ Bot ini belum diaktifkan untuk grup ini. Silahkan hubungi Owner untuk aktivasi.",
        });
      }
      return; // Abaikan chat lainnya
    }

    // ============================================================
    // --- LAZY LOADING ADMIN CHECK ---
    // Hanya panggil metadata jika memang ada potensi command/fitur admin
    // ============================================================
    let isAdmin = false;
    let participants = [];

    // List keyword yang butuh pengecekan Admin
    const adminCommands = [
      "addlist",
      "updatelist",
      "removelist",
      "p",
      "proses",
      "d",
      "done",
      "gopen",
      "gclose",
      "groupopen",
      "groupclose",
      "h",
      "kick",
      "addbl",
      "unbl",
      "addpayment",
      "updatepayment",
      "removepayment",
    ];
    const isPotentiallyAdminCmd = adminCommands.some((cmd) =>
      command.startsWith(cmd),
    );

    if (isPotentiallyAdminCmd) {
      const groupMetadata = await sock.groupMetadata(jid);
      participants = groupMetadata.participants;
      isAdmin = participants.find((p) => p.id === sender)?.admin !== null;
    }

    // ============================================================
    // --- SEMUA FITUR YANG ADA (TIDAK DIKURANGI) ---
    // ============================================================

    // 1. FITUR: "list"
    if (command === "list") {
      const keys = Object.keys(db);
      const groupMetadata = await sock.groupMetadata(jid);
      const groupName = groupMetadata.subject;
      if (keys.length === 0) {
        await replyWithStyle(
          `Belum ada produk yang terdaftar di ${groupName.toUpperCase()}.`,
        );
      } else {
        let listPesan = `*${groupName.toUpperCase()}*\n`;
        listPesan += `────────────────────\n\n`;

        keys.forEach((k) => {
          listPesan += `⬥ 💎 *${k.toUpperCase()}*\n`;
        });

        listPesan += `\n────────────────────\n`;
        listPesan += "💡 *CARA CEK HARGA & DETAIL*\n";
        listPesan += "➜ Ketik nama produk di atas\n";
        listPesan += "➜ Contoh: *netflix*\n\n";
        listPesan += `🚀 _Powered by ${groupName}_`;
        await replyWithStyle(listPesan);
      }
      return;
    }

    // 2. FITUR: "addlist"
    if (command.startsWith("addlist ")) {
      if (!isAdmin && !isOwner)
        return await replyWithStyle("Maaf, fitur ini hanya untuk Admin grup.");
      const konten = text.slice(8).split("@");
      if (konten.length < 2)
        return await replyWithStyle(
          "Format salah! Gunakan: *addlist nama@detail*",
        );
      const nama = konten[0].toLowerCase().trim();
      db[nama] = konten[1].trim();
      saveDatabase(db);
      return await replyWithStyle(
        `✅ Produk *${nama}* berhasil ditambahkan ke list.`,
      );
    }

    // 3. FITUR: "updatelist"
    if (command.startsWith("updatelist ")) {
      if (!isAdmin && !isOwner)
        return await replyWithStyle("Maaf, fitur ini hanya untuk Admin grup.");
      const konten = text.slice(11).split("@");
      if (konten.length < 2)
        return await replyWithStyle(
          "Format salah! Gunakan: *updatelist nama@detail_baru*",
        );
      const nama = konten[0].toLowerCase().trim();
      if (!db[nama])
        return await replyWithStyle(`❌ Produk *${nama}* tidak ditemukan.`);
      db[nama] = konten[1].trim();
      saveDatabase(db);
      return await replyWithStyle(
        `✅ Detail produk *${nama}* berhasil diperbarui.`,
      );
    }

    // 4. FITUR: "removelist"
    if (command.startsWith("removelist ")) {
      if (!isAdmin && !isOwner)
        return await replyWithStyle("Maaf, fitur ini hanya untuk Admin grup.");
      const nama = text.slice(11).toLowerCase().trim();
      if (!db[nama])
        return await replyWithStyle(`❌ Produk *${nama}* memang tidak ada.`);
      delete db[nama];
      saveDatabase(db);
      return await replyWithStyle(
        `🗑️ Produk *${nama}* berhasil dihapus dari list.`,
      );
    }

    // 5. FITUR: Auto-Reply (Keyword Match)
    if (db[command]) {
      return await replyWithStyle(db[command]);
    }

    // 6 & 7. FITUR: PROSES & DONE
    if (
      command === "p" ||
      command === "proses" ||
      command === "d" ||
      command === "done"
    ) {
      if (!isAdmin && !isOwner) return;
      const isDone = command === "d" || command === "done";
      const quotedInfo = msg.message.extendedTextMessage?.contextInfo;
      if (!quotedInfo?.quotedMessage)
        return await replyWithStyle(
          `Silahkan reply chat pembeli yang ingin di${isDone ? "selesaikan" : "proses"}.`,
        );

      const waktu = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
      });
      const teksStatus = isDone
        ? `*PESANAN SELESAI / DONE* ✅\n\n📅 Tanggal: ${waktu.split(" ")[0]}\n⏰ Jam: ${waktu.split(" ")[1]} WIB\n✨ Status: Berhasil Terkirim\n\nTerima kasih sudah order di *Kall Store*!`
        : `*PESANAN SEDANG DIPROSES* ⏳\n\n📅 Tanggal: ${waktu.split(" ")[0]}\n⏰ Jam: ${waktu.split(" ")[1]} WIB\n📝 Status: Sedang dikerjakan\n\nMohon ditunggu ya kak. 🙏`;

      await sock.sendPresenceUpdate("composing", jid);
      await delay(2000);
      await sock.sendMessage(
        jid,
        { text: teksStatus },
        {
          quoted: {
            key: {
              remoteJid: jid,
              fromMe: false,
              id: quotedInfo.stanzaId,
              participant: quotedInfo.participant,
            },
            message: quotedInfo.quotedMessage,
          },
        },
      );
      return;
    }

    // 9 & 10. FITUR: GROUP OPEN/CLOSE
    if (["groupopen", "gopen", "groupclose", "gclose"].includes(command)) {
      if (!isAdmin && !isOwner) return;
      const isClose = command.includes("close");
      await sock.groupSettingUpdate(
        jid,
        isClose ? "announcement" : "not_announcement",
      );
      return await replyWithStyle(
        isClose ? "🔒 *Grup Berhasil Ditutup!*" : "✅ *Grup Berhasil Dibuka!*",
      );
    }

    // 11. FITUR: HIDETAG
    if (command.startsWith("h ") || command === "h") {
      if (!isAdmin && !isOwner) return;
      const pesanH = text.slice(2).trim() || "Pesan Penting!";
      const mems = participants.map((p) => p.id);
      try {
        await sock.sendMessage(jid, { delete: msg.key });
      } catch (e) {}
      return await sock.sendMessage(
        jid,
        { text: pesanH, mentions: mems },
        { quoted: msg },
      );
    }

    // 12. FITUR: KICK
    if (command.startsWith("kick")) {
      if (!isAdmin && !isOwner) return;
      let victim =
        msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!victim) return await replyWithStyle("Tag atau reply orangnya!");
      if (victim === sender || victim.includes(sock.user.id.split(":")[0]))
        return await replyWithStyle("Tidak bisa kick diri sendiri/bot.");

      try {
        await sock.sendMessage(jid, { delete: msg.key });
      } catch (e) {}
      try {
        await sock.groupParticipantsUpdate(jid, [victim], "remove");
        await sock.sendMessage(jid, {
          text: `Sayonara 👋 @${victim.split("@")[0]}`,
          mentions: [victim],
        });
      } catch (err) {
        await replyWithStyle("Gagal! Pastikan bot Admin.");
      }
      return;
    }

    // 13 & 14. BLACKLIST
    if (command.startsWith("addbl")) {
      if (!isAdmin && !isOwner) return;
      let victim =
        msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!victim) return await replyWithStyle("Tag/Reply target!");
      let bl = getBlacklist();
      if (!bl.includes(victim)) {
        bl.push(victim);
        saveBlacklist(bl);
      }
      await sock.groupParticipantsUpdate(jid, [victim], "remove");
      return await replyWithStyle(
        `🚫 @${victim.split("@")[0]} ditambahkan ke BLACKLIST.`,
      );
    }

    if (command.startsWith("unbl")) {
      if (!isAdmin && !isOwner) return;
      const target = text.slice(5).trim();
      let bl = getBlacklist().filter((v) => !v.includes(target));
      saveBlacklist(bl);
      return await replyWithStyle(
        `✅ Berhasil menghapus ${target} dari blacklist.`,
      );
    }

    // --- SISTEM PAYMENT ---
    const payDB = getPaymentDB();

    // A & B. ADD/UPDATE/REMOVE PAYMENT
    if (
      command.startsWith("addpayment ") ||
      command.startsWith("updatepayment ")
    ) {
      if (!isAdmin && !isOwner) return;
      const offset = command.startsWith("update") ? 14 : 11;
      const bodyPayload = text.slice(offset);
      const splitIndex = bodyPayload.indexOf("@");
      if (splitIndex === -1)
        return await replyWithStyle("Format: *addpayment keyword@keterangan*");

      const keyPay = bodyPayload.slice(0, splitIndex).toLowerCase().trim();
      const infoPay = bodyPayload.slice(splitIndex + 1).trim();
      let pathFoto = null;

      const quoted =
        msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage) {
        const {
          downloadContentFromMessage,
        } = require("@whiskeysockets/baileys");
        const stream = await downloadContentFromMessage(
          quoted.imageMessage,
          "image",
        );
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        pathFoto = `./payment_media/${keyPay}.jpg`;
        fs.writeFileSync(pathFoto, buffer);
      }
      payDB[keyPay] = { info: infoPay, image: pathFoto };
      savePaymentDB(payDB);
      return await replyWithStyle(`✅ Payment *${keyPay}* disimpan!`);
    }

    if (command.startsWith("removepayment ")) {
      if (!isAdmin && !isOwner) return;
      const keyDel = text.slice(14).toLowerCase().trim();
      if (payDB[keyDel]?.image && fs.existsSync(payDB[keyDel].image))
        fs.unlinkSync(payDB[keyDel].image);
      delete payDB[keyDel];
      savePaymentDB(payDB);
      return await replyWithStyle(`🗑️ Payment *${keyDel}* dihapus.`);
    }

    if (isOwner && command.startsWith("refresh")) {
      const chatId = msg.key.remoteJid;
      await sock.sendMessage(
        chatId,
        { text: "⏳ *SYNCING...*\n\nNarik data terbaru dari Supabase..." },
        { quoted: msg },
      );

      const sukses = await syncCloud("refresh"); // Panggil mode refresh

      if (sukses) {
        await sock.sendMessage(
          chatId,
          { text: "✅ *SYNC DONE!*\n\nDatabase lokal udah diperbarui." },
          { quoted: msg },
        );
      } else {
        await sock.sendMessage(
          chatId,
          { text: "❌ *SYNC FAILED*" },
          { quoted: msg },
        );
      }
      return;
    }

    // C. AUTO-REPLY PAYMENT
    if (payDB[command]) {
      await sock.sendPresenceUpdate("composing", jid);
      await delay(2000);
      const item = payDB[command];
      if (item.image) {
        await sock.sendMessage(
          jid,
          { image: fs.readFileSync(item.image), caption: item.info },
          { quoted: msg },
        );
      } else {
        await sock.sendMessage(jid, { text: item.info }, { quoted: msg });
      }
      return;
    }
  });

  sock.ev.on("group-participants.update", async (anu) => {
    const { id, participants, action } = anu;
    const bl = getBlacklist();
    const metadata = await sock.groupMetadata(id);

    for (let p of participants) {
      // Pastikan 'p' adalah string nomor HP
      const num = typeof p === "string" ? p : p.id;
      if (!num) continue; // Skip jika data tidak valid

      const userTag = num.split("@")[0];

      if (action === "add") {
        // 1. CEK BLACKLIST
        if (bl.includes(num)) {
          await sock.sendMessage(id, {
            text: `🚫 @${userTag} terdeteksi dalam daftar BLACKLIST! Mengeluarkan otomatis...`,
            mentions: [num],
          });
          await delay(2000);
          await sock.groupParticipantsUpdate(id, [num], "remove");
          continue;
        }

        // 2. PESAN WELCOME
        let welcomeText = `┏━━━━━ *SELAMAT DATANG* ━━━━━┓\n┃\n`;
        welcomeText += `┃ 👋 *Halo @${userTag}*\n`;
        welcomeText += `┃ Selamat bergabung di:\n`;
        welcomeText += `┃ 🏢 *${metadata.subject}*\n┃\n`;
        welcomeText += `┃ 📜 *CARA CEK PRODUK:*\n`;
        welcomeText += `┃ Silahkan ketik *list* untuk melihat\n`;
        welcomeText += `┃ daftar produk & layanan kami.\n┃\n`;
        welcomeText += `┗━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
        welcomeText += `✨ *${metadata.subject}* - _Happy Shopping!_`;
        await sock.sendMessage(id, { text: welcomeText, mentions: [num] });
      } else if (action === "remove") {
        // 3. PESAN BYE
        let byeText = `👋 *SAYONARA...*\n\nSelamat tinggal @${userTag}\nTerima kasih sudah pernah mampir di *${metadata.subject}*. 🙏`;
        await sock.sendMessage(id, { text: byeText, mentions: [num] });
      }
    }
  });
}

// Konfigurasi Supabase
const supabaseUrl = "https://tedgrclpgqwxilowtnsx.supabase.co"; // Ganti Pake URL lu
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlZGdyY2xwZ3F3eGlsb3d0bnN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTQwMDksImV4cCI6MjA4ODg3MDAwOX0.8ECdMGPC04z4U1e8b8b9G4ryKMc5hymBd2BUAHdexvY"; // Ganti Pake Anon Key lu
const supabase = createClient(supabaseUrl, supabaseKey);

// Fitur Auto Backup ke Supabase
// Fitur Auto Backup 4 Database ke Supabase
const dbFiles = [
  { namaKey: "db_produk", path: "./database_produk.json" },
  { namaKey: "db_blacklist", path: "./database_blacklist.json" },
  { namaKey: "db_payment", path: "./database_payment.json" },
  { namaKey: "db_groups", path: "./database_groups.json" },
];

async function syncCloud(type = "backup") {
  try {
    if (type === "backup") {
      // --- LOGIKA UPLOAD (Lokal -> Cloud) ---
      let gabungan = {};
      for (let file of dbFiles) {
        if (fs.existsSync(file.path)) {
          gabungan[file.namaKey] = JSON.parse(
            fs.readFileSync(file.path, "utf8"),
          );
        }
      }
      const { error } = await supabase
        .from("bot_backups")
        .insert([{ data_backup: gabungan }]);
      if (error) throw error;
      console.log("✅ [CLOUD] Backup Berhasil!");
      return true;
    } else if (type === "refresh") {
      // --- LOGIKA DOWNLOAD (Cloud -> Lokal) ---
      const { data, error } = await supabase
        .from("bot_backups")
        .select("data_backup")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return false;

      const cloudData = data[0].data_backup;
      for (let file of dbFiles) {
        if (cloudData[file.namaKey]) {
          fs.writeFileSync(
            file.path,
            JSON.stringify(cloudData[file.namaKey], null, 2),
          );
        }
      }
      console.log("✅ [CLOUD] Refresh Berhasil!");
      return true;
    }
  } catch (e) {
    console.log(`❌ [CLOUD ERROR] Gagal ${type}:`, e.message);
    return false;
  }
}

// Jalankan backup otomatis tiap 1 jam
setInterval(
  () => {
    syncCloud("backup");
  },
  1 * 60 * 60 * 1000,
);
startBot();
