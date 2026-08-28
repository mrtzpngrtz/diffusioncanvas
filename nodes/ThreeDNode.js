import { NodeBase } from './NodeBase.js';

const THREE_BASE = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
const THREE_URL  = `${THREE_BASE}/build/three.module.js`;
const JSM        = `${THREE_BASE}/examples/jsm`;

export class ThreeDNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node threed-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top  = `${y}px`;
        nodeEl.style.width = '400px';

        nodeEl.innerHTML = `
            ${this.createNodeHeader('3D Viewer')}
            <div class="node-content">
                <div class="threed-dropzone">
                    <span class="threed-drop-icon">⬡</span>
                    <p>Drop .fbx or .obj</p>
                    <input type="file" accept=".fbx,.obj" style="display:none">
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, false, true)}
        `;

        const node = {
            id: nodeId,
            type: 'threed',
            element: nodeEl,
            data: { modelData: null, modelType: null, modelName: null, imageData: null },
            position: { x, y }
        };

        const content  = nodeEl.querySelector('.node-content');
        const dropZone = nodeEl.querySelector('.threed-dropzone');
        const fileInput = nodeEl.querySelector('input[type="file"]');
        const self = this;

        const loadFile = (file) => {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['fbx', 'obj'].includes(ext)) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                if (ext === 'fbx') {
                    // Store FBX as base64 so it is JSON-serialisable
                    const bytes = new Uint8Array(e.target.result);
                    let bin = '';
                    const CH = 8192;
                    for (let i = 0; i < bytes.length; i += CH)
                        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
                    node.data.modelData = btoa(bin);
                } else {
                    node.data.modelData = e.target.result; // text
                }
                node.data.modelType = ext;
                node.data.modelName = file.name;
                content.innerHTML = '';
                await self._setupViewer(node, content);
            };
            ext === 'fbx' ? reader.readAsArrayBuffer(file) : reader.readAsText(file);
        };

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
        });

        // Restoration hook called by NodeManager after Object.assign restores data
        node.restoreViewer = async () => {
            if (!node.data.modelData || !node.data.modelType) return;
            content.innerHTML = '';
            await self._setupViewer(node, content);
        };

        nodeEl.querySelector('.node-close').addEventListener('click', () => {
            if (node.data._cleanup3d) node.data._cleanup3d();
            callbacks.removeNode(nodeId);
        });

        nodeEl.querySelectorAll('.connection-point').forEach(pt =>
            this.setupConnectionPoint(pt, nodeId, callbacks.startConnection)
        );

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }

    async _setupViewer(node, content) {
        const ext = node.data.modelType;

        // Loading indicator
        const loadingEl = document.createElement('div');
        loadingEl.className = 'threed-loading';
        loadingEl.textContent = 'Loading…';
        content.appendChild(loadingEl);

        let THREE, OrbitControls, loader;
        try {
            THREE = await import(THREE_URL);
            ({ OrbitControls } = await import(`${JSM}/controls/OrbitControls.js`));
            if (ext === 'fbx') {
                const { FBXLoader } = await import(`${JSM}/loaders/FBXLoader.js`);
                loader = new FBXLoader();
            } else {
                const { OBJLoader } = await import(`${JSM}/loaders/OBJLoader.js`);
                loader = new OBJLoader();
            }
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Three.js failed to load:<br>${err.message}</div>`;
            return;
        }

        // Parse model data
        let object3d;
        try {
            if (ext === 'fbx') {
                const bin = atob(node.data.modelData);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                object3d = loader.parse(bytes.buffer);
            } else {
                object3d = loader.parse(node.data.modelData);
            }
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Parse failed:<br>${err.message}</div>`;
            return;
        }

        content.innerHTML = '';

        // Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'threed-wrapper';
        content.appendChild(wrapper);

        // Model name label
        const label = document.createElement('div');
        label.className = 'threed-label';
        label.textContent = node.data.modelName || '';
        wrapper.appendChild(label);

        // Renderer
        const W = wrapper.offsetWidth || 400;
        const H = Math.round(W * 0.72);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.setClearColor(0x111111);
        renderer.shadowMap.enabled = true;
        wrapper.appendChild(renderer.domElement);
        renderer.domElement.className = 'threed-canvas';

        // Scene
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.001, 100000);

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(1, 2, 1.5);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0xffffff, 0.22);
        fill.position.set(-1, 0.5, -1);
        scene.add(fill);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        // Prevent orbit from propagating to canvas pan
        renderer.domElement.addEventListener('pointerdown', (e) => e.stopPropagation());

        // Center + scale model to 100 units
        const box = new THREE.Box3().setFromObject(object3d);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale  = 100 / maxDim;
        object3d.scale.setScalar(scale);
        object3d.position.copy(center.clone().negate().multiplyScalar(scale));
        scene.add(object3d);

        // Fit camera
        camera.position.set(0, size.y * scale * 0.45, maxDim * scale * 1.8);
        controls.target.set(0, size.y * scale * 0.05, 0);
        controls.update();

        // Snapshot → imageData
        const capture = () => {
            renderer.render(scene, camera);
            node.data.imageData = renderer.domElement.toDataURL('image/jpeg', 0.92);
            node.data.originalWidth  = renderer.domElement.width;
            node.data.originalHeight = renderer.domElement.height;
        };

        // Render loop
        let animId;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        controls.addEventListener('end', capture);
        capture(); // initial snapshot

        // Responsive
        const ro = new ResizeObserver(() => {
            const w = wrapper.offsetWidth || 400;
            const h = Math.round(w * 0.72);
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            capture();
        });
        ro.observe(wrapper);

        node.data._cleanup3d = () => {
            cancelAnimationFrame(animId);
            ro.disconnect();
            controls.dispose();
            renderer.dispose();
        };
    }
}
