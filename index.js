require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require("discord.js");

const linksPath = path.join(__dirname, "links.json");
// Discord limits: 4096 chars per embed description, 10 embeds and 6000 embed
// chars per message. Links are listed in descriptions and split to fit.
const EMBED_DESC_MAX = 4000;
const MESSAGE_EMBED_CHARS_MAX = 5800;
const MESSAGE_EMBEDS_MAX = 10;
const MAX_CATEGORIES = 25; // Discord select menus allow at most 25 options.

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function loadCategories() {
  const data = JSON.parse(fs.readFileSync(linksPath, "utf8"));

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("links.json must contain a JSON object of categories.");
  }

  return data;
}

function saveCategories(categories) {
  fs.writeFileSync(linksPath, `${JSON.stringify(categories, null, 2)}\n`);
}

function makeCategoryMenu(categories) {
  const options = Object.keys(categories).map((category) => ({
    label: category.slice(0, 100),
    value: category
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel_category")
    .setPlaceholder("Choose a category")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// A link entry in links.json is either a URL string or { "url": ..., "note": ... }.
const linkUrl = (entry) => (typeof entry === "string" ? entry : entry && entry.url) || "";
const linkNote = (entry) => (entry && typeof entry === "object" && entry.note ? String(entry.note) : "");

// Build the link list as embeds, grouped into messages that fit Discord's limits.
function buildLinkMessages(category, links) {
  const lines = links
    .filter((entry) => linkUrl(entry))
    .map((entry, i) => {
      const note = linkNote(entry);
      return `${i + 1}. <${linkUrl(entry)}>${note ? ` (${note})` : ""}`;
    });
  const descriptions = [];
  let current = "";
  for (const line of lines) {
    const piece = line.slice(0, EMBED_DESC_MAX);
    if (current && current.length + 1 + piece.length > EMBED_DESC_MAX) {
      descriptions.push(current);
      current = "";
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current) descriptions.push(current);

  const messages = [];
  let embeds = [];
  let chars = 0;
  descriptions.forEach((desc, i) => {
    const title = i === 0 ? category.slice(0, 256) : `${category.slice(0, 240)} (cont.)`;
    const size = title.length + desc.length;
    if (embeds.length && (embeds.length >= MESSAGE_EMBEDS_MAX || chars + size > MESSAGE_EMBED_CHARS_MAX)) {
      messages.push(embeds);
      embeds = [];
      chars = 0;
    }
    embeds.push(new EmbedBuilder().setTitle(title).setDescription(desc));
    chars += size;
  });
  if (embeds.length) messages.push(embeds);
  return messages;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "open") {
      const categories = loadCategories();

      if (Object.keys(categories).length === 0) {
        await interaction.reply({
          content: "There are no link categories yet.",
          ephemeral: true
        });
        return;
      }

      // The panel itself is public so anyone can use it; the links each
      // person picks are sent back to them privately (see the select handler).
      await interaction.reply({
        content: "Choose a category. The links are sent only to you.",
        components: [makeCategoryMenu(categories)]
      });
      return;
    }

    if (subcommand === "add") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: "You need the Manage Server permission to add links.",
          ephemeral: true
        });
        return;
      }

      const link = interaction.options.getString("link", true).trim();
      const requestedCategory = interaction.options
        .getString("category", true)
        .trim();

      if (!isHttpUrl(link)) {
        await interaction.reply({
          content: "Please provide a valid `http://` or `https://` link.",
          ephemeral: true
        });
        return;
      }

      if (!requestedCategory || requestedCategory.length > 100) {
        await interaction.reply({
          content: "Category names must be between 1 and 100 characters.",
          ephemeral: true
        });
        return;
      }

      const categories = loadCategories();

      const existingCategory = Object.keys(categories).find(
        (name) => name.toLowerCase() === requestedCategory.toLowerCase()
      );
      const category = existingCategory || requestedCategory;

      if (!existingCategory && Object.keys(categories).length >= MAX_CATEGORIES) {
        await interaction.reply({
          content: "The panel has reached Discord's 25-category dropdown limit.",
          ephemeral: true
        });
        return;
      }

      if (!Array.isArray(categories[category])) {
        categories[category] = [];
      }

      if (categories[category].some((entry) => linkUrl(entry) === link)) {
        await interaction.reply({
          content: `That link is already in **${category}**.`,
          ephemeral: true
        });
        return;
      }

      categories[category].push(link);
      saveCategories(categories);

      await interaction.reply({
        content: `Added the link to **${category}** (${categories[category].length} link${categories[category].length === 1 ? "" : "s"}).`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "remove") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: "You need the Manage Server permission to remove links.",
          ephemeral: true
        });
        return;
      }

      const link = interaction.options.getString("link", true).trim();
      const requestedCategory = interaction.options
        .getString("category", true)
        .trim();

      const categories = loadCategories();
      const category = Object.keys(categories).find(
        (name) => name.toLowerCase() === requestedCategory.toLowerCase()
      );

      if (!category || !Array.isArray(categories[category])) {
        await interaction.reply({
          content: `There's no category named **${requestedCategory}**.`,
          ephemeral: true
        });
        return;
      }

      const before = categories[category].length;
      categories[category] = categories[category].filter(
        (entry) => linkUrl(entry) !== link
      );

      if (categories[category].length === before) {
        await interaction.reply({
          content: `That link isn't in **${category}**.`,
          ephemeral: true
        });
        return;
      }

      // Drop the category entirely once its last link is removed, so the panel
      // dropdown doesn't keep an empty category around.
      const emptied = categories[category].length === 0;
      if (emptied) delete categories[category];
      saveCategories(categories);

      await interaction.reply({
        content: emptied
          ? `Removed the link and the now-empty **${category}** category.`
          : `Removed the link from **${category}** (${categories[category].length} link${categories[category].length === 1 ? "" : "s"} left).`,
        ephemeral: true
      });
      return;
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "help") {
    const help = new EmbedBuilder()
      .setTitle("Link Dispenser — commands")
      .setDescription(
        [
          "**/panel open** — open the panel; the links you pick are sent only to you.",
          "**/panel add** `link` `category` — add a link to a category. *(Manage Server)*",
          "**/panel remove** `link` `category` — remove a link from a category. *(Manage Server)*",
          "**/help** — show this message."
        ].join("\n")
      );

    await interaction.reply({ embeds: [help], ephemeral: true });
    return;
  }

  if (
    !interaction.isStringSelectMenu() ||
    interaction.customId !== "panel_category"
  ) {
    return;
  }

  const categories = loadCategories();
  const category = interaction.values[0];
  const links = categories[category];

  // Re-render the shared public panel with a fresh menu so the dropdown resets
  // (otherwise it stays on the last pick and the same category can't be
  // re-selected), then send the links privately as follow-ups.
  await interaction.update({ components: [makeCategoryMenu(categories)] });

  if (!Array.isArray(links) || links.length === 0) {
    await interaction.followUp({
      content: `No links are configured for **${category}**.`,
      ephemeral: true
    });
    return;
  }

  for (const embeds of buildLinkMessages(category, links)) {
    await interaction.followUp({
      embeds,
      ephemeral: true,
      allowedMentions: { parse: [] }
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
