require('dotenv').config();
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const Groq = require('groq-sdk');
const { textToSpeech } = require('./tts');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Conversation memory
const conversationHistory = [];
const SYSTEM_PROMPT = `Aap ek helpful AI phone assistant hain.
Jawab Hindi mein, chhota aur natural rakhein.`;

async function getLLMResponse(userText) {
    conversationHistory.push({ role: 'user', content: userText });

    const response = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
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

    // Start Deepgram live transcription
    async function startDeepgram() {
        dgConnection = deepgram.listen.live({
            model: 'nova-2',
            language: 'hi',      // Change to 'hi' for Hindi
            smart_format: true,
            interim_results: true,
            endpointing: 500,        // ms of silence to end utterance
            encoding: 'mulaw',
            sample_rate: 8000
        });

        dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript || !data.is_final || isProcessing) return;

            console.log('User said:', transcript);
            isProcessing = true;

            try {
                // Get AI response
                const aiReply = await getLLMResponse(transcript);
                console.log('AI says:', aiReply);

                // Convert to speech and send back to Twilio
                const audioBase64 = await textToSpeech(aiReply);
                if (ws.readyState === ws.OPEN && streamSid) {
                    ws.send(JSON.stringify({
                        event: 'media',
                        streamSid,
                        media: { payload: audioBase64 }
                    }));
                }
            } catch (err) {
                console.error('Pipeline error:', err);
            } finally {
                isProcessing = false;
            }
        });

        dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
            console.error('Deepgram error:', err);
        });
    }

    startDeepgram();

    // Handle incoming audio from Twilio
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.event === 'start') {
            streamSid = data.start.streamSid;
            console.log('Stream started:', streamSid);
        }

        if (data.event === 'media' && dgConnection) {
            const audioBuffer = Buffer.from(data.media.payload, 'base64');
            dgConnection.send(audioBuffer);
        }

        if (data.event === 'stop') {
            console.log('Call ended');
            dgConnection?.finish();
        }
    });

    ws.on('close', () => {
        dgConnection?.finish();
    });
}

module.exports = { handleStream };