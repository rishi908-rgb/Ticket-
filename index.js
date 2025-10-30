import fs from 'fs';
import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.TOKEN;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // Category where tickets are created
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // Staff role ID
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null; // Optional: channel ID to send transcripts

if (!TOKEN) {
  console.error('ERROR: TOKEN not set in environment variables. Please add your bot token to .env or Render env variables.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

let openTickets = new Set(); // track open tickets by `${guildId}-${userId}-${category}`

function createTicketPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Pixel Node - Support Tickets')
    .setDescription('Need help? Create a support ticket by selecting a category from the menu below.\n\nOur team will respond as soon as possible.')
    .setColor(0x00AEFF)
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_ticket_category')
    .setPlaceholder('🧾 Select a support category')
    .addOptions([
      {
        label: 'Billing Support',
        description: 'Questions about payments, invoices, and billing',
        value: 'billing',
        emoji: '💳',
      },
      {
        label: 'Technical Support',
        description: 'Server issues, errors, and technical problems',
        value: 'technical',
        emoji: '🛠️',
      },
      {
        label: 'Sales Inquiry',
        description: 'Product questions and purchasing assistance',
        value: 'sales',
        emoji: '💼',
      },
      {
        label: 'General Support',
        description: 'Other questions and general assistance',
        value: 'general',
        emoji: '📝',
      },
    ]);

  const row = new ActionRowBuilder().addComponents(select);
  return { embeds: [embed], components: [row] };
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Simple command to post the ticket panel (use in a channel where you want the panel)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.content === '!ticketpanel') {
    const panel = createTicketPanel();
    await message.channel.send(panel);
    try { await message.reply({ content: '✅ Ticket panel posted.' }); } catch(e){}
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'select_ticket_category') return;
      const category = interaction.values[0]; // 'billing', 'technical', etc.
      const guild = interaction.guild;
      const user = interaction.user;

      const ticketKey = `${guild.id}-${user.id}-${category}`;
      if (openTickets.has(ticketKey)) {
        await interaction.reply({ content: '❗ You already have an open ticket in this category.', ephemeral: true });
        return;
      }

      // Channel name: ticket-{category}-{username}
      const safeName = `${user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 20) || user.id;
      const channelName = `ticket-${category}-${safeName}`;

      // Create channel
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID || null,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
          },
          {
            id: STAFF_ROLE_ID,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
          },
        ],
      });

      openTickets.add(ticketKey);

      const embed = new EmbedBuilder()
        .setTitle('🎫 New Ticket')
        .setDescription(`Hello <@${user.id}> — a staff member will be with you shortly.\n\n**Category:** ${category.charAt(0).toUpperCase() + category.slice(1)}`)
        .setColor(0x2ECC71)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('transcript').setLabel('📄 Save Transcript').setStyle(ButtonStyle.Secondary)
      );

      // Store creator id in channel topic for permission checks (topic limited length)
      try {
        await channel.setTopic(`ticket|${user.id}`);
      } catch(e){}

      await channel.send({ content: `<@${user.id}> <@&${STAFF_ROLE_ID}>`, embeds: [embed], components: [row] });
      await interaction.reply({ content: `✅ Your ticket has been created: ${channel}`, ephemeral: true });
    }

    if (interaction.isButton && interaction.isButton()) {
      const customId = interaction.customId;
      const channel = interaction.channel;
      const guild = interaction.guild;
      if (!channel || !guild) return;

      if (customId === 'close_ticket') {
        // Only allow staff or the ticket creator to close
        const member = interaction.member;
        const creatorId = channel.topic ? channel.topic.split('|')[1] : null;
        const isStaff = member.roles ? member.roles.cache.has(STAFF_ROLE_ID) : false;
        if (!isStaff && interaction.user.id !== creatorId) {
          await interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
          return;
        }

        await interaction.reply({ content: '🕓 Closing ticket in 5 seconds...' });
        // Save transcript if LOG_CHANNEL_ID is set
        if (LOG_CHANNEL_ID) {
          await saveTranscript(channel, guild);
        }
        setTimeout(() => {
          channel.delete().catch(console.error);
        }, 5000);
        return;
      }

      if (customId === 'transcript') {
        await interaction.reply({ content: '📄 Saving transcript...', ephemeral: true });
        await saveTranscript(channel, guild, interaction);
        return;
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try { if (interaction && !interaction.replied) await interaction.reply({ content: 'An error occurred.', ephemeral: true }); } catch(e){}
  }
});

async function saveTranscript(channel, guild, interaction=null) {
  try {
    const messages = await fetchAllMessages(channel);
    // Build transcript text
    let txt = `Transcript for #${channel.name} — ${new Date().toISOString()}\n\n`;
    for (const msg of messages) {
      const time = new Date(msg.createdTimestamp).toISOString();
      const author = msg.author ? `${msg.author.tag}` : 'Unknown';
      const content = msg.content || '';
      txt += `[${time}] ${author}: ${content}\n`;
      if (msg.attachments && msg.attachments.size > 0) {
        for (const att of msg.attachments.values()) {
          txt += `  (attachment) ${att.url}\n`;
        }
      }
    }

    const buffer = Buffer.from(txt, 'utf8');
    const filename = `${channel.name}-transcript-${Date.now()}.txt`;

    if (LOG_CHANNEL_ID) {
      const logCh = await guild.channels.fetch(LOG_CHANNEL_ID).catch(()=>null);
      if (logCh && logCh.isTextBased && logCh.send) {
        await logCh.send({ content: `Transcript for ${channel.name}`, files: [{ attachment: buffer, name: filename }] });
        if (interaction) await interaction.followUp({ content: '✅ Transcript saved to log channel.', ephemeral: true });
        return;
      }
    }

    // If no log channel, save locally (only works if running on your machine or persistent storage)
    const outPath = `./transcripts/${filename}`;
    fs.mkdirSync('./transcripts', { recursive: true });
    fs.writeFileSync(outPath, txt);
    if (interaction) await interaction.followUp({ content: `✅ Transcript saved to server path: ${outPath}`, ephemeral: true });
  } catch (err) {
    console.error('Transcript error:', err);
    if (interaction) try { await interaction.followUp({ content: '❌ Failed to save transcript.', ephemeral: true }); } catch(e){}
  }
}

async function fetchAllMessages(channel) {
  const messages = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;
    messages.push(...Array.from(fetched.values()).reverse());
    lastId = fetched.last().id;
    if (fetched.size < 100) break;
  }
  return messages;
}

client.login(TOKEN);
