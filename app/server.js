// --- Fastify（変更なし） ---
const path = require("path");
const fastify = require("fastify")({ logger: false });
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
});
fastify.register(require("@fastify/formbody"));
fastify.register(require("@fastify/view"), {
  engine: { handlebars: require("handlebars") },
});
const seo = require("./src/seo.json");
if (seo.url === "glitch-default") seo.url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
fastify.get("/", (req, rep) => rep.view("/src/pages/index.hbs", { seo }));
fastify.post("/", (req, rep) => rep.view("/src/pages/index.hbs", { seo }));
fastify.listen({ port: process.env.PORT, host: "0.0.0.0" }, err => {
  if (err) throw err;
  console.log("Fastify listening");
});

// --- Discord Bot ---
const fs = require("fs");
const { Client, Intents, MessageActionRow, MessageSelectMenu } = require("discord.js");

// 追加：スラッシュコマンド登録に必要なパッケージ
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_VOICE_STATES,
  ],
});

const weapons = require("./weapons.json");
let records = {};
if (fs.existsSync("./records.json")) {
  records = JSON.parse(fs.readFileSync("./records.json", "utf8"));
}

let tempMatch = { alpha: null, bravo: null, users: null };

// --- スラッシュコマンド定義 ---
const commands = [
  {
    name: "random",
    description: "VCにいるユーザーにランダムで武器を割り振ります",
  },
  {
    name: "rule",
    description: "スプラトゥーンのルールをランダム表示します",
  },
  {
    name: "purabe",
    description: "プライベートマッチのVC選択と成績管理",
  },
  {
    name: "purabe_reset",
    description: "成績をリセットします",
  },
  {
    name: "purabe_resetvc",
    description: "VC設定をリセットします",
  },
  {
    name: "purabe_rank",
    description: "成績ランキングを表示します",
  },
  {
    name: "sororam",
    description: "ランダムでブキが与えられます（1人用）",
  },
];

// 環境変数からIDを取得（Glitchなどで設定推奨）
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

// スラッシュコマンドをサーバーに登録する関数
async function registerCommands() {
  const rest = new REST({ version: "9" }).setToken(token);
  try {
    console.log("スラッシュコマンドを登録中...");
    await rest.put(
  Routes.applicationCommands(clientId),
  { body: commands }
);
    console.log("スラッシュコマンドの登録に成功しました！");
  } catch (error) {
    console.error("スラッシュコマンドの登録中にエラーが発生しました:", error);
  }
}

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  registerCommands(); // 起動時にスラッシュコマンドを登録
});

// --- messageCreateイベント（テキストコマンドは無効化） ---
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  // ここにテキストコマンド処理を残したいなら書くが
  // スラッシュコマンドはinteractionCreateに移行したのでここではスルー
});

