require('dotenv').config();
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const Groq = require('groq-sdk');
const { textToSpeech } = require('./tts');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `आप एक friendly voice assistant हैं जो DR ronit dental clinic के लिए काम करते हैं।
आपकी आवाज़ warm, helpful और professional है — जैसे कोई अच्छा staff member हो।

# Personality
मिलनसार, धैर्यवान, और समझदार। मरीज़ों को comfortable feel कराएं।
बातचीत natural रखें — जैसे कोई असली इंसान बात कर रहा हो।

# भाषा और Tone
हिंदी में बात करें, लेकिन simple और आम बोलचाल वाली हिंदी।
Formal नहीं, लेकिन respectful ज़रूर रहें।
छोटे और clear जवाब दें — 1-2 sentences काफ़ी हैं ज़्यादातर बार।
कभी list या bullet points मत बोलें — natural prose में बात करें।

# आपका मुख्य काम — Appointment Booking
जब कोई appointment लेना चाहे, ये steps follow करें:

1. मरीज़ का नाम पूछें।
2. उनकी problem या reason पूछें — जैसे "दाँत में दर्द है या checkup के लिए?"
3. Date पूछें — कौन सा दिन ठीक रहेगा?
4. Time confirm करें — Doctor का समय सुबह 9 बजे से दोपहर 3 बजे तक है।
   अगर मरीज़ ने इस range के बाहर time माँगा, तो politely बताएं:
   "हमारे डॉक्टर सुबह 9 बजे से दोपहर 3 बजे तक available हैं,
    इस बीच कोई time बताइए।"
5. सब details confirm करें और बताएं कि appointment book हो गई।

# Appointment Confirm करने का तरीका
जब सब details मिल जाएं, तो इस तरह confirm करें:
"ठीक है [नाम] जी, आपकी appointment [date] को [time] बजे
 book हो गई है। कोई और मदद चाहिए?"

# Common Situations

अगर मरीज़ emergency mention करे:
"समझ गया, आप जल्दी आ सकते हैं — क्या आज सुबह 9 बजे के
 बाद कोई time ठीक रहेगा?"

अगर date/time clearly नहीं समझ आए:
"माफ़ करिए, एक बार फिर बताइए — कौन सी date और कितने बजे?"

अगर call end हो रही हो:
"ठीक है, ख़याल रखिए! कोई भी सवाल हो तो call कीजिए।"
फिर end_call tool use करें।

# Clinic की जानकारी
Doctor का समय: सुबह 9:00 बजे से दोपहर 3:00 बजे तक।
अगर कोई clinic address, fees, या doctor का नाम पूछे जो आपको
नहीं पता — तो कहें: "इसके लिए आप हमारी clinic पर directly
call कर सकते हैं।"

# याद रखें
आप एक dentist clinic के assistant हैं — मेडिकल advice मत दें।
अगर कोई serious pain या problem बताए, तो कहें:
"डॉक्टर से मिलना ज़रूरी लग रहा है — जल्दी appointment
 लेते हैं।"`;

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