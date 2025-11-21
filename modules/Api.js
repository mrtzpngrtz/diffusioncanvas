import { compressImage } from './Utils.js';

export class Api {
    constructor(callbacks) {
        this.callbacks = callbacks || {};
    }

    async generateImage(node) {
        // Only collect images DIRECTLY connected to this node
        // Don't inherit images from chained prompts to avoid payload size issues
        let imageNodes = [...(node.data.connectedImages || [])];

        // Build combined prompt from connected prompts and own prompt
        let promptParts = [];
        
        // Add connected prompts first
        if (node.data.connectedPrompts && node.data.connectedPrompts.length > 0) {
            node.data.connectedPrompts.forEach(promptNode => {
                const connectedPrompt = promptNode.data.prompt.trim();
                if (connectedPrompt) {
                    promptParts.push(connectedPrompt);
                }
            });
        }
        
        // Add this node's own prompt/action
        let ownPrompt = '';
        if (node.type === 'prompt') {
            ownPrompt = node.data.prompt.trim();
        } else if (node.type === 'action') {
            ownPrompt = node.data.action.trim();
        }
        
        if (ownPrompt) {
            promptParts.push(ownPrompt);
        }
        
        // Combine all prompts
        const prompt = promptParts.join(', ');
        
        if (!prompt) {
            this.updateStatus('No prompt or action provided', '#e74c3c');
            return;
        }

        const generateBtn = node.element.querySelector('.generate-btn');
        const originalText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> Generating...';
        this.updateStatus('Generating image...', '#667eea');

        try {
            // Collect all image data from connected nodes and compress them
            const images = [];
            if (imageNodes.length > 0) {
                this.updateStatus('Compressing images...', '#667eea');
                for (const imageNode of imageNodes) {
                    if (imageNode.data.imageData) {
                        const compressed = await compressImage(imageNode.data.imageData, 1024);
                        images.push(compressed);
                    }
                }
                this.updateStatus('Generating image...', '#667eea');
            }

            // Call the backend API (with or without images)
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    images: images,  // Send array of images
                    aspectRatio: node.data.aspectRatio || '16:9',  // Send aspect ratio
                    model: node.data.model // Send selected model
                })
            }); 

            if (!response.ok) {
                let errorMessage = 'Failed to generate image';
                
                // Special handling for 413 Payload Too Large
                if (response.status === 413) {
                    errorMessage = 'Images are too large for the server to process.\n\n' +
                        'Solutions:\n' +
                        '• Use smaller images (< 1MB each)\n' +
                        '• Reduce the number of connected images\n' +
                        '• Resize images before uploading';
                    throw new Error(errorMessage);
                }
                
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (e) {
                    // If response is not JSON, try to get text
                    try {
                        const text = await response.text();
                        if (text) {
                            errorMessage = text.substring(0, 200); // Limit error message length
                        }
                    } catch (textError) {
                        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    }
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            
            if (result.image) {
                if (this.callbacks.onImageGenerated) {
                    this.callbacks.onImageGenerated(node, result.image, result.creditsRemaining);
                }
                this.updateStatus('Image generated successfully!', '#27ae60');
            } else if (result.text) {
                this.updateStatus(`Generated text: ${result.text}`, '#667eea');
                alert(`API Response: ${result.text}\n\nNote: No image was generated. The model may have returned text instead.`);
            } else {
                throw new Error('No image or text returned from API');
            }

        } catch (error) {
            console.error('Generation error:', error);
            this.updateStatus(`Error: ${error.message}`, '#e74c3c');
            
            let errorMessage = `Generation failed: ${error.message}`;
            if (error.message.includes('fetch')) {
                errorMessage += '\n\nMake sure the backend server is running on http://localhost:3000';
                errorMessage += '\nRun: npm start';
            }
            alert(errorMessage);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

    async generateVideo(node) {
        const prompt = node.data.prompt.trim();
        
        if (!prompt) {
            this.updateStatus('No prompt provided', '#e74c3c');
            return;
        }

        const generateBtn = node.element.querySelector('.generate-btn');
        const originalText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> Generating Video...';
        this.updateStatus('Generating video with Veo 3.1...', '#9b59b6');

        try {
            // Prepare frame data if images are connected
            const frames = {};
            
            if (node.data.frameAssignments.first && node.data.frameAssignments.first.data.imageData) {
                this.updateStatus('Compressing first frame...', '#9b59b6');
                frames.first = await compressImage(node.data.frameAssignments.first.data.imageData, 1024);
            }
            
            if (node.data.frameAssignments.middle && node.data.frameAssignments.middle.data.imageData) {
                this.updateStatus('Compressing middle frame...', '#9b59b6');
                frames.middle = await compressImage(node.data.frameAssignments.middle.data.imageData, 1024);
            }
            
            if (node.data.frameAssignments.last && node.data.frameAssignments.last.data.imageData) {
                this.updateStatus('Compressing last frame...', '#9b59b6');
                frames.last = await compressImage(node.data.frameAssignments.last.data.imageData, 1024);
            }

            this.updateStatus('Calling Veo 3.1 API...', '#9b59b6');

            // Call the backend API
            const response = await fetch('/api/generate-video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    prompt: prompt,
                    duration: node.data.duration,
                    aspectRatio: node.data.aspectRatio,
                    frames: Object.keys(frames).length > 0 ? frames : null
                })
            });

            if (!response.ok) {
                let errorMessage = 'Failed to generate video';
                
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (e) {
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            if (result.video) {
                if (this.callbacks.onVideoGenerated) {
                    this.callbacks.onVideoGenerated(node, result.video, result.duration, result.aspectRatio, result.creditsRemaining);
                }
                this.updateStatus('Video generated successfully!', '#27ae60');
            } else {
                throw new Error('No video returned from API');
            }

        } catch (error) {
            console.error('Video generation error:', error);
            this.updateStatus(`Error: ${error.message}`, '#e74c3c');
            alert(`Video generation failed: ${error.message}`);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

    updateStatus(message, color = '#555') {
        if (this.callbacks.updateStatus) {
            this.callbacks.updateStatus(message, color);
        }
    }
}