// --- interactionCreateイベント（スラッシュコマンド & セレクトメニュー処理） ---
client.on("interactionCreate", async interaction => {
  // セレクトメニュー処理
  if (interaction.isSelectMenu()) {
    if (interaction.customId === "vcSelect") {
      tempMatch.alpha = interaction.values[0];
      await interaction.reply({ content: "✅ 上VC選択済。下VCを選んでください。", ephemeral: true });
      return;
    }
    if (interaction.customId === "vcSelect2") {
      tempMatch.bravo = interaction.values[0];
      const alphaVC = interaction.guild.channels.cache.get(tempMatch.alpha);
      const bravoVC = interaction.guild.channels.cache.get(tempMatch.bravo);
      const alphaMembers = [...alphaVC.members.values()].filter(m => !m.user.bot);
      const bravoMembers = [...bravoVC.members.values()].filter(m => !m.user.bot);
      tempMatch.users = {
        alpha: alphaMembers.map(m => m.id),
        bravo: bravoMembers.map(m => m.id),
      };
      const row = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId("winnerSelect")
          .setPlaceholder("勝利チームを選んでください")
          .addOptions([
            { label: "アルファチーム", value: "alpha" },
            { label: "ブラボーチーム", value: "bravo" },
          ])
      );
      await interaction.reply({ content: "✅ VCが設定されました！試合の勝利チームを選んでください：", components: [row] });
      return;
    }
    if (interaction.customId === "winnerSelect") {
      const winner = interaction.values[0];
      const loser = winner === "alpha" ? "bravo" : "alpha";
      const alphaVC = interaction.guild.channels.cache.get(tempMatch.alpha);
      const bravoVC = interaction.guild.channels.cache.get(tempMatch.bravo);
      const alphaMembers = [...alphaVC.members.values()].filter(m => !m.user.bot);
      const bravoMembers = [...bravoVC.members.values()].filter(m => !m.user.bot);

      for (const member of alphaMembers) {
        if (!records[member.id]) records[member.id] = { win: 0, lose: 0 };
        if (winner === "alpha") records[member.id].win++;
        else records[member.id].lose++;
      }
      for (const member of bravoMembers) {
        if (!records[member.id]) records[member.id] = { win: 0, lose: 0 };
        if (winner === "bravo") records[member.id].win++;
        else records[member.id].lose++;
      }
      fs.writeFileSync("./records.json", JSON.stringify(records, null, 2));

      const summaryLines = [];
      for (const [id, rec] of Object.entries(records)) {
        const total = rec.win + rec.lose;
        const rate = total > 0 ? ((rec.win / total) * 100).toFixed(1) : "0.0";
        summaryLines.push(`<@${id}> - ${rec.win}勝 ${rec.lose}敗 勝率${rate}%`);
      }
      summaryLines.sort((a, b) => {
        const getRate = str => parseFloat(str.match(/勝率([\d.]+)%/)[1]);
        return getRate(b) - getRate(a);
      });

      await interaction.reply({
        content: "✅ 試合結果を記録しました！\n\n📊 **【個人成績 & 勝率ランキング】**\n" + summaryLines.join("\n")
      });
      return;
    }
  }

  // スラッシュコマンド処理
  if (!interaction.isCommand()) return;

  const { commandName, member, guild } = interaction;

  if (commandName === "random") {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: "まずはVCに入ってから使ってね！", ephemeral: true });
      return;
    }
    const members = voiceChannel.members.filter(m => !m.user.bot);
    if (members.size === 0) {
      await interaction.reply({ content: "VCに人がいません。", ephemeral: true });
      return;
    }
    const shuffledWeapons = weapons.sort(() => Math.random() - 0.5).slice(0, members.size);
    let replyText = "🦑ブキ割り振り結果 🦑\n";
    let i = 0;
    for (const [memberId, member] of members) {
      const weapon = shuffledWeapons[i] || weapons[Math.floor(Math.random() * weapons.length)];
      replyText += `・${member.displayName} → **${weapon}**\n`;
      i++;
    }
    await interaction.reply(replyText);
  }
  else if (commandName === "rule") {
    const rules = ["ナワバリバトル", "ガチエリア", "ガチヤグラ", "ガチホコバトル", "ガチアサリ"];
    const randomRule = rules[Math.floor(Math.random() * rules.length)];
    await interaction.reply(`🦑 次のルールは: **${randomRule}** です！`);
  }
  else if (commandName === "sororam") {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: "まずはVCに入ってから使ってね！", ephemeral: true });
      return;
    }
    const weapon = weapons[Math.floor(Math.random() * weapons.length)];
    await interaction.reply(`🦑 ${member.displayName} のランダムブキは **${weapon}** です！`);
  }
  else if (commandName === "purabe") {
    // /purabe コマンドの処理をここに書く
    if (tempMatch.alpha && tempMatch.bravo) {
      const row = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId("winnerSelect")
          .setPlaceholder("勝利チームを選んでください")
          .addOptions([
            { label: "アルファチーム", value: "alpha" },
            { label: "ブラボーチーム", value: "bravo" },
          ])
      );
      await interaction.reply({
        content: "前回のVC設定を使用します。勝利チームを選んでください：",
        components: [row],
        ephemeral: true,
      });
      return;
    }

    const vcs = interaction.guild.channels.cache.filter(c => c.type === "GUILD_VOICE");
    const vcOptions = [...vcs.values()].map(vc => ({ label: vc.name, value: vc.id }));
    if (vcOptions.length < 2) {
      await interaction.reply({ content: "VCが2つ以上必要です", ephemeral: true });
      return;
    }

    const row = new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId("vcSelect")
        .setPlaceholder("上のVCを選んでください")
        .addOptions(vcOptions)
    );
    const row2 = new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId("vcSelect2")
        .setPlaceholder("下のVCを選んでください")
        .addOptions(vcOptions)
    );

    await interaction.reply({ content: "VCを選んでください：", components: [row, row2], ephemeral: true });
  }
  else if (commandName === "purabe_reset") {
    records = {};
    fs.writeFileSync("./records.json", JSON.stringify(records, null, 2));
    await interaction.reply("✅ 成績をリセットしました！");
  }
  else if (commandName === "purabe_resetvc") {
    tempMatch = { alpha: null, bravo: null, users: null };
    await interaction.reply("✅ VC設定をリセットしました！");
  }
  else if (commandName === "purabe_rank") {
    if (Object.keys(records).length === 0) {
      await interaction.reply("成績がありません。");
      return;
    }
    const sorted = Object.entries(records).sort((a, b) => {
      const aw = a[1].win || 0, al = a[1].lose || 0;
      const bw = b[1].win || 0, bl = b[1].lose || 0;
      const aRate = aw + al > 0 ? aw / (aw + al) : 0;
      const bRate = bw + bl > 0 ? bw / (bw + bl) : 0;
      return bRate - aRate;
    });
    const lines = sorted.map(([id, r]) => `<@${id}>: ${r.win}勝 ${r.lose}敗`);
    await interaction.reply("📊 **勝率ランキング**\n" + lines.join("\n"));
  }
});

client.login(token);
