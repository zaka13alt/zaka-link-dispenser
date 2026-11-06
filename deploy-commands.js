require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in your .env file."
  );
}

const panelCommand = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Open the link dispenser or manage its links.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("open")
      .setDescription("Open your private link dispenser.")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a link to a category.")
      .addStringOption((option) =>
        option
          .setName("link")
          .setDescription("The URL to add.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("category")
          .setDescription("Category name, for example Batch Lightspeed.")
          .setRequired(true)
      )
  );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: [panelCommand.toJSON()] }
)
  .then(() => console.log("Registered /panel open and /panel add."))
  .catch(console.error);
