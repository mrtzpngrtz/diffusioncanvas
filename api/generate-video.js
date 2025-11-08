import { VertexAI } from '@google-cloud/vertexai';
import { getAuthUser } from '../jwt-auth.js';
import { storage } from '../storage.js';

// Initialize Vertex AI
// Credentials should be set in environment variables:
// - GOOGLE_CLOUD_PROJECT_ID (your project ID)
// - GOOGLE_APPLICATION_CREDENTIALS_JSON (your service account JSON as a string)
let vertexAI;
try {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || process.env.PROJECT_ID;
    
    if (!projectId) {
        console.error('Missing GOOGLE_CLOUD_PROJECT_ID environment variable');
    }
    
    // Parse service account credentials from environment
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
        ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : undefined;
    
    vertexAI = new VertexAI({
        project: projectId,
        location: 'us-central1', // Veo 3.1 is available in us-central1
        googleAuthOptions: credentials ? {
            credentials: credentials
        } : undefined
    });
} catch (error) {
    console.error('Error initializing Vertex AI:', error);
}

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Check if Vertex AI is initialized
        if (!vertexAI) {
            return res.status(501).json({ 
                error: 'Veo 3.1 video generation requires Vertex AI setup',
                details: 'Please ensure GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS_JSON are set in your Vercel environment variables.',
                documentation: 'https://cloud.google.com/vertex-ai/docs/start/client-libraries'
            });
        }

        // Check authentication
        const user = getAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Refresh user data to get latest credits
        const users = await storage.getUsers();
        const fullUser = users.find(u => u.id === user.id);
        if (!fullUser) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Check if user has enough credits (video generation costs more - 5 credits)
        const VIDEO_GENERATION_COST = 5;
        if (!fullUser.credits || fullUser.credits < VIDEO_GENERATION_COST) {
            return res.status(403).json({ 
                error: `Insufficient credits. Video generation requires ${VIDEO_GENERATION_COST} credits. You have ${fullUser.credits || 0}.` 
            });
        }

        const { prompt, duration = 8, aspectRatio = '16:9', frames } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }

        console.log('Generating video with Veo 3.1 via Vertex AI:', {
            prompt,
            duration,
            aspectRatio,
            hasFrames: frames ? Object.keys(frames).filter(k => frames[k]).length > 0 : false
        });

        // Get the generative model for Veo
        const generativeVisionModel = vertexAI.getGenerativeModel({
            model: 'veo-3.0-fast-generate-001',
        });

        // Build the request
        const request = {
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                videoDuration: duration,
                aspectRatio: aspectRatio
            }
        };

        // Add frame guidance if provided
        if (frames) {
            const frameParts = [];
            
            if (frames.first) {
                let imageData = frames.first;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameParts.push({
                    inlineData: {
                        data: imageData,
                        mimeType: 'image/jpeg'
                    }
                });
            }
            
            if (frames.middle) {
                let imageData = frames.middle;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameParts.push({
                    inlineData: {
                        data: imageData,
                        mimeType: 'image/jpeg'
                    }
                });
            }
            
            if (frames.last) {
                let imageData = frames.last;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameParts.push({
                    inlineData: {
                        data: imageData,
                        mimeType: 'image/jpeg'
                    }
                });
            }
            
            if (frameParts.length > 0) {
                request.contents[0].parts.push(...frameParts);
            }
        }

        // Generate video
        console.log('Calling Vertex AI Veo 3.1 API...');
        const result = await generativeVisionModel.generateContent(request);
        
        const response = await result.response;

        // Process response
        if (!response || !response.candidates || response.candidates.length === 0) {
            console.error('No video generated:', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                error: 'No video generated by the model.'
            });
        }

        // Get the video data from the response
        const candidate = response.candidates[0];
        const videoData = candidate.content?.parts?.[0];
        
        if (!videoData || (!videoData.videoData && !videoData.fileData)) {
            console.error('No video data in response:', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                error: 'No video data in API response.'
            });
        }
        
        // Deduct credits from user
        const userIndex = users.findIndex(u => u.id === fullUser.id);
        if (userIndex !== -1) {
            users[userIndex].credits = (users[userIndex].credits || 0) - VIDEO_GENERATION_COST;
            await storage.setUsers(users);
        }

        // Return video data
        // Vertex AI returns video as fileData with a URI or as direct video bytes
        const videoUrl = videoData.fileData?.fileUri || videoData.videoData?.videoUri;
        const videoBytes = videoData.inlineData?.data || videoData.videoData?.videoBytes;

        res.json({
            video: videoUrl || videoBytes,
            videoUrl: videoUrl,
            creditsRemaining: users[userIndex].credits,
            duration: duration,
            aspectRatio: aspectRatio
        });

    } catch (error) {
        console.error('Error generating video:', error);
        
        // Check if it's an authentication error
        if (error.message?.includes('credentials') || error.message?.includes('authentication')) {
            return res.status(501).json({ 
                error: 'Vertex AI authentication failed',
                details: 'Please check your GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable.',
                originalError: error.message
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to generate video'
        });
    }
}
