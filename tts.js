const axios = require('axios');

async function textToSpeech(text) {
    try {
        const response = await axios.post(
            'https://api.cartesia.ai/tts/bytes',
            {
                model_id: 'sonic-multilingual',
                transcript: text,
                voice: {
                    mode: 'id',
                    id: '6bc79efd-c7cb-4b36-93a8-444453531015' // Ayush (Male)
                },
                output_format: {
                    container: 'raw',
                    encoding: 'pcm_mulaw',  // Twilio needs mulaw 8kHz
                    sample_rate: 8000
                },
                language: 'hi'
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
    } catch (err) {
        if (err.response && err.response.data) {
            const errorBody = Buffer.from(err.response.data).toString();
            console.error('❌ Cartesia API Error Detail:', errorBody);
        }
        throw err;
    }
}

module.exports = { textToSpeech };