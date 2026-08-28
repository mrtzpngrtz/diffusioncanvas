import { NodeBase } from './NodeBase.js';

// Formats that are read as binary (ArrayBuffer) vs text
const BINARY_EXTS = new Set(['fbx', 'glb', 'stl']);
const ACCEPT = '.fbx,.obj,.glb,.gltf,.stl';

// Load the right Three.js loader for the given extension
async function getLoader(ext, THREE) {
    switch (ext) {
        case 'fbx': {
            const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
            return new FBXLoader();
        }
        case 'obj': {
            const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
            return new OBJLoader();
        }
        case 'glb':
        case 'gltf': {
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            return new GLTFLoader();
        }
        case 'stl': {
            const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
            return new STLLoader();
        }
        default:
            throw new Error(`Unsupported format: .${ext}`);
    }
}

// Convert base64 → ArrayBuffer
function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

// Convert ArrayBuffer → base64
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
            data: { modelData: null, modelType: null, modelName: null, imageData: null },
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
                    ? bufferToB64(e.target.result)  // store binary as base64 string
                    : e.target.result;               // text as-is
                node.data.modelType = ext;
                node.data.modelName = file.name;
                content.innerHTML = '';
                await self._setupViewer(node, content);
            };
            BINARY_EXTS.has(ext)
                ? reader.readAsArrayBuffer(file)
                : reader.readAsText(file);
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

        // Called by NodeManager after Object.assign restores saved data
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
            loader = await getLoader(ext, THREE);
        } catch (err) {
            content.innerHTML = `<div class="threed-error">Three.js failed to load:<br>${err.message}</div>`;
            return;
        }

        // Decode model data
        const rawData = BINARY_EXTS.has(ext)
            ? b64ToBuffer(node.data.modelData)
            : node.data.modelData;

        // Parse into Object3D
        let object3d;
        try {
            if (ext === 'glb' || ext === 'gltf') {
                // GLTFLoader.parse is callback-based
                object3d = await new Promise((resolve, reject) =>
                    loader.parse(rawData, '', (gltf) => resolve(gltf.scene), reject)
                );
            } else if (ext === 'stl') {
                // STLLoader returns BufferGeometry — wrap in Mesh
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

        const label = document.createElement('div');
        label.className = 'threed-label';
        label.textContent = node.data.modelName || '';
        wrapper.appendChild(label);

        const W = wrapper.offsetWidth || 400;
        const H = Math.round(W * 0.72);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.setClearColor(0x111111);
        renderer.shadowMap.enabled = true;
        wrapper.appendChild(renderer.domElement);
        renderer.domElement.className = 'threed-canvas';

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.001, 100000);

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(1, 2, 1.5);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0xffffff, 0.22);
        fill.position.set(-1, 0.5, -1);
        scene.add(fill);

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

        camera.position.set(0, size.y * scale * 0.45, maxDim * scale * 1.8);
        controls.target.set(0, size.y * scale * 0.05, 0);
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
