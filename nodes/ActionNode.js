import { NodeBase } from './NodeBase.js';

export class ActionNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node action-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Action Preset', 'i-zap')}
            <div class="node-content">
                <select class="action-select">
                    <option value="">Select an action...</option>
                    <optgroup label="Color & tone">
                        <option value="colorize this image naturally, keeping every detail intact">Colorize</option>
                        <option value="make it black and white with rich contrast and fine grain">Black & white</option>
                        <option value="add warm golden tones">Warm tones</option>
                        <option value="add cool blue-teal tones">Cool tones</option>
                        <option value="apply a cinematic teal and orange color grade">Teal & orange grade</option>
                        <option value="desaturate to a muted, editorial palette">Muted palette</option>
                        <option value="make the colors vivid and saturated">Vivid colors</option>
                        <option value="increase contrast and clarity without changing content">More contrast</option>
                        <option value="soften the image with a gentle pastel look">Pastel look</option>
                        <option value="add a vintage faded film filter">Vintage film</option>
                    </optgroup>
                    <optgroup label="Time & weather">
                        <option value="make it a night scene with realistic artificial lights">Night</option>
                        <option value="make it a bright daytime scene">Day</option>
                        <option value="turn it into golden hour with long warm shadows">Golden hour</option>
                        <option value="turn it into blue hour twilight">Blue hour</option>
                        <option value="add thick atmospheric fog">Fog</option>
                        <option value="add falling snow and a light snow cover">Snow</option>
                        <option value="add heavy rain with wet reflective surfaces">Rain</option>
                        <option value="make it an overcast, soft-light day">Overcast</option>
                        <option value="make it autumn with warm foliage">Autumn</option>
                        <option value="make it spring with fresh greens and blossoms">Spring</option>
                        <option value="make it a hot summer scene">Summer</option>
                        <option value="make it deep winter">Winter</option>
                    </optgroup>
                    <optgroup label="Lighting & camera">
                        <option value="add dramatic directional lighting with deep shadows">Dramatic lighting</option>
                        <option value="add soft diffused studio lighting">Soft studio light</option>
                        <option value="add strong rim light from behind the subject">Rim light</option>
                        <option value="add neon light spill in magenta and cyan">Neon spill</option>
                        <option value="add shallow depth of field with a creamy bokeh background">Shallow depth of field</option>
                        <option value="make it look like a 35mm film photograph with grain">35mm film look</option>
                        <option value="make it look like a long exposure with motion trails">Long exposure</option>
                        <option value="add lens flare and haze from a low sun">Lens flare</option>
                        <option value="turn it into a high-key bright, airy image">High key</option>
                        <option value="turn it into a low-key moody image">Low key</option>
                    </optgroup>
                    <optgroup label="Style & medium">
                        <option value="make it look like an oil painting with visible brushwork">Oil painting</option>
                        <option value="make it a loose watercolor illustration">Watercolor</option>
                        <option value="make it a clean pencil sketch">Pencil sketch</option>
                        <option value="make it a detailed ink line drawing">Ink drawing</option>
                        <option value="turn it into a flat vector illustration">Flat vector</option>
                        <option value="turn it into a 90s anime still">Anime</option>
                        <option value="turn it into a comic book panel with halftone shading">Comic book</option>
                        <option value="turn it into a claymation stop-motion look">Claymation</option>
                        <option value="turn it into an isometric low-poly 3D render">Low-poly 3D</option>
                        <option value="turn it into a photorealistic 3D product render">3D product render</option>
                        <option value="turn it into a risograph print with two spot colors">Risograph</option>
                        <option value="turn it into a cyanotype blueprint">Cyanotype</option>
                        <option value="turn it into pixel art">Pixel art</option>
                        <option value="turn it into a bauhaus-style poster">Bauhaus poster</option>
                    </optgroup>
                    <optgroup label="Composition">
                        <option value="extend the scene naturally beyond all borders (outpaint)">Outpaint / extend scene</option>
                        <option value="crop tighter on the main subject">Tighter crop</option>
                        <option value="center the main subject and balance the composition">Center subject</option>
                        <option value="add more negative space around the subject">More negative space</option>
                        <option value="change to a low camera angle looking up">Low angle</option>
                        <option value="change to a top-down bird's-eye view">Top-down view</option>
                        <option value="mirror the image horizontally, keeping text readable">Mirror</option>
                    </optgroup>
                    <optgroup label="Retouch & product">
                        <option value="remove the background and place the subject on plain white">Cutout on white</option>
                        <option value="replace the background with a clean studio gradient">Studio background</option>
                        <option value="remove all people from the scene">Remove people</option>
                        <option value="remove all text, logos and watermarks">Remove text & logos</option>
                        <option value="clean up dust, scratches and noise">Clean up & denoise</option>
                        <option value="sharpen and upscale, adding fine realistic detail">Sharpen & enhance</option>
                        <option value="add a subtle realistic drop shadow under the product">Product shadow</option>
                        <option value="place the product on a marble surface with soft light">Marble surface</option>
                        <option value="add a matching reflection below the subject">Reflection</option>
                    </optgroup>
                    <optgroup label="Scene & mood">
                        <option value="make it look abandoned and overgrown">Abandoned & overgrown</option>
                        <option value="make it futuristic and sci-fi">Futuristic</option>
                        <option value="make it look like the 1970s">1970s</option>
                        <option value="make it minimal and clean, removing clutter">Minimal & clean</option>
                        <option value="make it luxurious and premium">Luxurious</option>
                        <option value="make it playful and colorful">Playful</option>
                        <option value="make it cozy with warm interior light">Cozy</option>
                        <option value="make it look underwater">Underwater</option>
                        <option value="add a miniature tilt-shift effect">Tilt-shift miniature</option>
                    </optgroup>
                </select>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <button class="node-btn generate-btn" disabled>Generate Image</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'action',
            element: nodeEl,
            data: { action: '', connectedImages: [] },
            position: { x, y }
        };

        // Select handling
        const select = nodeEl.querySelector('.action-select');
        select.addEventListener('change', (e) => {
            node.data.action = e.target.value;
            callbacks.updateGenerateButton(node);
        });

        // Generate button
        const generateBtn = nodeEl.querySelector('.generate-btn');
        generateBtn.addEventListener('click', () => callbacks.generateImage(node));

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Connection points
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });

        // Resize handle — every node type is freely resizable
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
