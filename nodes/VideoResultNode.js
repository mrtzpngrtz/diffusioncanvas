import { NodeBase } from './NodeBase.js';

// Displays a generated video. Borderless like image results; hover reveals
// the header pill, action pill and prompt/model meta.
export class VideoResultNode extends NodeBase {
    create(nodeId, x, y, videoUrl, sourceNode, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node result-node videoresult-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '400px';

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Generated Video', 'i-film')}
            <div class="node-content"></div>
            ${this.createConnectionPoints(nodeId, true, false)}
        `;

        const video = document.createElement('video');
        video.controls = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        if (videoUrl) video.src = videoUrl;
        video.addEventListener('pointerdown', (e) => e.stopPropagation()); // scrubbing must not drag the node

        const node = {
            id: nodeId,
            type: 'videoresult',
            element: nodeEl,
            data: { video, videoData: videoUrl, sourcePromptNode: sourceNode },
            position: { x, y }
        };

        const content = nodeEl.querySelector('.node-content');
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper video-wrapper';
        wrapper.appendChild(video);

        const scaleIndicator = document.createElement('div');
        scaleIndicator.className = 'scale-indicator';
        scaleIndicator.textContent = '…';
        wrapper.appendChild(scaleIndicator);
        video.addEventListener('loadedmetadata', () => {
            node.data.originalWidth  = video.videoWidth;
            node.data.originalHeight = video.videoHeight;
            scaleIndicator.textContent = `${video.videoWidth}×${video.videoHeight} · ${Math.round(video.duration)}s`;
        });

        const metaEl = document.createElement('div');
        metaEl.className = 'result-meta';
        metaEl.innerHTML = `
            <div class="result-meta-prompt"></div>
            <div class="result-meta-model"></div>
            <button class="result-meta-copy" title="Copy prompt">copy</button>
        `;
        wrapper.appendChild(metaEl);
        content.appendChild(wrapper);

        metaEl.querySelector('.result-meta-copy').addEventListener('click', (e) => {
            e.stopPropagation();
            const text = node.data.prompt || '';
            if (!text) return;
            const btn = e.currentTarget;
            navigator.clipboard.writeText(text).then(() => {
                btn.textContent = 'copied';
                setTimeout(() => { btn.textContent = 'copy'; }, 1500);
            });
        });

        node.updateMeta = () => {
            const p = node.data.prompt || '';
            const m = node.data.model || '';
            metaEl.querySelector('.result-meta-prompt').textContent = p;
            metaEl.querySelector('.result-meta-model').textContent = m;
            metaEl.classList.toggle('result-meta-has-data', !!(p || m));
        };

        // Load a (possibly late-fetched) source into the player
        node.setVideoSrc = (src) => {
            node.data.videoData = src;
            video.src = src;
        };

        const actionButtons = document.createElement('div');
        actionButtons.className = 'image-actions';
        actionButtons.innerHTML = `
            <button class="icon-btn star-btn" title="Star"><svg class="icon"><use href="#i-star"/></svg></button>
            <button class="icon-btn meta-btn" title="Prompt / model"><svg class="icon"><use href="#i-chat"/></svg></button>
            <button class="icon-btn download-btn" title="Download"><svg class="icon"><use href="#i-download"/></svg></button>
            <button class="icon-btn icon-btn-std" title="Reset to standard size"><svg class="icon"><use href="#i-frame"/></svg></button>
        `;
        wrapper.appendChild(actionButtons);

        actionButtons.querySelector('.star-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.starred = !node.data.starred;
            e.currentTarget.classList.toggle('starred', node.data.starred);
            nodeEl.classList.toggle('starred', node.data.starred);
        });
        actionButtons.querySelector('.meta-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (metaEl.classList.contains('result-meta-has-data')) metaEl.classList.toggle('result-meta-visible');
        });
        actionButtons.querySelector('.download-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!node.data.videoData) return;
            const a = document.createElement('a');
            a.href = node.data.videoData;
            a.download = 'generated-video.mp4';
            document.body.appendChild(a); a.click(); a.remove();
        });
        actionButtons.querySelector('.icon-btn-std').addEventListener('click', (e) => {
            e.stopPropagation();
            nodeEl.style.width = '400px';
        });

        nodeEl.querySelector('.node-close').addEventListener('click', () => callbacks.removeNode(nodeId));
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
