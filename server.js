import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize Google GenAI client
// The API key is automatically loaded from GOOGLE_API_KEY environment variable
const ai = new GoogleGenAI({});

app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, images } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }

        console.log('Generating image with prompt:', prompt);
        console.log('Number of images:', images ? images.length : 0);
        
        // Build the contents array in the correct format
        let contents = [];
        
        if (images && images.length > 0) {
            // Add the text prompt first
            contents.push({ text: `Based on these ${images.length} input image${images.length > 1 ? 's' : ''}, ${prompt}` });
            
            // Add all images to the contents
            images.forEach((image, index) => {
                // Remove the data:image/... prefix if present
                let imageData = image;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                
                contents.push({
                    inlineData: {
                        mimeType: 'image/png',
                        data: imageData
                    }
                });
            });
        } else {
            // Text-only prompt
            contents = [{ text: prompt }];
        }

        // Generate content using Gemini image generation model
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: contents
        });

        // Process response
        const result = {
            text: null,
            image: null
        };

        // Check if response has the expected structure
        if (!response || !response.candidates || !response.candidates[0]) {
            console.error('Unexpected API response structure:', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                error: 'Unexpected response from AI model. The model may not support image generation or returned an invalid response.'
            });
        }

        const candidate = response.candidates[0];
        
        // Check if candidate has content and parts
        if (!candidate.content || !candidate.content.parts) {
            console.error('No content in response:', JSON.stringify(candidate, null, 2));
            return res.status(500).json({ 
                error: 'No content returned from AI model. The model may not support this type of request.'
            });
        }

        for (const part of candidate.content.parts) {
            if (part.text) {
                result.text = part.text;
                console.log('Generated text:', part.text);
            } else if (part.inlineData) {
                // Convert to base64 data URL
                const imageData = part.inlineData.data;
                result.image = `data:image/png;base64,${imageData}`;
                console.log('Generated image (base64 length):', imageData.length);
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Error generating content:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to generate content'
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Make sure GOOGLE_API_KEY environment variable is set');
    
    if (!process.env.GOOGLE_API_KEY) {
        console.warn('WARNING: GOOGLE_API_KEY not set!');
        console.warn('Set it with: export GOOGLE_API_KEY="your-api-key"');
    }
});
