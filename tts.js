const axios = require('axios');

async function textToSpeech(text) {
    const response = await axios.post(
        'https://api.cartesia.ai/tts/bytes',
        {
            // ✅ BUG 6 FIXED: Hindi ke liye sonic-multilingual use karo
            // sonic-english Hindi bolne mein galat pronunciation karta tha
            model_id: 'sonic-multilingual',
            transcript: text,
            voice: { mode: 'id', id: 'a0e99841-438c-4a64-b679-ae501e7d6091' },
            output_format: {
                container: 'raw',
                encoding: 'pcm_mulaw',  // Twilio needs mulaw 8kHz
                sample_rate: 8000
            },
            language: 'hi'  // ✅ Hindi language specify karo
        },
        {
            headers: {
                'X-API-Key': process.env.CARTESIA_API_KEY,
                'Cartesia-Version': '2024-06-10',
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
        }
    );

    return Buffer.from(response.data).toString('base64');
}

module.exports = { textToSpeech };