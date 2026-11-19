// Live 3D mug preview: the flat print canvas is wrapped around a cylinder as a texture.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface MugPreview {
  update(print: HTMLCanvasElement): void;
  /** Start rendering and reset to the front view. */
  show(): void;
  /** Stop the render loop (saves CPU/battery while the tab is hidden). */
  hide(): void;
}

export function createMugPreview(
  container: HTMLElement,
  mug: { circumference: number; height: number },
  printInches: { width: number; height: number },
): MugPreview {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.4, 11);

  scene.add(new THREE.HemisphereLight(0xfffaf2, 0xd9cfc2, 2.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2, 3, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  // Scale: 1 unit = 1 inch.
  const R = mug.circumference / (2 * Math.PI);
  const Hm = mug.height;

  // Texture canvas spans the full circumference; the print is centred, white elsewhere.
  const texCanvas = document.createElement('canvas');
  const PX = 220; // texture px per inch
  texCanvas.width = Math.round(mug.circumference * PX);
  texCanvas.height = Math.round(Hm * PX);
  const tctx = texCanvas.getContext('2d')!;
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, texCanvas.width, texCanvas.height);
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const ceramic = new THREE.MeshStandardMaterial({ color: 0xfaf8f4, roughness: 0.7, metalness: 0 });
  const mugGroup = new THREE.Group();

  // Outer wall: thetaStart = PI puts the texture seam at the back (where the handle is),
  // so the centre of the print faces the camera.
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, Hm, 128, 1, true, Math.PI, Math.PI * 2),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 }),
  );
  mugGroup.add(outer);

  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.94, R * 0.94, Hm * 0.98, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf1ede7, roughness: 0.7, side: THREE.BackSide }),
  );
  inner.position.y = Hm * 0.01;
  mugGroup.add(inner);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.97, R * 0.03, 12, 128), ceramic);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = Hm / 2;
  mugGroup.add(lip);

  const bottom = new THREE.Mesh(new THREE.CircleGeometry(R, 64), ceramic);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -Hm / 2;
  mugGroup.add(bottom);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 0.94, 64), ceramic);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -Hm / 2 + 0.15;
  mugGroup.add(floor);

  // Handle: a half torus on the back (-z), sticking out.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(Hm * 0.3, 0.17, 20, 48, Math.PI), ceramic);
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0, 0, -R + 0.05);
  mugGroup.add(handle);

  // One printed side faces the camera (each side's centre is ~73° from the print centre).
  const FACE_ANGLE = -(printInches.width / 4) / R;
  mugGroup.rotation.y = FACE_ANGLE;
  scene.add(mugGroup);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.minPolarAngle = Math.PI * 0.3;
  controls.maxPolarAngle = Math.PI * 0.6;
  renderer.domElement.addEventListener('pointerdown', () => (controls.autoRotate = false));

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(container);

  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
  };

  return {
    show() {
      camera.position.set(0, 1.4, 11);
      mugGroup.rotation.y = FACE_ANGLE;
      controls.autoRotate = true;
      controls.update();
      resize();
      renderer.setAnimationLoop(loop);
    },
    hide() {
      renderer.setAnimationLoop(null);
    },
    update(print) {
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, texCanvas.width, texCanvas.height);
      const pw = printInches.width * PX;
      const ph = printInches.height * PX;
      tctx.drawImage(print, (texCanvas.width - pw) / 2, (texCanvas.height - ph) / 2, pw, ph);
      texture.needsUpdate = true;
    },
  };
}
