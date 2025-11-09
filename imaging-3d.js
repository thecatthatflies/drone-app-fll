// --- Imports (CDN) ---
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";

// ---- LocalStorage bridge (reuses your app.js store & KEYS) ----
const MKEY = KEYS.markers;

// ---- Scene globals ----
let scene, renderer, camera, controls;
let terrain, drone, digger, sifterRing;
let raycaster, mouse = new THREE.Vector2();
let clock = new THREE.Clock();
const world = {
  width: 200, depth: 200, // meters (fake)
  scale: 1,               // 1 unit = 1 meter
  droneAlt: 6,
  droneVel: new THREE.Vector3(),
  wind: 0.2
};

// Utility: random but stable dunes
function duneHeight(x, z) {
  // simple “desert” function; fast & no noise lib
  const a = Math.sin(x * 0.06) * 2.4 + Math.cos(z * 0.05) * 2.0;
  const b = Math.sin((x+z) * 0.035) * 1.6 + Math.cos((x-z) * 0.05) * 1.2;
  const c = Math.sin(x * 0.012) * Math.cos(z * 0.018) * 6.0;
  const base = a + b + c;
  return Math.max(0, base + 4); // keep it all >= 0, desert floor around 4
}

// Terrain material that we can “darken” where we dig
const sandMaterial = new THREE.MeshStandardMaterial({
  color: 0xE2C999,
  roughness: 1.0,
  metalness: 0.0,
  flatShading: true
});

// Build scene
function init3D(root) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3efe3);

  const aspect = root.clientWidth / root.clientHeight;
  camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  camera.position.set(30, 35, 48);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  root.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 8, 0);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(50, 100, 20);
  sun.castShadow = false;
  scene.add(sun);

  // Terrain plane
  const seg = 200;
  const geo = new THREE.PlaneGeometry(world.width, world.depth, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, duneHeight(x, z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  terrain = new THREE.Mesh(geo, sandMaterial.clone());
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Drone model (simple)
  drone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 2.2),
                              new THREE.MeshStandardMaterial({color:0xffffff, metalness:0.2, roughness:0.7}));
  body.position.y = 0.4;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 3.6),
                               new THREE.MeshStandardMaterial({color:0x444444}));
  const propGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 16);
  const propMat = new THREE.MeshStandardMaterial({color:0x222222});
  const props = [];
  [[1.8,0,1.8], [-1.8,0,1.8], [1.8,0,-1.8], [-1.8,0,-1.8]].forEach(p=>{
    const s = new THREE.Mesh(propGeo, propMat);
    s.rotation.z = Math.PI/2; s.position.set(p[0], 0.2, p[2]); props.push(s); drone.add(s);
  });
  drone.add(body, frame);
  drone.position.set(0, world.droneAlt, 0);
  scene.add(drone);

  // Sifter (ring)
  const ringGeo = new THREE.RingGeometry(1.6, 1.8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color:0x10b981, transparent:true, opacity:0.65, side:THREE.DoubleSide });
  sifterRing = new THREE.Mesh(ringGeo, ringMat);
  sifterRing.rotation.x = -Math.PI/2;
  sifterRing.visible = false;
  scene.add(sifterRing);

  // Digger
  const digMat = new THREE.MeshStandardMaterial({ color:0x6b7280, metalness:0.2, roughness:0.8 });
  digger = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.6), digMat);
  digger.position.set(-10, 0.4, -10);
  scene.add(digger);

  raycaster = new THREE.Raycaster();
  root.addEventListener("pointerdown", onPointerDown);

  window.addEventListener("resize", ()=>{
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });

  animate(props);
}

// Click to place marker (terrain % coords)
function onPointerDown(e) {
  const root = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - root.left) / root.width) * 2 - 1;
  mouse.y = -((e.clientY - root.top) / root.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(terrain, true)[0];
  if (!hit) return;

  const worldPos = hit.point;
  const px = ((worldPos.x + world.width/2) / world.width) * 100;
  const py = ((worldPos.z + world.depth/2) / world.depth) * 100;
  const markers = store.get(MKEY, []);
  const m = { id: crypto.randomUUID(), x: Math.round(px*10)/10, y: Math.round(py*10)/10, color: "#10b981", label: `Potential site ${markers.length+1}` };
  store.set(MKEY, [...markers, m]);
  logActivity(`Marker added at (${m.x}%, ${m.y}%)`);
  renderMarkerTable?.();
  update3DFromMarkers();
}

// Create/refresh flag meshes for markers
const markerGroup = new THREE.Group();
function update3DFromMarkers() {
  scene?.remove(markerGroup);
  while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
  const markers = store.get(MKEY, []);
  markers.forEach(m=>{
    const wx = (m.x/100) * world.width - world.width/2;
    const wz = (m.y/100) * world.depth - world.depth/2;
    const wy = duneHeight(wx, wz) + 0.02;
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 0.8, 8),
      new THREE.MeshStandardMaterial({color: m.color||"#10b981"})
    );
    flag.position.set(wx, wy+0.4, wz);
    markerGroup.add(flag);
  });
  scene?.add(markerGroup);
}
// so your existing delete handler (which calls imagingInit()) will refresh us:
window.imagingInit = update3DFromMarkers;

