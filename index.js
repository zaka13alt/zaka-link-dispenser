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
const MAX_LINKS_PER_CATEGORY = 5;
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

      await interaction.reply({
        content: "Choose a category. Only you can see this panel and its links.",
        components: [makeCategoryMenu(categories)],
        ephemeral: true
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

      if (categories[category].length >= MAX_LINKS_PER_CATEGORY) {
        await interaction.reply({
          content: `**${category}** already has five links. Remove one before adding another.`,
          ephemeral: true
        });
        return;
      }

      categories[category].push(link);
      saveCategories(categories);

      await interaction.reply({
        content: `Added the link to **${category}** (${categories[category].length}/${MAX_LINKS_PER_CATEGORY}).`,
        ephemeral: true
      });
      return;
    }
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

  if (!Array.isArray(links) || links.length === 0) {
    await interaction.update({
      content: `No links are configured for **${category}**.`,
      embeds: [],
      components: [makeCategoryMenu(categories)]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(category)
    .setDescription("Here are the links for this filter:");

  links.forEach((url, index) => {
    embed.addFields({
      name: `Link ${index + 1}`,
      value: `<${url}>`
    });
  });

  await interaction.update({
    content: "",
    embeds: [embed],
    components: [makeCategoryMenu(categories)],
    allowedMentions: { parse: [] }
  });
});

client.login(process.env.DISCORD_TOKEN);
