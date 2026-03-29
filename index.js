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

// Twilio calls this when someone calls your number
app.post('/incoming-call', (req, res) => {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Connect>
      <Stream url="wss://${req.headers.host}/media-stream"/>
    </Connect>
  </Response>`;
    res.type('text/xml').send(twiml);
});




const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Browser ko token deta hai
app.get('/token', (req, res) => {
    const token = new AccessToken(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_API_KEY,
        process.env.TWILIO_API_SECRET,
        { identity: 'browser-user' }
    );

    const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
        incomingAllow: true
    });

    token.addGrant(voiceGrant);
    res.json({ token: token.toJwt() });
});

// Serve browser client from /public
app.use(express.static(path.join(__dirname, 'public')));

// Warn on startup if required env vars are missing
[
    'DEEPGRAM_API_KEY', 'GROQ_API_KEY', 'CARTESIA_API_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'
].forEach(key => {
    if (!process.env[key]) console.warn(`WARNING: ${key} is not set in .env`);
});

const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Call connected');
    handleStream(ws);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));