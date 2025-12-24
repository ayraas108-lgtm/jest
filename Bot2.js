// WhatsApp Group Welcome Bot - Fixed & Updated (2025)
// Uses @whiskeysockets/baileys (Multi-Device)
// Features: .welcome on | off | set <message>

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  PHONENUMBER_MCC,
  delay,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const welcomeDataFile = 'welcome_data.json';

// Load welcome settings
let welcomeData = {};
if (fs.existsSync(welcomeDataFile)) {
  try {
    welcomeData = JSON.parse(fs.readFileSync(welcomeDataFile, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse welcome_data.json, starting fresh.');
    welcomeData = {};
  }
}

function saveWelcomeData() {
  fs.writeFileSync(welcomeDataFile, JSON.stringify(welcomeData, null, 2));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Connection handling
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        delay(3000).then(() => startBot());
      }
    } else if (connection === 'open') {
      console.log('✅ Bot connected successfully!');
    }
  });

  // Command handler
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;

    const from = m.key.remoteJid;
    if (!from.endsWith('@g.us')) return; // Only process group messages

    // Extract text properly from various message types
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      m.message.videoMessage?.caption ||
      '';

    if (!text.toLowerCase().startsWith('.welcome')) return;

    const sender = m.key.participant || m.key.remoteJid;
    const args = text.slice(8).trim(); // Remove '.welcome'
    const command = args.split(' ')[0]?.toLowerCase() || '';
    const body = args.slice(command.length).trim();

    try {
      const metadata = await sock.groupMetadata(from);
      const participants = metadata.participants || [];
      const isAdmin = participants.find(p => p.id === sender)?.admin !== null;

      if (!isAdmin) {
        return sock.sendMessage(from, { text: '❌ Only group admins can use this command!' });
      }

      if (command === 'on') {
        welcomeData[from] = welcomeData[from] || {};
        welcomeData[from].enabled = true;
        welcomeData[from].message = welcomeData[from].message || 'Welcome {user} to {group}! 👋';
        saveWelcomeData();
        await sock.sendMessage(from, { text: '✅ Welcome messages enabled!' });

      } else if (command === 'off') {
        if (welcomeData[from]) welcomeData[from].enabled = false;
        saveWelcomeData();
        await sock.sendMessage(from, { text: '🚫 Welcome messages disabled!' });

      } else if (command === 'set' && body) {
        welcomeData[from] = welcomeData[from] || {};
        welcomeData[from].message = body;
        welcomeData[from].enabled = true;
        saveWelcomeData();
        await sock.sendMessage(from, {
          text: `🛠️ Custom welcome message set:\n\n${body}\n\n*Variables:* {user}, {group}, {description}`,
        });

      } else {
        await sock.sendMessage(from, {
          text: `*Welcome Message Setup*\n\n✅ *.welcome on* — Enable welcome messages\n🛠️ *.welcome set <message>* — Set custom message\n🚫 *.welcome off* — Disable welcome messages\n\n*Variables:*\n• {user} - Mentions new member\n• {group} - Group name\n• {description} - Group description`,
        });
      }
    } catch (err) {
      console.error('Error in command handler:', err);
      await sock.sendMessage(from, { text: '❌ An error occurred.' });
    }
  });

  // Welcome new members
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add') return;

    const settings = welcomeData[id];
    if (!settings || !settings.enabled) return;

    try {
      const metadata = await sock.groupMetadata(id);
      const groupName = metadata.subject;
      const groupDesc = metadata.desc?.toString() || '';

      const customMsg = settings.message || 'Welcome {user} to {group}! 👋';

      for (const user of participants) {
        const formattedMsg = customMsg
          .replace(/{user}/g, `@${user.split('@')[0]}`)
          .replace(/{group}/g, groupName)
          .replace(/{description}/g, groupDesc);

        await sock.sendMessage(id, {
          text: formattedMsg,
          mentions: [user],
        });
      }
    } catch (err) {
      console.error('Error sending welcome message:', err);
    }
  });
}

startBot().catch(err => console.error('Bot failed to start:', err));