// Controls binding
function bindControls() {
  const ctl = (id, fn)=> document.getElementById(id)?.addEventListener("click", fn);
  ctl("ctl-up", ()=> nudge(new THREE.Vector3( 0, 0, -1)));
  ctl("ctl-down", ()=> nudge(new THREE.Vector3( 0, 0,  1)));
  ctl("ctl-left", ()=> nudge(new THREE.Vector3(-1, 0,  0)));
  ctl("ctl-right",()=> nudge(new THREE.Vector3( 1, 0,  0)));
  ctl("ctl-alt-up", ()=> { world.droneAlt = Math.min(60, world.droneAlt+1); });
  ctl("ctl-alt-dn", ()=> { world.droneAlt = Math.max( 2, world.droneAlt-1); });
  ctl("ctl-hover", ()=> world.droneVel.set(0,0,0));

  ctl("ctl-sift-start", ()=> {
    sifterRing.visible = true;
    logActivity("Sifter engaged");
  });
  ctl("ctl-sift-pause", ()=> {
    sifterRing.visible = false;
    logActivity("Sifter paused");
  });
  ctl("ctl-digger-deploy", deployDiggerToMarker);
  ctl("ctl-digger-rth", ()=> {
    digger.userData.path = null;
    digger.position.set(-10, 0.4, -10);
    logActivity("Digger return-to-home issued");
  });
}
function nudge(dir) {
  dir.normalize().multiplyScalar(2.0);
  world.droneVel.add(dir);
  logActivity(`Move ${dir.z<0?"Up":dir.z>0?"Down":dir.x>0?"Right":"Left"}`);
}

// Digger pathfinding to nearest marker (greedy straight-line)
function deployDiggerToMarker() {
  const ms = store.get(MKEY, []);
  if (!ms.length) { logActivity("No markers to dig."); return; }
  // pick last marker as “flagged” for simplicity
  const m = ms[ms.length-1];
  const target = new THREE.Vector3(
    (m.x/100)*world.width - world.width/2,
    0,
    (m.y/100)*world.depth - world.depth/2
  );
  target.y = duneHeight(target.x, target.z) + 0.4;
  digger.userData.path = { target, digging: false, t0: performance.now() };
  logActivity(`Digger deployed to ${m.label} (${m.x}%, ${m.y}%)`);
}

// Darken terrain vertices around a point to simulate excavation
function excavateAt(x, z, r=3, strength=0.65) {
  const g = terrain.geometry;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vz = pos.getZ(i);
    const d2 = (vx-x)*(vx-x) + (vz-z)*(vz-z);
    if (d2 < r*r) {
      const y = pos.getY(i);
      pos.setY(i, y - 0.06); // small depression
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  // subtle color darkening
  const mat = terrain.material;
  mat.color.lerp(new THREE.Color(0xC7B08C), strength * 0.08);
}

// Animate
function animate(props) {
  requestAnimationFrame(()=>animate(props));
  const dt = Math.min(0.033, clock.getDelta());

  // Wind drag on motion
  world.droneVel.multiplyScalar(0.90);
  drone.position.add(world.droneVel.clone().multiplyScalar(dt * 4.0));
  // clamp to terrain bounds
  drone.position.x = THREE.MathUtils.clamp(drone.position.x, -world.width/2+2, world.width/2-2);
  drone.position.z = THREE.MathUtils.clamp(drone.position.z, -world.depth/2+2, world.depth/2-2);
  // altitude follows control
  const targetY = duneHeight(drone.position.x, drone.position.z) + world.droneAlt;
  drone.position.y += (targetY - drone.position.y) * (1 - Math.pow(0.001, dt*60));

  // sifter ring under drone
  sifterRing.position.set(drone.position.x, duneHeight(drone.position.x, drone.position.z)+0.02, drone.position.z);

  // spin props
  props.forEach((p,i)=> p.rotation.y += (i%2?1:-1) * (6.0*dt + world.droneVel.length()*0.1));

  // digger move on path
  if (digger.userData.path) {
    const { target } = digger.userData.path;
    const to = target.clone().sub(digger.position); to.y = 0;
    const dist = to.length();
    if (dist > 0.05) {
      to.normalize();
      digger.position.add(to.multiplyScalar(dt * 2.0));
      digger.position.y = duneHeight(digger.position.x, digger.position.z) + 0.4;
    } else {
      if (!digger.userData.path.digging) {
        digger.userData.path.digging = true;
        logActivity("Digger: excavation started");
      }
      excavateAt(target.x, target.z, 3.2);
      // after a bit, finish
      const elapsed = (performance.now() - digger.userData.path.t0) / 1000;
      if (elapsed > 6) {
        logActivity("Digger: excavation complete");
        digger.userData.path = null;
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// Public entry to initialize
window.imaging3DInit = function() {
  const root = document.getElementById("threeRoot");
  if (!root) return;
  init3D(root);
  bindControls();
  update3DFromMarkers();
};
