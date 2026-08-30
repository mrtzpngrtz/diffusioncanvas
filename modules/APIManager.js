export class APIManager {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    async _compositeMask(baseData, maskData) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const mask = new Image();
                mask.onload = () => {
                    ctx.drawImage(mask, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.92));
                };
                mask.src = maskData;
            };
            img.src = baseData;
        });
    }

    async _compositeText(imageData, text) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const fontSize = Math.max(20, Math.round(img.naturalWidth * 0.05));
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.shadowColor = 'rgba(0,0,0,0.85)';
                ctx.shadowBlur = fontSize * 0.5;
                ctx.fillStyle = '#ffffff';
                ctx.fillText(text, img.naturalWidth / 2, img.naturalHeight - fontSize * 0.8);
                resolve(c.toDataURL('image/jpeg', 0.92));
            };
            img.src = imageData;
        });
    }

    async compressImage(imageData, maxWidth = 1024) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = () => reject(new Error('Failed to load image for compression'));
            img.src = imageData;
        });
    }

    // Native pixel size of the first connected medium (image / result / drawing).
    // Used server-side to honour aspectRatio 'original'.
    _sourceDimensions(node) {
        const source = (node.data.connectedImages || [])
            .find(n => n.data.originalWidth > 0 && n.data.originalHeight > 0);
        return {
            sourceWidth: source ? source.data.originalWidth : null,
            sourceHeight: source ? source.data.originalHeight : null
        };
    }

    async callAPI(prompt, images = [], model, aspectRatio = '1:1', resolution = 'hd', outputFormat = 'jpg', steps, guidance, sourceWidth = null, sourceHeight = null) {
        const compressed = [];
        for (const imgData of images) {
            if (imgData) compressed.push(await this.compressImage(imgData, 1024));
        }
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, images: compressed, model, aspectRatio, resolution, outputFormat, steps, guidance, sourceWidth, sourceHeight })
        });
        if (!response.ok) {
            let msg = `HTTP ${response.status}`;
            try { msg = (await response.json()).error || msg; } catch {}
            throw new Error(msg);
        }
        const result = await response.json();
        if (!result.image) throw new Error('No image returned');
        return result;
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
        if (node.type === 'prompt' || node.type === 'format') {
            ownPrompt = (node.data.prompt || '').trim();
        } else if (node.type === 'action') {
            ownPrompt = node.data.action.trim();
        }
        
        if (ownPrompt) {
            promptParts.push(ownPrompt);
        }
        
        // Combine all prompts
        const prompt = promptParts.join(', ');
        
        if (!prompt) {
            this.uiManager.updateStatus('No prompt or action provided', '#e74c3c');
            return;
        }
    
        const generateBtn = node.element.querySelector('.generate-btn');
        const originalText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> Generating...';
        this.uiManager.updateStatus('Generating image...', '#667eea');
    
        try {
            // Collect all image data from connected nodes and compress them
            const images = [];
            if (imageNodes.length > 0) {
                this.uiManager.updateStatus('Compressing images...', '#667eea');
                for (const imageNode of imageNodes) {
                    if (imageNode.data.imageData) {
                        let imgData = imageNode.data.imageData;
                        if (imageNode.data.overlayText?.trim()) {
                            imgData = await this._compositeText(imgData, imageNode.data.overlayText);
                        }
                        if (imageNode.data.maskData) {
                            imgData = await this._compositeMask(imgData, imageNode.data.maskData);
                        }
                        const compressed = await this.compressImage(imgData, 1024);
                        images.push(compressed);
                    }
                }
                this.uiManager.updateStatus('Generating image...', '#667eea');
            }
    
            // Call the backend API (with or without images)
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt,
                    images,
                    aspectRatio: node.data.aspectRatio || 'original',
                    resolution: node.data.resolution || 'hd',
                    outputFormat: node.data.outputFormat || 'jpg',
                    model: node.data.model,
                    steps: node.data.steps,
                    guidance: node.data.guidance,
                    ...this._sourceDimensions(node)
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
                // Create a result node with the generated image
                // Note: We need to call back to NodeManager/Canvas to create the node
                // Ideally APIManager returns the result and NodeManager handles UI creation
                // But for now let's call a method on NodeManager if we can, or return the result
                
                // Since APIManager doesn't have NodeManager reference (to avoid circular dependency mess if strict),
                // we can assume the caller (NodeManager or App) handles the result.
                // But wait, NodeManager calls this.
                
                // So APIManager should return the result, and NodeManager handles creating the result node.
                return {
                    success: true,
                    image: result.image,
                    creditsRemaining: result.creditsRemaining,
                    prompt,
                    model: node.data.model
                };

            } else if (result.text) {
                this.uiManager.updateStatus(`Generated text: ${result.text}`, '#667eea');
                alert(`API Response: ${result.text}\n\nNote: No image was generated. The model may have returned text instead.`);
                return { success: false };
            } else {
                throw new Error('No image or text returned from API');
            }
    
        } catch (error) {
            console.error('Generation error:', error);
            this.uiManager.updateStatus(`Error: ${error.message}`, '#e74c3c');
            
            let errorMessage = `Generation failed: ${error.message}`;
            if (error.message.includes('fetch')) {
                errorMessage += '\n\nMake sure the backend server is running on http://localhost:3000';
                errorMessage += '\nRun: npm start';
            }
            alert(errorMessage);
            return { success: false, error: error.message };
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

    // ── IMAGE → 3D ───────────────────────────────────────────────────────────
    // Submit → poll the shared job endpoint. Returns { modelData, modelType, modelName }.
    async generate3D(node) {
        const source = (node.data.connectedImages || []).find(n => n.data.imageData);
        if (!source) {
            this.uiManager.updateStatus('Connect an image first', '#e74c3c');
            return { success: false };
        }
        const promptParts = [];
        (node.data.connectedPrompts || []).forEach(p => { const t = (p.data.prompt || '').trim(); if (t) promptParts.push(t); });
        const own = (node.data.prompt || '').trim();
        if (own) promptParts.push(own);
        const prompt = promptParts.join(', ');

        const generateBtn = node.element.querySelector('.generate-btn');
        const originalText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> Submitting…';

        let timer = null;
        try {
            const image = await this.compressImage(source.data.imageData, 1024);
            const res = await fetch('/api/generate-3d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: node.data.model, image, prompt, quality: node.data.quality, seed: node.data.seed })
            });
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try { msg = (await res.json()).error || msg; } catch {}
                throw new Error(msg);
            }
            const { jobId } = await res.json();

            const started = Date.now();
            const tick = () => {
                const s = Math.round((Date.now() - started) / 1000);
                generateBtn.innerHTML = `<span class="loading"></span> ${s}s`;
                this.uiManager.updateStatus(`Generating 3D model… ${s}s`, '#667eea');
            };
            tick();
            timer = setInterval(tick, 1000);

            while (true) {
                await new Promise(r => setTimeout(r, 4000));
                const jr = await fetch(`/api/video-jobs/${jobId}`);
                if (jr.status === 404) throw new Error('3D job was lost (server restarted?). Please try again.');
                if (!jr.ok) continue;
                const job = await jr.json();
                if (job.status === 'completed') {
                    return { success: true, modelData: job.modelData, modelType: job.modelType, modelName: job.modelName, prompt, model: node.data.model, creditsRemaining: job.creditsRemaining };
                }
                if (job.status === 'failed') throw new Error(job.error || '3D generation failed.');
            }
        } catch (error) {
            console.error('3D generation error:', error);
            this.uiManager.updateStatus(`Error: ${error.message}`, '#e74c3c');
            alert(`3D generation failed: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (timer) clearInterval(timer);
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

    // ── VIDEO ────────────────────────────────────────────────────────────────
    // Submit → poll /api/video-jobs/:id. Connected images map to frames:
    // input 1 = first frame, input 2 = last frame.
    async generateVideo(node) {
        const promptParts = [];
        (node.data.connectedPrompts || []).forEach(p => {
            const t = (p.data.prompt || '').trim();
            if (t) promptParts.push(t);
        });
        const own = (node.data.prompt || '').trim();
        if (own) promptParts.push(own);
        const prompt = promptParts.join(', ');
        if (!prompt) {
            this.uiManager.updateStatus('No prompt provided', '#e74c3c');
            return { success: false };
        }

        const generateBtn = node.element.querySelector('.generate-btn');
        const originalText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> Submitting…';

        let timer = null;
        try {
            const frameSources = (node.data.connectedImages || [])
                .map(n => n.data.imageData).filter(Boolean).slice(0, 2);
            const frames = [];
            for (const src of frameSources) frames.push(await this.compressImage(src, 1280));

            const res = await fetch('/api/generate-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    model: node.data.model,
                    resolution: node.data.resolution,
                    aspectRatio: node.data.aspectRatio,
                    duration: node.data.duration,
                    audio: node.data.audio,
                    firstFrame: frames[0] || null,
                    lastFrame: frames[1] || null
                })
            });
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try { msg = (await res.json()).error || msg; } catch {}
                throw new Error(msg);
            }
            const { jobId } = await res.json();

            const started = Date.now();
            const tick = () => {
                const s = Math.round((Date.now() - started) / 1000);
                generateBtn.innerHTML = `<span class="loading"></span> ${s}s`;
                this.uiManager.updateStatus(`Generating video… ${s}s`, '#667eea');
            };
            tick();
            timer = setInterval(tick, 1000);

            while (true) {
                await new Promise(r => setTimeout(r, 4000));
                const jr = await fetch(`/api/video-jobs/${jobId}`);
                if (jr.status === 404) throw new Error('Video job was lost (server restarted?). Please try again.');
                if (!jr.ok) continue; // transient — keep polling
                const job = await jr.json();
                if (job.status === 'completed') {
                    return { success: true, video: job.video, prompt, model: node.data.model, creditsRemaining: job.creditsRemaining };
                }
                if (job.status === 'failed') throw new Error(job.error || 'Video generation failed.');
            }
        } catch (error) {
            console.error('Video generation error:', error);
            this.uiManager.updateStatus(`Error: ${error.message}`, '#e74c3c');
            alert(`Video generation failed: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (timer) clearInterval(timer);
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

}
