import { NodeBase } from './NodeBase.js';

const BINARY_EXTS = new Set(['fbx', 'glb', 'stl']);
const ACCEPT = '.fbx,.obj,.glb,.gltf,.stl';
const BG_CYCLE = ['#111111', '#555555', '#cccccc'];

async function getLoader(ext) {
    switch (ext) {
        case 'fbx':  { const { FBXLoader }  = await import('three/addons/loaders/FBXLoader.js');  return new FBXLoader(); }
        case 'obj':  { const { OBJLoader }  = await import('three/addons/loaders/OBJLoader.js');  return new OBJLoader(); }
        case 'glb':
        case 'gltf': { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); return new GLTFLoader(); }
        case 'stl':  { const { STLLoader }  = await import('three/addons/loaders/STLLoader.js');  return new STLLoader(); }
        default: throw new Error(`Unsupported format: .${ext}`);
    }
}

function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

function bufferToB64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = '';
    const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
}

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
                    <p>Drop .fbx .obj .glb .gltf .stl</p>
                    <input type="file" accept="${ACCEPT}" style="display:none">
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, false, true)}
        `;

        const node = {
            id: nodeId,
            type: 'threed',
            element: nodeEl,
            data: {
                modelData: null, modelType: null, modelName: null,
                imageData: null,
                ambientIntensity: 0.7, sunIntensity: 0.9,
                bgColor: '#111111', fov: 45
            },
            position: { x, y }
        };

        const content   = nodeEl.querySelector('.node-content');
        const dropZone  = nodeEl.querySelector('.threed-dropzone');
        const fileInput = nodeEl.querySelector('input[type="file"]');
        const self = this;

        const loadFile = (file) => {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['fbx', 'obj', 'glb', 'gltf', 'stl'].includes(ext)) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                node.data.modelData = BINARY_EXTS.has(ext)
                    ? bufferToB64(e.target.result)
                    : e.target.result;
                node.data.modelType = ext;
                node.data.modelName = file.name;
                content.innerHTML = '';
                await self._setupViewer(node, content);
            };
            BINARY_EXTS.has(ext) ? reader.readAsArrayBuffer(file) : reader.readAsText(file);
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

        const loadingEl = document.createElement('div');
        loadingEl.className = 'threed-loading';
        loadingEl.textContent = 'Loading…';
        content.appendChild(loadingEl);

        let THREE, OrbitControls, loader;
        try {
            THREE = await import('three');
            const { OrbitControls: OC } = await import('three/addons/controls/OrbitControls.js');
            OrbitControls = OC;
            loader = await getLoader(ext);
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Three.js failed to load:<br>${err.message}</div>`;
            return;
        }

        const rawData = BINARY_EXTS.has(ext) ? b64ToBuffer(node.data.modelData) : node.data.modelData;

        let object3d;
        try {
            if (ext === 'glb' || ext === 'gltf') {
                object3d = await new Promise((resolve, reject) =>
                    loader.parse(rawData, '', (gltf) => resolve(gltf.scene), reject)
                );
            } else if (ext === 'stl') {
                const geo = loader.parse(rawData);
                geo.computeVertexNormals();
                object3d = new THREE.Mesh(
                    geo,
                    new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.2 })
                );
            } else {
                object3d = loader.parse(rawData);
            }
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Parse failed:<br>${err.message}</div>`;
            return;
        }

        content.innerHTML = '';

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
        renderer.setClearColor(node.data.bgColor || '#111111');
        renderer.shadowMap.enabled = true;
        wrapper.appendChild(renderer.domElement);
        renderer.domElement.className = 'threed-canvas';

        // Scene
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(node.data.fov || 45, W / H, 0.001, 100000);

        // Lights — kept as variables so controls can update them
        const ambient = new THREE.AmbientLight(0xffffff, node.data.ambientIntensity ?? 0.7);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, node.data.sunIntensity ?? 0.9);
        sun.position.set(1, 2, 1.5);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0xffffff, 0.22);
        fill.position.set(-1, 0.5, -1);
        scene.add(fill);

        // Orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        renderer.domElement.addEventListener('pointerdown', (e) => e.stopPropagation());

        // Center + auto-scale
        const box    = new THREE.Box3().setFromObject(object3d);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale  = 100 / maxDim;
        object3d.scale.setScalar(scale);
        object3d.position.copy(center.clone().negate().multiplyScalar(scale));
        scene.add(object3d);

        // Default camera position (also used by reset)
        const defaultCamPos    = new THREE.Vector3(0, size.y * scale * 0.45, maxDim * scale * 1.8);
        const defaultCamTarget = new THREE.Vector3(0, size.y * scale * 0.05, 0);
        camera.position.copy(defaultCamPos);
        controls.target.copy(defaultCamTarget);
        controls.update();

        const capture = () => {
            renderer.render(scene, camera);
            node.data.imageData      = renderer.domElement.toDataURL('image/jpeg', 0.92);
            node.data.originalWidth  = renderer.domElement.width;
            node.data.originalHeight = renderer.domElement.height;
        };

        let animId;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
        controls.addEventListener('end', capture);
        capture();

        // ── Controls panel ─────────────────────────────────────────
        const bgIdx = () => {
            const i = BG_CYCLE.indexOf(node.data.bgColor || '#111111');
            return i < 0 ? 0 : i;
        };
        const bgIcons = ['●', '◑', '○'];

        const ctrl = document.createElement('div');
        ctrl.className = 'threed-controls';
        ctrl.innerHTML = `
            <span class="threed-ctrl-item" title="Ambient light">
                <span class="threed-ctrl-lbl">Amb</span>
                <input class="threed-slider" type="range" min="0" max="200" value="${Math.round((node.data.ambientIntensity ?? 0.7) * 100)}">
            </span>
            <span class="threed-ctrl-item" title="Sun light">
                <span class="threed-ctrl-lbl">Sun</span>
                <input class="threed-slider" type="range" min="0" max="300" value="${Math.round((node.data.sunIntensity ?? 0.9) * 100)}">
            </span>
            <button class="threed-bg-btn" title="Background">${bgIcons[bgIdx()]}</button>
            <span class="threed-ctrl-item" title="Field of view">
                <span class="threed-ctrl-lbl">FOV</span>
                <input class="threed-slider threed-slider-sm" type="range" min="15" max="100" value="${node.data.fov || 45}">
            </span>
            <button class="threed-reset-btn" title="Reset camera">↺</button>
            <button class="threed-ctrl-collapse" title="Settings">⚙</button>
        `;
        wrapper.appendChild(ctrl);

        const sp = (e) => e.stopPropagation();

        // Ambient
        const ambSlider = ctrl.querySelectorAll('.threed-slider')[0];
        ambSlider.addEventListener('mousedown', sp);
        ambSlider.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            ambient.intensity = v;
            node.data.ambientIntensity = v;
            capture();
        });

        // Sun
        const sunSlider = ctrl.querySelectorAll('.threed-slider')[1];
        sunSlider.addEventListener('mousedown', sp);
        sunSlider.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            sun.intensity = v;
            node.data.sunIntensity = v;
            capture();
        });

        // Background cycle
        let bgI = bgIdx();
        const bgBtn = ctrl.querySelector('.threed-bg-btn');
        bgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            bgI = (bgI + 1) % BG_CYCLE.length;
            renderer.setClearColor(BG_CYCLE[bgI]);
            node.data.bgColor = BG_CYCLE[bgI];
            bgBtn.textContent = bgIcons[bgI];
            capture();
        });

        // FOV
        const fovSlider = ctrl.querySelectorAll('.threed-slider')[2];
        fovSlider.addEventListener('mousedown', sp);
        fovSlider.addEventListener('input', (e) => {
            camera.fov = +e.target.value;
            camera.updateProjectionMatrix();
            node.data.fov = +e.target.value;
            capture();
        });

        // Reset camera
        ctrl.querySelector('.threed-reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            camera.position.copy(defaultCamPos);
            controls.target.copy(defaultCamTarget);
            controls.update();
            capture();
        });

        // Collapse/expand
        const collapseBtn = ctrl.querySelector('.threed-ctrl-collapse');
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            ctrl.classList.toggle('open');
        });

        // ── Responsive ─────────────────────────────────────────────
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
