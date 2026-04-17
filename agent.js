require('dotenv').config();
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const Groq = require('groq-sdk');
const { textToSpeech } = require('./tts');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `Aap Ayush hain, ek energetic aur helpful AI assistant.
Aapka tone friendly aur conversational hona chahiye (Jaise doston se baat karte hain).
Thoda natural Hinglish use karein (English words like 'Sure', 'Actually', 'I see' allowed).
Short responses dein, 1-2 lines maximum.`;

async function getLLMResponse(userText, conversationHistory) {
    conversationHistory.push({ role: 'user', content: userText });

    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...conversationHistory
        ],
        max_tokens: 150,
        temperature: 0.7
    });

    const reply = response.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: reply });
    return reply;
}

function handleStream(ws) {
    let streamSid = null;
    let dgConnection = null;
    let isProcessing = false;

    // ✅ BUG 4 FIXED: conversationHistory ab per-call hai, global nahi
    // Pehle yeh bahar tha — sab calls ek hi history share karte the!
    const conversationHistory = [];

    async function sendAudio(text) {
        try {
            const audioBase64 = await textToSpeech(text);
            if (ws.readyState === ws.OPEN && streamSid) {
                ws.send(JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: { payload: audioBase64 }
                }));
            }
        } catch (err) {
            console.error('TTS error:', err.message);
        }
    }

    async function startDeepgram() {
        dgConnection = deepgram.listen.live({
            model: 'nova-2',
            language: 'hi',          // ✅ Sahi language code
            smart_format: true,
            interim_results: true,
            endpointing: 500,
            encoding: 'mulaw',
            sample_rate: 8000
        });

        dgConnection.on(LiveTranscriptionEvents.Open, async () => {
            console.log('✅ Deepgram connection opened');

            // ✅ BUG 5 FIXED: Greeting message — AI pehle bolta hai
            await sendAudio('Namaste! Main aapka AI assistant hun. Aap kya jaanna chahte hain?');
        });

        dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            if (!transcript || !data.is_final || isProcessing) return;

            console.log('🎤 User said:', transcript);
            isProcessing = true;

            try {
                const aiReply = await getLLMResponse(transcript, conversationHistory);
                console.log('🤖 AI says:', aiReply);
                await sendAudio(aiReply);
            } catch (err) {
                console.error('Pipeline error:', err.message);
            } finally {
                isProcessing = false;
            }
        });

        dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
            console.error('❌ Deepgram error:', err);
        });

        dgConnection.on(LiveTranscriptionEvents.Close, () => {
            console.log('Deepgram connection closed');
        });
    }

    startDeepgram();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                streamSid = data.start.streamSid;
                console.log('📞 Stream started:', streamSid);
            }

            if (data.event === 'media' && dgConnection) {
                const audioBuffer = Buffer.from(data.media.payload, 'base64');
                dgConnection.send(audioBuffer);
            }

            if (data.event === 'stop') {
                console.log('📵 Call ended');
                dgConnection?.finish();
            }
        } catch (err) {
            console.error('Message parse error:', err.message);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket closed');
        dgConnection?.finish();
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        dgConnection?.finish();
    });
}

module.exports = { handleStream };