require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');
const twilio = require('twilio');
const { handleStream } = require('./agent');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ✅ BUG 1 FIXED: Removed duplicate AccessToken/VoiceGrant declarations
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// Twilio calls this when browser makes a call
app.post('/incoming-call', (req, res) => {
    console.log('Incoming call received:', req.body);

    // ✅ BUG 2 FIXED: req.headers.host se wss URL sahi ban raha hai
    const host = req.headers.host;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media-stream"/>
  </Connect>
</Response>`;

    res.type('text/xml').send(twiml);
});

// Token endpoint for browser client
app.get('/token', (req, res) => {
    try {
        const token = new AccessToken(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY,
            process.env.TWILIO_API_SECRET,
            {
                identity: 'browser-user',
                ttl: 3600
            }
        );

        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
            incomingAllow: true
        });

        token.addGrant(voiceGrant);
        console.log('Token generated for browser-user');
        res.json({ token: token.toJwt() });
    } catch (err) {
        console.error('Token generation failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve browser client from /public
app.use(express.static(path.join(__dirname, 'public')));

// Warn on startup if required env vars are missing
[
    'DEEPGRAM_API_KEY', 'GROQ_API_KEY', 'CARTESIA_API_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'
].forEach(key => {
    if (!process.env[key]) console.warn(`⚠️  WARNING: ${key} is not set`);
});

const server = createServer(app);

// ✅ BUG 3 FIXED: WebSocket path '/media-stream' explicitly handle karo
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url === '/media-stream') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws) => {
    console.log('✅ Call connected via /media-stream');
    handleStream(ws);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});