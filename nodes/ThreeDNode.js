import { NodeBase } from './NodeBase.js';

const BINARY_EXTS = new Set(['fbx', 'glb', 'stl']);
const ACCEPT = '.fbx,.obj,.glb,.gltf,.stl';
const BG_CYCLE  = ['#111111', '#555555', '#cccccc'];
const BG_ICONS  = ['●', '◑', '○'];

// Full-frame vertical FOV: 2 * atan(12 / focalLength) * (180/π)
const LENS = [
    { mm: 14, fov: 81 },
    { mm: 24, fov: 53 },
    { mm: 35, fov: 38 },
    { mm: 50, fov: 27 },
    { mm: 85, fov: 16 },
    { mm: 135, fov: 10 },
];

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
    let bin = ''; const CH = 8192;
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
            ${this.createNodeHeader('3D Viewer', 'i-cube')}
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
            id: nodeId, type: 'threed', element: nodeEl,
            data: {
                modelData: null, modelType: null, modelName: null, imageData: null,
                ambientIntensity: 0.7, sunIntensity: 0.9, bgColor: '#111111', fov: 38
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
                node.data.modelData = BINARY_EXTS.has(ext) ? bufferToB64(e.target.result) : e.target.result;
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
            e.preventDefault(); dropZone.classList.remove('drag-over');
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
            ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
            loader = await getLoader(ext);
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Three.js failed to load:<br>${err.message}</div>`;
            return;
        }

        const rawData = BINARY_EXTS.has(ext) ? b64ToBuffer(node.data.modelData) : node.data.modelData;

        let object3d;
        try {
            if (ext === 'glb' || ext === 'gltf') {
                object3d = await new Promise((res, rej) =>
                    loader.parse(rawData, '', (gltf) => res(gltf.scene), rej)
                );
            } else if (ext === 'stl') {
                const geo = loader.parse(rawData);
                geo.computeVertexNormals();
                object3d = new THREE.Mesh(geo,
                    new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.2 }));
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

        const label = document.createElement('div');
        label.className = 'threed-label';
        label.textContent = node.data.modelName || '';
        wrapper.appendChild(label);

        // Renderer
        const W = wrapper.offsetWidth || 400, H = Math.round(W * 0.72);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.setClearColor(node.data.bgColor || '#111111');
        renderer.shadowMap.enabled = true;
        // Tone mapping keeps very bright lights from clipping to flat white;
        // exposure is the global brightness multiplier
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = node.data.exposure ?? 1;
        wrapper.appendChild(renderer.domElement);
        renderer.domElement.className = 'threed-canvas';

        // Scene + camera
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(node.data.fov || 38, W / H, 0.001, 100000);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, node.data.ambientIntensity ?? 0.7);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, node.data.sunIntensity ?? 0.9);
        sun.position.set(1, 2, 1.5); scene.add(sun);
        const fill = new THREE.DirectionalLight(0xffffff, 0.22);
        fill.position.set(-1, 0.5, -1); scene.add(fill);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.dampingFactor = 0.06;
        renderer.domElement.addEventListener('pointerdown', (e) => e.stopPropagation());

        // Auto-fit model
        const box    = new THREE.Box3().setFromObject(object3d);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale  = 100 / maxDim;
        object3d.scale.setScalar(scale);
        object3d.position.copy(center.clone().negate().multiplyScalar(scale));
        scene.add(object3d);

        const centerY = size.y * scale * 0.05;
        const dist    = maxDim * scale * 1.8;

        const defaultCamPos    = new THREE.Vector3(0, size.y * scale * 0.45, dist);
        const defaultCamTarget = new THREE.Vector3(0, centerY, 0);
        camera.position.copy(defaultCamPos);
        controls.target.copy(defaultCamTarget);
        controls.update();

        // Snapshot helper
        const capture = () => {
            renderer.render(scene, camera);
            node.data.imageData      = renderer.domElement.toDataURL('image/jpeg', 0.92);
            node.data.originalWidth  = renderer.domElement.width;
            node.data.originalHeight = renderer.domElement.height;
        };

        let animId;
        const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
        animate();
        controls.addEventListener('end', capture);
        capture();

        // ── Pan helper ────────────────────────────────────────────
        const panCamera = (dx, dy) => {
            const d = camera.position.distanceTo(controls.target);
            const step = d * 0.06;
            const right = new THREE.Vector3()
                .crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up)
                .normalize().multiplyScalar(dx * step);
            const up = camera.up.clone().normalize().multiplyScalar(dy * step);
            const offset = right.add(up);
            camera.position.add(offset);
            controls.target.add(offset);
            controls.update(); capture();
        };

        // View presets helper
        const setView = (view) => {
            camera.up.set(0, 1, 0);
            switch (view) {
                case 'F': camera.position.set(0, centerY, dist); break;
                case 'B': camera.position.set(0, centerY, -dist); break;
                case 'T': camera.position.set(0, dist * 1.4, 0); camera.up.set(0, 0, -1); break;
                case 'R': camera.position.set(dist, centerY, 0); break;
                case 'L': camera.position.set(-dist, centerY, 0); break;
            }
            controls.target.set(0, centerY, 0);
            controls.update(); capture();
        };

        // ── Controls panel ─────────────────────────────────────────
        const activeLensIdx = () => {
            const fov = node.data.fov || 38;
            let best = 0, bestDiff = Infinity;
            LENS.forEach((l, i) => { const d = Math.abs(l.fov - fov); if (d < bestDiff) { bestDiff = d; best = i; } });
            return best;
        };

        const bgI = { v: BG_CYCLE.indexOf(node.data.bgColor || '#111111') < 0 ? 0 : BG_CYCLE.indexOf(node.data.bgColor) };

        const ctrl = document.createElement('div');
        ctrl.className = 'threed-controls';
        ctrl.innerHTML = `
            <div class="threed-ctrl-rows">
                <div class="threed-ctrl-row">
                    <span class="threed-ctrl-item"><span class="threed-ctrl-lbl">Amb</span><input class="threed-slider" type="range" min="0" max="800" value="${Math.round((node.data.ambientIntensity ?? 0.7) * 100)}"></span>
                    <span class="threed-ctrl-item"><span class="threed-ctrl-lbl">Sun</span><input class="threed-slider" type="range" min="0" max="1200" value="${Math.round((node.data.sunIntensity ?? 0.9) * 100)}"></span>
                    <span class="threed-ctrl-item"><span class="threed-ctrl-lbl">Exp</span><input class="threed-slider threed-exposure" type="range" min="20" max="500" value="${Math.round((node.data.exposure ?? 1) * 100)}"></span>
                    <button class="threed-bg-btn threed-icon-btn" title="Background">${BG_ICONS[bgI.v]}</button>
                    <button class="threed-reset-btn threed-icon-btn" title="Reset camera"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
                <div class="threed-ctrl-row">
                    <span class="threed-ctrl-lbl">Lens</span>
                    ${LENS.map((l, i) => `<button class="threed-lens-btn threed-icon-btn${i === activeLensIdx() ? ' active' : ''}" data-fov="${l.fov}" title="${l.mm}mm / ${l.fov}°">${l.mm}</button>`).join('')}
                </div>
                <div class="threed-ctrl-row">
                    <span class="threed-ctrl-lbl">View</span>
                    ${['F','T','R','L','B'].map(v => `<button class="threed-view-btn threed-icon-btn" data-view="${v}">${v}</button>`).join('')}
                    <span class="threed-ctrl-sep"></span>
                    <button class="threed-pan-btn threed-icon-btn" data-dx="-1" data-dy="0">←</button>
                    <button class="threed-pan-btn threed-icon-btn" data-dx="0" data-dy="1">↑</button>
                    <button class="threed-pan-btn threed-icon-btn" data-dx="0" data-dy="-1">↓</button>
                    <button class="threed-pan-btn threed-icon-btn" data-dx="1" data-dy="0">→</button>
                </div>
            </div>
            <button class="threed-ctrl-collapse" title="Settings"><svg class="icon"><use href="#i-sliders"/></svg></button>
        `;
        wrapper.appendChild(ctrl);

        const sp = (e) => e.stopPropagation();

        // Ambient
        const [ambSlider, sunSlider] = ctrl.querySelectorAll('.threed-slider');
        ambSlider.addEventListener('mousedown', sp);
        ambSlider.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            ambient.intensity = v; node.data.ambientIntensity = v; capture();
        });

        // Sun
        sunSlider.addEventListener('mousedown', sp);
        sunSlider.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            sun.intensity = v; node.data.sunIntensity = v; capture();
        });

        // Exposure (global brightness)
        const expSlider = ctrl.querySelector('.threed-exposure');
        expSlider.addEventListener('mousedown', sp);
        expSlider.addEventListener('input', (e) => {
            const v = e.target.value / 100;
            renderer.toneMappingExposure = v; node.data.exposure = v; capture();
        });

        // Background
        const bgBtn = ctrl.querySelector('.threed-bg-btn');
        bgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            bgI.v = (bgI.v + 1) % BG_CYCLE.length;
            renderer.setClearColor(BG_CYCLE[bgI.v]);
            node.data.bgColor = BG_CYCLE[bgI.v];
            bgBtn.textContent = BG_ICONS[bgI.v]; capture();
        });

        // Reset
        ctrl.querySelector('.threed-reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            camera.up.set(0, 1, 0);
            camera.position.copy(defaultCamPos);
            controls.target.copy(defaultCamTarget);
            controls.update(); capture();
        });

        // Lens presets
        const lensButtons = ctrl.querySelectorAll('.threed-lens-btn');
        lensButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const fov = +btn.dataset.fov;
                camera.fov = fov; camera.updateProjectionMatrix();
                node.data.fov = fov;
                lensButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                capture();
            });
        });

        // View presets
        ctrl.querySelectorAll('.threed-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); setView(btn.dataset.view); });
        });

        // Pan buttons — hold to repeat
        ctrl.querySelectorAll('.threed-pan-btn').forEach(btn => {
            const dx = +btn.dataset.dx, dy = +btn.dataset.dy;
            let iv;
            btn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                panCamera(dx, dy);
                iv = setInterval(() => panCamera(dx, dy), 100);
            });
            btn.addEventListener('pointerup',    () => clearInterval(iv));
            btn.addEventListener('pointerleave', () => clearInterval(iv));
        });

        // Collapse toggle
        ctrl.querySelector('.threed-ctrl-collapse').addEventListener('click', (e) => {
            e.stopPropagation(); ctrl.classList.toggle('open');
        });

        // Responsive resize
        const ro = new ResizeObserver(() => {
            const w = wrapper.offsetWidth || 400, h = Math.round(w * 0.72);
            renderer.setSize(w, h); camera.aspect = w / h;
            camera.updateProjectionMatrix(); capture();
        });
        ro.observe(wrapper);

        node.data._cleanup3d = () => {
            cancelAnimationFrame(animId); ro.disconnect();
            controls.dispose(); renderer.dispose();
        };
    }
}
