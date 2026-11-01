// The MonoSpace 500 shaft built from code, in metres, from the layout and the dimensions in lift.js. Nothing here
// owns a number that moves: update(state, display) poses every part from stateAt()'s output.
//
// Parts: the shaft (ghost walls, edge lines, landing door portals), car and counterweight T-rails with brackets, the
// MX10 (stator housing, axial-flux stator coils, rotor with magnet ring, grooved Ø480 sheave, twin brakes, bracket),
// the car (platform, sling, walls, roof balustrade, door operator, 2-panel telescopic door, two under-car pulleys), the
// counterweight (frame, filler plates counted from its mass, pulley), six ropes along their true 2:1 path with tracer
// marks at fixed material points, the dead-end hitches, the overspeed governor loop, the travelling cable, buffers.
import * as THREE from 'three';
import {DOOR, L, R, rp, S, TOP, TRAVEL} from './lift.js';

const V3 = THREE.Vector3;
export const COL = {
  bg: '#eceeec',
  green: '#2f9a52',
  greenDark: '#23753e',
  yellow: '#f0c230',
  steel: '#c9cdd0',
  steelDark: '#7d8489',
  rail: '#8c9297',
  paint: '#4a5056',
  rope: '#3d4247',
  copper: '#c06a32',
  magnet: '#2b2f36',
  accent: '#e3562a',
  edge: '#6f9fbf',
};

const std = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.55, metalness: 0.1, ...o});
export function makeMaterials() {
  return {
    green: std(COL.green, {roughness: 0.42}),
    greenDark: std(COL.greenDark, {roughness: 0.5}),
    yellow: std(COL.yellow, {roughness: 0.5}),
    steel: std(COL.steel, {metalness: 0.75, roughness: 0.45, envMapIntensity: 0.5}),
    steelDark: std(COL.steelDark, {metalness: 0.6, roughness: 0.5}),
    rail: std(COL.rail, {metalness: 0.6, roughness: 0.45}),
    paint: std(COL.paint, {roughness: 0.6}),
    rope: std(COL.rope, {metalness: 0.6, roughness: 0.45}),
    copper: std(COL.copper, {metalness: 0.7, roughness: 0.4}),
    magnet: std(COL.magnet, {metalness: 0.3, roughness: 0.5}),
    accent: std(COL.accent, {roughness: 0.5, emissive: COL.accent, emissiveIntensity: 0.25}),
    floor: std('#5b5f63', {roughness: 0.8}),
    ceil: std('#f6f4ee', {roughness: 0.6, emissive: '#fffaf0', emissiveIntensity: 0.35}),
    concrete: std('#d4d2cc', {roughness: 0.9}),
    rubber: std('#b8402a', {roughness: 0.7}),
    // the car walls and the stator housing go to glass in x-ray
    carWall: std('#d7dadc', {metalness: 0.7, roughness: 0.45, envMapIntensity: 0.5, transparent: true}),
    housing: std(COL.green, {roughness: 0.42, transparent: true}),
    carDoor: std(COL.steel, {metalness: 0.75, roughness: 0.45, envMapIntensity: 0.5}),
  };
}

// ------------------------------------------------------------------------------------------------ helpers
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
/** a cylinder whose axis is along `axis` ('x' | 'y' | 'z') */
const cyl = (r, len, mat, axis = 'y', seg = 32) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
/** a grooved sheave/pulley along the x axis: a lathe profile with n V-grooves */
function sheaveGeo(r, width, n, flange = 0.012) {
  const pts = [];
  const pitch = width / (n + 1);
  pts.push(new THREE.Vector2(0.02, -width / 2 - 0.01));
  pts.push(new THREE.Vector2(r + flange, -width / 2 - 0.01));
  pts.push(new THREE.Vector2(r + flange, -width / 2 + pitch * 0.5));
  for (let i = 0; i < n; i++) {
    const c = -width / 2 + pitch * (i + 1);
    pts.push(new THREE.Vector2(r + 0.006, c - pitch * 0.45));
    pts.push(new THREE.Vector2(r - 0.004, c));
    pts.push(new THREE.Vector2(r + 0.006, c + pitch * 0.45));
  }
  pts.push(new THREE.Vector2(r + flange, width / 2 - pitch * 0.5));
  pts.push(new THREE.Vector2(r + flange, width / 2 + 0.01));
  pts.push(new THREE.Vector2(0.02, width / 2 + 0.01));
  const g = new THREE.LatheGeometry(pts, 64);
  g.rotateZ(-Math.PI / 2); // lathe axis y → x
  return g;
}
/** spokes / index marks on a wheel face so its rotation reads */
function spokes(r, mat, n = 4, axis = 'x', w = 0.012) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, r * 1.7, w), mat);
    s.rotation.x = (i / n) * Math.PI;
    g.add(s);
  }
  if (axis === 'z') g.rotation.y = Math.PI / 2;
  return g;
}
/** T-rail along y from y0 to y1; blade points along +bladeDir (unit x or z) */
function tRail(y0, y1, mat, bladeAxis, sign) {
  const len = y1 - y0;
  const g = new THREE.Group();
  const fl = bladeAxis === 'x' ? box(0.01, len, 0.089, mat) : box(0.089, len, 0.01, mat);
  const bl = bladeAxis === 'x' ? box(0.062, len, 0.016, mat, sign * 0.036) : box(0.016, len, 0.062, mat, 0, 0, sign * 0.036);
  g.add(fl, bl);
  g.position.y = (y0 + y1) / 2;
  return g;
}

// ------------------------------------------------------------------------------------------------ the ghost walls
const GHOST_VERT = /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const GHOST_FRAG = /* glsl */ `uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0); gl_FragColor = vec4(uCol, uA * (0.06 + 0.5 * f)); }`;

export function buildLift() {
  const M = makeMaterials();
  const root = new THREE.Group();
  const shaft = new THREE.Group();
  root.add(shaft);
  const SW = L.SW;
  const SD = L.SD;
  const H0 = -S.pit;
  const HT = TOP;
  const HH = HT - H0;

  // ---------------------------------------------------------------- shaft: ghost walls, edges, pit and landings
  const ghostMat = new THREE.ShaderMaterial({vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG, uniforms: {uCol: {value: new THREE.Color('#9fb6c6')}, uA: {value: 0.55}}, transparent: true, depthWrite: false, side: THREE.DoubleSide});
  const walls = new THREE.Group();
  const wt = 0.2;
  const wall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghostMat);
    m.position.set(x, y, z);
    m.renderOrder = 8;
    walls.add(m);
  };
  wall(wt, HH, SD + 2 * wt, -SW / 2 - wt / 2, H0 + HH / 2, 0);
  wall(wt, HH, SD + 2 * wt, SW / 2 + wt / 2, H0 + HH / 2, 0);
  wall(SW, HH, wt, 0, H0 + HH / 2, -SD / 2 - wt / 2);
  wall(SW, HH, wt, 0, H0 + HH / 2, SD / 2 + wt / 2);
  shaft.add(walls);
  const ghosts = [walls];
  const edgeMat = new THREE.LineBasicMaterial({color: COL.edge, transparent: true, opacity: 0.75});
  {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SW + 2 * wt, HH, SD + 2 * wt)), edgeMat);
    e.position.y = H0 + HH / 2;
    shaft.add(e);
    ghosts.push(e);
    const e2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SW, HH, SD)), edgeMat);
    e2.position.y = H0 + HH / 2;
    shaft.add(e2);
    ghosts.push(e2);
  }
  const pitFloor = box(SW, 0.05, SD, M.concrete, 0, H0 - 0.025, 0);
  shaft.add(pitFloor);
  // landing portals on the front wall: frame, sill, and two landing door panels each
  const landing = [];
  const doorX0 = L.carX; // the entrance is centred on the car
  const zFront = SD / 2;
  for (let i = 0; i < S.stops; i++) {
    const y = i * S.floorH;
    const g = new THREE.Group();
    g.position.set(doorX0, y, zFront);
    const fw = 0.06;
    g.add(box(fw, S.doorH + fw, 0.04, M.steelDark, -S.doorW / 2 - fw / 2, (S.doorH + fw) / 2, 0.22));
    g.add(box(fw, S.doorH + fw, 0.04, M.steelDark, S.doorW / 2 + fw / 2, (S.doorH + fw) / 2, 0.22));
    g.add(box(S.doorW + 2 * fw, fw, 0.04, M.steelDark, 0, S.doorH + fw / 2, 0.22));
    g.add(box(S.doorW + 0.5, 0.02, 0.12, M.steelDark, 0.2, -0.01, -0.04)); // sill
    const pw = S.doorW / 2 + 0.03;
    const fast = box(pw, S.doorH, 0.025, M.steel, 0, S.doorH / 2, -0.035);
    const slow = box(pw, S.doorH, 0.025, M.steel, 0, S.doorH / 2, -0.07);
    g.add(fast, slow);
    // landing door header (hanger box)
    g.add(box(1.45, 0.14, 0.09, M.steelDark, 0.225, S.doorH + 0.09, -0.06));
    shaft.add(g);
    landing.push({g, fast, slow, pw});
  }

  // ---------------------------------------------------------------- rails and brackets
  const railTop = HT - 0.1;
  const carRailX = L.carOW / 2 + 0.07;
  const rails = new THREE.Group();
  const rL = tRail(H0, railTop, M.rail, 'x', 1);
  rL.position.set(L.carX - carRailX, rL.position.y, L.carZ);
  const rR = tRail(H0, railTop, M.rail, 'x', -1);
  rR.position.set(L.carX + carRailX, rR.position.y, L.carZ);
  const cwRailDZ = S.cwPlateZ / 2 + 0.035;
  const cF = tRail(H0, railTop, M.rail, 'z', -1);
  cF.position.set(L.xR, cF.position.y, L.cwZ + cwRailDZ);
  const cB = tRail(H0, railTop, M.rail, 'z', 1);
  cB.position.set(L.xR, cB.position.y, L.cwZ - cwRailDZ);
  rails.add(rL, rR, cF, cB);
  for (let y = H0 + 0.6; y < railTop; y += 2.5) {
    rails.add(box(0.07, 0.08, 0.14, M.steelDark, L.carX - carRailX - 0.04, y, L.carZ));
    rails.add(box(0.2, 0.08, 0.14, M.steelDark, L.carX + carRailX + 0.1, y, L.carZ));
    rails.add(box(0.24, 0.08, 0.03, M.steelDark, L.xR + 0.17, y, L.cwZ + cwRailDZ));
    rails.add(box(0.24, 0.08, 0.03, M.steelDark, L.xR + 0.17, y, L.cwZ - cwRailDZ));
  }
  shaft.add(rails);

  // ---------------------------------------------------------------- buffers
  const bufH = 0.32;
  for (const dx of [-0.35, 0.35]) {
    shaft.add(box(0.16, 0.25, 0.16, M.paint, L.carX + dx, H0 + 0.125, L.carZ));
    const b = cyl(0.07, bufH, M.rubber);
    b.position.set(L.carX + dx, H0 + 0.25 + bufH / 2, L.carZ);
    shaft.add(b);
  }
  shaft.add(box(0.14, L.bufferTop - bufH - H0, 0.14, M.paint, L.xR, (H0 + L.bufferTop - bufH) / 2, L.cwZ));
  {
    const b = cyl(0.06, bufH, M.rubber);
    b.position.set(L.xR, L.bufferTop - bufH / 2, L.cwZ);
    shaft.add(b);
  }

  // ---------------------------------------------------------------- the MX10
  // sheave groove plane at x = xR; the stator housing behind it toward the wall; axis along x
  const mx = new THREE.Group();
  mx.position.set(L.xR, L.sheaveY, L.sheaveZ);
  shaft.add(mx);
  const HR = 0.43; // housing radius (photo: the green disc is roughly 1.8 × the sheave)
  const HX = 0.17; // housing thickness (axial-flux: a flat disc)
  const sheaveW = 0.085;
  const housingX = sheaveW / 2 + 0.02 + HX / 2; // housing centre, from the groove plane toward the wall
  const housing = new THREE.Group();
  {
    // a dished disc: back plate, rim, cooling ribs, the two mounting legs that make the photo's pointed bottom
    const prof = [[0.0, -HX / 2], [HR - 0.03, -HX / 2], [HR, -HX / 2 + 0.03], [HR, HX / 2 - 0.02], [HR - 0.02, HX / 2], [0.19, HX / 2], [0.17, HX / 2 - 0.04], [0.0, HX / 2 - 0.04]].map(([r, x]) => new THREE.Vector2(r, x));
    const g = new THREE.LatheGeometry(prof, 72);
    g.rotateZ(-Math.PI / 2);
    const disc = new THREE.Mesh(g, M.housing);
    disc.castShadow = disc.receiveShadow = true;
    housing.add(disc);
    for (let i = 0; i < 12; i++) {
      const rib = box(HX * 0.9, 0.02, 0.12, M.housing, 0, 0, 0);
      const a = (i / 12) * Math.PI * 2;
      rib.position.set(0.0, Math.sin(a) * (HR - 0.06), Math.cos(a) * (HR - 0.06));
      rib.rotation.x = -a;
      housing.add(rib);
    }
    // legs down to the rail clamp
    for (const s of [-1, 1]) {
      const leg = box(0.06, 0.42, 0.1, M.housing, 0.0, -HR - 0.12, s * 0.16);
      leg.rotation.x = s * 0.35;
      housing.add(leg);
    }
    housing.add(box(0.07, 0.06, 0.5, M.greenDark, 0.0, -HR - 0.33, 0));
    // terminal box on top-front
    housing.add(box(0.1, 0.12, 0.16, M.greenDark, 0.02, HR - 0.04, 0.2));
  }
  housing.position.x = housingX;
  mx.add(housing);
  // stator: the copper coil ring on the housing face (axial-flux, it faces the rotor across the air gap)
  const stator = new THREE.Group();
  {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = box(0.02, 0.07, 0.05, M.copper, 0, Math.sin(a) * 0.33, Math.cos(a) * 0.33);
      c.rotation.x = -a;
      stator.add(c);
    }
    const yoke = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.39, 72), M.steelDark);
    yoke.rotation.y = Math.PI / 2;
    yoke.position.x = 0.012;
    stator.add(yoke);
  }
  stator.position.x = housingX - HX / 2 + 0.06;
  mx.add(stator);
  // rotor: a steel disc with the magnet ring facing the stator, the sheave on its hub, the brake disc rim
  const rotor = new THREE.Group();
  const rotorSpin = new THREE.Group();
  rotor.add(rotorSpin);
  {
    const disc = cyl(0.4, 0.02, M.steelDark, 'x', 72);
    disc.position.x = 0.0;
    rotorSpin.add(disc);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const mg = box(0.012, 0.075, 0.06, i % 2 ? M.magnet : M.steelDark, 0.016, Math.sin(a) * 0.33, Math.cos(a) * 0.33);
      mg.rotation.x = -a;
      rotorSpin.add(mg);
    }
    const marks = spokes(0.38, M.yellow, 2, 'x', 0.02);
    marks.position.x = -0.012;
    rotorSpin.add(marks);
  }
  rotor.position.x = housingX - HX / 2 + 0.035;
  mx.add(rotor);
  const sheave = new THREE.Group();
  {
    const s = new THREE.Mesh(sheaveGeo(R, sheaveW, S.n), M.steel);
    s.castShadow = s.receiveShadow = true;
    sheave.add(s);
    const face = cyl(R - 0.01, 0.004, M.steelDark, 'x', 48);
    face.position.x = -sheaveW / 2 - 0.012;
    sheave.add(face);
    const sp = spokes(R - 0.02, M.yellow, 2, 'x', 0.016);
    sp.position.x = -sheaveW / 2 - 0.016;
    sheave.add(sp);
    const hub = cyl(0.07, 0.03, M.steelDark, 'x');
    hub.position.x = -sheaveW / 2 - 0.02;
    sheave.add(hub);
    // the hub shaft through to the rotor
    const shaftC = cyl(0.05, housingX, M.steelDark, 'x');
    shaftC.position.x = housingX / 2;
    sheave.add(shaftC);
  }
  mx.add(sheave);
  // twin brakes on the rim, at about 10 and 2 o'clock, yellow-tagged as in the photo
  const brakes = [];
  for (const a of [Math.PI * 0.32, Math.PI * 0.68]) {
    const b = new THREE.Group();
    b.add(box(0.13, 0.11, 0.16, M.greenDark, 0, 0, 0));
    b.add(box(0.135, 0.02, 0.165, M.yellow, 0, 0.035, 0));
    b.position.set(housingX - 0.02, Math.sin(a) * (HR + 0.03), Math.cos(a) * (HR + 0.03));
    b.rotation.x = -(a - Math.PI / 2);
    b.userData.dir = new V3(0, Math.sin(a), Math.cos(a));
    b.userData.home = b.position.clone();
    mx.add(b);
    brakes.push(b);
  }
  // the bracket to the counterweight rails
  const bracket = box(0.05, 0.9, 0.9, M.steelDark, housingX + HX / 2 + 0.035, -0.25, -0.2);
  mx.add(bracket);

  // ---------------------------------------------------------------- dead-end hitches (top)
  const hitchL = new THREE.Group();
  hitchL.add(box(0.12, 0.03, 0.2, M.steelDark));
  for (let i = 0; i < S.n; i++) {
    const sp = cyl(0.012, 0.12, M.yellow, 'y', 10);
    sp.position.set(0, -0.07, (i - (S.n - 1) / 2) * 0.011 * 2.2);
    hitchL.add(sp);
  }
  hitchL.position.set(L.xL, L.hitchY + 0.015, L.ropeZ);
  shaft.add(hitchL);
  const hitchW = new THREE.Group();
  hitchW.add(box(0.2, 0.03, 0.12, M.steelDark));
  for (let i = 0; i < S.n; i++) {
    const sp = cyl(0.012, 0.12, M.yellow, 'y', 10);
    sp.position.set((i - (S.n - 1) / 2) * 0.011 * 2.2, -0.07, 0);
    hitchW.add(sp);
  }
  hitchW.position.set(L.xR, L.hitchY + 0.015, L.cwZ - rp);
  shaft.add(hitchW);

  // ---------------------------------------------------------------- overspeed governor and its rope loop
  const govR = S.govD / 2;
  const govTopY = HT - 0.45;
  const govBotY = H0 + 0.35;
  const gov = new THREE.Group();
  {
    const w = cyl(govR, 0.03, M.steel, 'x', 32);
    gov.add(w);
    const sp = spokes(govR, M.yellow, 2, 'x', 0.01);
    sp.position.x = 0.018;
    gov.add(sp);
  }
  gov.position.set(L.govX + 0.03, govTopY, L.govZ);
  shaft.add(gov);
  shaft.add(box(0.06, 0.14, 0.24, M.paint, L.govX + 0.01, govTopY, L.govZ)); // governor body
  const govTen = new THREE.Group();
  {
    const w = cyl(govR, 0.03, M.steel, 'x', 32);
    govTen.add(w);
    const sp = spokes(govR, M.yellow, 2, 'x', 0.01);
    sp.position.x = 0.018;
    govTen.add(sp);
  }
  govTen.position.set(L.govX + 0.03, govBotY, L.govZ);
  shaft.add(govTen);
  for (const dz of [-govR, govR]) {
    const r = cyl(0.003, govTopY - govBotY, M.rope, 'y', 6);
    r.position.set(L.govX + 0.03, (govTopY + govBotY) / 2, L.govZ + dz);
    shaft.add(r);
  }

  // ---------------------------------------------------------------- the car
  const car = new THREE.Group();
  root.add(car);
  const carBody = new THREE.Group(); // everything that x-ray / section touch
  car.add(carBody);
  const IW = S.carW;
  const ID = S.carD;
  const IH = S.carH;
  const OW = L.carOW;
  const OD = L.carOD;
  const zF = OD / 2; // car front (entrance) plane, local
  const platform = box(OW, 0.12, OD, M.paint, 0, -0.06, 0);
  car.add(platform);
  car.add(box(IW, 0.01, ID, M.floor, 0, 0.005, -0.0));
  const carParts = {};
  carParts.left = box(0.03, IH, ID, M.carWall, -IW / 2 - 0.015, IH / 2, 0);
  carParts.right = box(0.03, IH, ID, M.carWall, IW / 2 + 0.015, IH / 2, 0);
  carParts.back = box(IW + 0.06, IH, 0.03, M.carWall, 0, IH / 2, -ID / 2 - 0.015);
  const retW = (IW - S.doorW) / 2;
  carParts.retL = box(retW, IH, 0.04, M.carWall, -IW / 2 + retW / 2, IH / 2, ID / 2 + 0.02);
  carParts.retR = box(retW, IH, 0.04, M.carWall, IW / 2 - retW / 2, IH / 2, ID / 2 + 0.02);
  carParts.ceil = box(IW + 0.06, 0.06, ID + 0.06, M.carWall, 0, IH + 0.03, 0);
  for (const k of Object.keys(carParts)) carBody.add(carParts[k]);
  carParts.home = Object.fromEntries(Object.entries(carParts).map(([k, m]) => [k, m.position.clone()]));
  const ceilLight = box(IW - 0.2, 0.01, ID - 0.3, M.ceil, 0, IH - 0.006, 0);
  carBody.add(ceilLight);
  // handrail and the car operating panel
  const rail = cyl(0.016, IW - 0.2, M.steel, 'x', 12);
  rail.position.set(0, 0.9, -ID / 2 + 0.05);
  carBody.add(rail);
  const cop = box(0.012, 0.9, 0.18, M.steelDark, IW / 2 - 0.005, 1.15, ID / 2 - 0.25);
  carBody.add(cop);
  // car door: two panels on two tracks just in front of the entrance; the operator header above
  const cpw = S.doorW / 2 + 0.03;
  const carFast = box(cpw, S.doorH, 0.025, M.carDoor, 0, S.doorH / 2, zF + 0.025);
  const carSlow = box(cpw, S.doorH, 0.025, M.carDoor, 0, S.doorH / 2, zF + 0.055);
  car.add(carFast, carSlow);
  const operator = box(1.45, 0.16, 0.14, M.paint, 0.225, IH + 0.14, zF + 0.04);
  car.add(operator);
  car.add(box(1.45, 0.02, 0.06, M.steelDark, 0.225, -0.01, zF + 0.04)); // car sill
  // sling: two stiles on the rail sides, crosshead, guide shoes top and bottom, safety gear
  const stileX = OW / 2 + 0.035;
  const slingTop = IH + 0.3;
  const slingBot = -L.carPulleyDrop - rp - 0.04;
  for (const s of [-1, 1]) {
    car.add(box(0.05, slingTop - slingBot, 0.12, M.paint, s * stileX, (slingTop + slingBot) / 2, -0.1));
    for (const y of [slingTop - 0.06, slingBot + 0.06]) car.add(box(0.05, 0.1, 0.1, M.yellow, s * (carRailX - 0.055), y, 0));
    car.add(box(0.06, 0.16, 0.14, M.steelDark, s * (carRailX - 0.06), slingBot + 0.2, 0)); // safety gear
  }
  car.add(box(2 * stileX + 0.05, 0.1, 0.12, M.paint, 0, slingTop - 0.05, -0.1)); // crosshead
  // roof balustrade (yellow toe board)
  for (const [w, d, x, z] of [[OW - 0.1, 0.03, 0, -OD / 2 + 0.06], [0.03, OD * 0.7, -OW / 2 + 0.06, -OD * 0.12], [0.03, OD * 0.7, OW / 2 - 0.06, -OD * 0.12]]) {
    car.add(box(w, 0.03, d, M.steelDark, x, IH + 1.1, z));
    car.add(box(w, 0.1, d, M.yellow, x, IH + 0.12, z));
  }
  for (const [x, z] of [[-OW / 2 + 0.06, -OD / 2 + 0.06], [OW / 2 - 0.06, -OD / 2 + 0.06], [-OW / 2 + 0.06, OD * 0.23], [OW / 2 - 0.06, OD * 0.23]]) car.add(box(0.03, 1.1, 0.03, M.steelDark, x, IH + 0.6, z));
  // under-car pulleys (axis along z), the beam that carries them, yellow guards
  const pulleys = [];
  const pz = L.ropeZ - L.carZ;
  const py = -L.carPulleyDrop;
  car.add(box(L.xR - L.xL - 0.1, 0.1, 0.14, M.paint, (L.xR + L.xL) / 2 - L.carX, py + rp + 0.05, pz));
  for (const px of [L.xL + rp - L.carX, L.xR - rp - L.carX]) {
    const p = new THREE.Group();
    const geo = sheaveGeo(rp, 0.075, S.n, 0.01);
    geo.rotateY(Math.PI / 2); // axis x → z
    const m = new THREE.Mesh(geo, M.steel);
    m.castShadow = true;
    p.add(m);
    const sp = spokes(rp - 0.01, M.yellow, 2, 'x', 0.012);
    sp.rotation.y = Math.PI / 2;
    sp.position.z = 0.05;
    p.add(sp);
    p.position.set(px, py, pz);
    car.add(p);
    pulleys.push(p);
    const guard = box(0.06, 0.04, 0.12, M.yellow, px, py + rp + 0.03, pz);
    car.add(guard);
  }
  // governor rope arm (car to the governor rope)
  car.add(box(0.11, 0.04, 0.04, M.steelDark, L.govX + 0.03 - L.carX + 0.055, slingBot + 0.25, L.govZ - govR - L.carZ));

  // ---------------------------------------------------------------- the counterweight
  const cw = new THREE.Group();
  root.add(cw);
  const FH = L.cwFrameH;
  const cwX = S.cwPlateX + 0.03;
  const cwZd = S.cwPlateZ;
  for (const s of [-1, 1]) {
    cw.add(box(cwX, FH, 0.04, M.paint, 0, FH / 2, s * (cwZd / 2 - 0.0)));
    cw.add(box(0.06, 0.1, 0.06, M.yellow, 0, FH - 0.08, s * (cwZd / 2 + 0.01)));
    cw.add(box(0.06, 0.1, 0.06, M.yellow, 0, 0.08, s * (cwZd / 2 + 0.01)));
  }
  cw.add(box(cwX, 0.08, cwZd + 0.04, M.paint, 0, 0.04, 0));
  cw.add(box(cwX, 0.08, cwZd + 0.04, M.paint, 0, FH - 0.04, 0));
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(S.cwPlateX, S.plateT * 0.94, cwZd - 0.05), M.steelDark, L.plates);
  {
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < L.plates; i++) {
      m4.makeTranslation(0, 0.08 + S.plateT * (i + 0.5), 0);
      plates.setMatrixAt(i, m4);
    }
    plates.castShadow = true;
    plates.receiveShadow = true;
  }
  cw.add(plates);
  const cwPulley = new THREE.Group();
  {
    const m = new THREE.Mesh(sheaveGeo(rp, 0.075, S.n, 0.01), M.steel);
    m.castShadow = true;
    cwPulley.add(m);
    const sp = spokes(rp - 0.01, M.yellow, 2, 'x', 0.012);
    sp.position.x = -0.05;
    cwPulley.add(sp);
  }
  cwPulley.position.set(0, FH + 0.05 + rp, 0);
  cw.add(cwPulley);
  cw.add(box(0.03, 0.05 + rp, 0.06, M.paint, -0.055, FH + (0.05 + rp) / 2, 0));
  cw.add(box(0.03, 0.05 + rp, 0.06, M.paint, 0.055, FH + (0.05 + rp) / 2, 0));

  // ---------------------------------------------------------------- the ropes: 5 straight runs × 6 ropes, 4 arcs × 6
  const ropeR = S.d / 2;
  const off = (i) => (i - (S.n - 1) / 2) * 0.011;
  const ropeStraight = new THREE.InstancedMesh(new THREE.CylinderGeometry(ropeR, ropeR, 1, 6), M.rope, S.n * 5);
  ropeStraight.castShadow = true;
  ropeStraight.frustumCulled = false;
  const arcGeo = (r, arc) => new THREE.TorusGeometry(r, ropeR, 5, 24, arc);
  const arcQ = new THREE.InstancedMesh(arcGeo(rp, Math.PI / 2), M.rope, S.n * 2);
  const arcP = new THREE.InstancedMesh(arcGeo(rp, Math.PI), M.rope, S.n);
  const arcS = new THREE.InstancedMesh(arcGeo(R, Math.PI), M.rope, S.n);
  for (const m of [arcQ, arcP, arcS]) {
    m.frustumCulled = false;
    m.castShadow = true;
  }
  const ropes = new THREE.Group();
  ropes.add(ropeStraight, arcQ, arcP, arcS);
  root.add(ropes);
  // tracer marks on rope 3 at fixed material points
  const MARK_STEP = 1.0;
  const markCount = 48;
  const marks = new THREE.InstancedMesh(new THREE.CylinderGeometry(ropeR * 1.6, ropeR * 1.6, 0.06, 8), M.accent, markCount);
  marks.frustumCulled = false;
  ropes.add(marks);

  // ---------------------------------------------------------------- travelling cable (flat, U-loop)
  const tcX = L.carX - 0.3;
  const tcZ = L.carZ - 0.95;
  const tcMat = std('#2c2f33', {roughness: 0.7});
  const tcA = box(0.05, 1, 0.012, tcMat);
  const tcB = box(0.05, 1, 0.012, tcMat);
  const tcU = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 4, 20, Math.PI), tcMat);
  tcU.scale.set(1, 1, 0.8);
  root.add(tcA, tcB, tcU);
  shaft.add(box(0.12, 0.06, 0.05, M.steelDark, tcX, L.tcFixY, -SD / 2 + 0.03));

  // ---------------------------------------------------------------- display state
  const CLIP_CAR = new THREE.Plane(new V3(-1, 0, 0), 0);
  const CLIP_MX = new THREE.Plane(new V3(0, 0, -1), 0);
  let xrayNow = -1;
  const setXray = (k) => {
    if (Math.abs(k - xrayNow) < 1e-3) return;
    xrayNow = k;
    M.carWall.opacity = 1 - 0.82 * k;
    M.carWall.depthWrite = k < 0.5;
    M.housing.opacity = 1 - 0.78 * k;
    M.housing.depthWrite = k < 0.5;
  };
  let sectionNow = null;
  const sectionMats = [M.carWall, M.housing, M.ceil, M.floor, M.carDoor];
  const setSection = (on) => {
    if (on === sectionNow) return;
    sectionNow = on;
    for (const m of sectionMats) {
      m.clippingPlanes = on ? (m === M.housing ? [CLIP_MX] : [CLIP_CAR]) : null;
      m.clipShadows = true;
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
  };

  // ---------------------------------------------------------------- pose everything from the state
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new V3();
  const up = new V3(0, 1, 0);
  const seg = (mesh, idx, a, b) => {
    const d = new V3().subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    sc.set(1, len, 1);
    m4.compose(new V3().addVectors(a, b).multiplyScalar(0.5), q, sc);
    mesh.setMatrixAt(idx, m4);
  };
  const eul = new THREE.Euler();
  const arcAt = (mesh, idx, c, rx, ry, rz, order = 'XYZ') => {
    eul.set(rx, ry, rz, order);
    q.setFromEuler(eul);
    m4.compose(c, q, sc.set(1, 1, 1));
    mesh.setMatrixAt(idx, m4);
  };
  // the rope path for rope i as a list of pieces, from the dead-end hitch: used for the poses and the tracer marks
  const path = (st, i) => {
    const o = off(i);
    const c = st.cY;
    const w = st.cwY;
    const zr = L.ropeZ + o;
    const P = [];
    P.push({k: 'line', a: new V3(L.xL, L.hitchY, zr), b: new V3(L.xL, c, zr)});
    P.push({k: 'arc', c: new V3(L.xL + rp, c, zr), r: rp, a0: Math.PI, a1: 1.5 * Math.PI, plane: 'xy'});
    P.push({k: 'line', a: new V3(L.xL + rp, c - rp, zr), b: new V3(L.xR - rp, c - rp, zr)});
    P.push({k: 'arc', c: new V3(L.xR - rp, c, zr), r: rp, a0: -0.5 * Math.PI, a1: 0, plane: 'xy'});
    P.push({k: 'line', a: new V3(L.xR, c, zr), b: new V3(L.xR + o, L.sheaveY, L.ropeZ)});
    P.push({k: 'arc', c: new V3(L.xR + o, L.sheaveY, L.sheaveZ), r: R, a0: 0, a1: Math.PI, plane: 'zy+'});
    P.push({k: 'line', a: new V3(L.xR + o, L.sheaveY, L.sheaveZ - R), b: new V3(L.xR + o, w, L.cwZ + rp)});
    P.push({k: 'arc', c: new V3(L.xR + o, w, L.cwZ), r: rp, a0: 0, a1: Math.PI, plane: 'zy-'});
    P.push({k: 'line', a: new V3(L.xR + o, w, L.cwZ - rp), b: new V3(L.xR + o, L.hitchY, L.cwZ - rp)});
    for (const p of P) p.len = p.k === 'line' ? p.a.distanceTo(p.b) : p.r * (p.a1 - p.a0);
    return P;
  };
  const pointOn = (P, u, out, tan) => {
    for (const p of P) {
      if (u <= p.len) {
        const k = u / p.len;
        if (p.k === 'line') {
          out.lerpVectors(p.a, p.b, k);
          tan.subVectors(p.b, p.a).normalize();
        } else {
          const a = p.a0 + (p.a1 - p.a0) * k;
          if (p.plane === 'xy') {
            out.set(p.c.x + p.r * Math.cos(a), p.c.y + p.r * Math.sin(a), p.c.z);
            tan.set(-Math.sin(a), Math.cos(a), 0);
          } else if (p.plane === 'zy+') {
            out.set(p.c.x, p.c.y + p.r * Math.sin(a), p.c.z + p.r * Math.cos(a));
            tan.set(0, Math.cos(a), -Math.sin(a));
          } else {
            out.set(p.c.x, p.c.y - p.r * Math.sin(a), p.c.z + p.r * Math.cos(a));
            tan.set(0, -Math.cos(a), -Math.sin(a));
          }
        }
        return true;
      }
      u -= p.len;
    }
    return false;
  };
  const pt = new V3();
  const tn = new V3();

  /** st: stateAt() output. d: {xray, section, explode, shaft} */
  const update = (st, d = {}) => {
    const ex = d.explode ?? 0;
    setXray(d.xray ?? 0);
    setSection(!!d.section);
    ghostMat.uniforms.uA.value = 0.55 * (d.shaft ?? 1);
    walls.userData.on = (d.shaft ?? 1) > 0.02;
    walls.visible = walls.userData.on;
    edgeMat.opacity = 0.25 + 0.5 * (d.shaft ?? 1);

    // car and counterweight
    car.position.set(L.carX, st.y, L.carZ);
    cw.position.set(L.xR, st.cwBottom, L.cwZ);
    CLIP_CAR.constant = L.carX + 0.05; // keeps x < carX + 0.05: the right half of the car comes away
    CLIP_MX.constant = L.sheaveZ; // the machine cut through its axis
    // pulleys: each rolls at v / r about its own axis; sheave and rotor at 2v / R
    for (const p of pulleys) p.rotation.z = st.pulleyAngle;
    cwPulley.rotation.x = st.pulleyAngle;
    sheave.rotation.x = -st.sheaveAngle;
    rotorSpin.rotation.x = -st.sheaveAngle;
    gov.rotation.x = st.govAngle;
    govTen.rotation.x = st.govAngle;

    // car door and the landing door at the floor the car is stopped at (coupled by the door vanes)
    const dx = -S.doorW / 4 - 0.0;
    carFast.position.x = dx + st.doorFast;
    carSlow.position.x = -dx + st.doorSlow;
    for (let i = 0; i < landing.length; i++) {
      const at = st.landing === i;
      const f = at ? st.doorFast : 0;
      const s = at ? st.doorSlow : 0;
      landing[i].fast.position.x = dx + f;
      landing[i].slow.position.x = -dx + s;
    }

    // exploded: the MX10 comes apart along its axis into the shaft; the car walls stand off
    sheave.position.x = -0.62 * ex;
    rotor.position.x = housingX - HX / 2 + 0.035 - 0.36 * ex;
    stator.position.x = housingX - HX / 2 + 0.06 - 0.12 * ex;
    for (const b of brakes) b.position.copy(b.userData.home).addScaledVector(b.userData.dir, 0.22 * ex);
    const H = carParts.home;
    carParts.left.position.copy(H.left).add(new V3(-0.5 * ex, 0, 0));
    carParts.right.position.copy(H.right).add(new V3(0.5 * ex, 0, 0));
    carParts.back.position.copy(H.back).add(new V3(0, 0, -0.5 * ex));
    carParts.ceil.position.copy(H.ceil).add(new V3(0, 0.6 * ex, 0));
    carParts.retL.position.copy(H.retL).add(new V3(-0.2 * ex, 0, 0.5 * ex));
    carParts.retR.position.copy(H.retR).add(new V3(0.2 * ex, 0, 0.5 * ex));
    ceilLight.position.y = IH - 0.006 + 0.6 * ex;
    ropes.visible = ex < 0.15;

    // ropes
    if (ropes.visible) {
      for (let i = 0; i < S.n; i++) {
        const P = path(st, i);
        let li = 0;
        for (const p of P) if (p.k === 'line') seg(ropeStraight, i * 5 + li++, p.a, p.b);
        const o = off(i);
        arcAt(arcQ, i * 2, P[1].c, 0, 0, Math.PI);
        arcAt(arcQ, i * 2 + 1, P[3].c, 0, 0, -Math.PI / 2);
        arcAt(arcS, i, P[5].c, 0, -Math.PI / 2, 0);
        arcAt(arcP, i, P[7].c, Math.PI, -Math.PI / 2, 0, 'XYZ');
        void o;
      }
      ropeStraight.instanceMatrix.needsUpdate = true;
      arcQ.instanceMatrix.needsUpdate = true;
      arcS.instanceMatrix.needsUpdate = true;
      arcP.instanceMatrix.needsUpdate = true;
      // marks at material coordinates u = 0.5, 1.5, ... from the dead-end hitch on rope 3
      const P = path(st, 3);
      for (let k = 0; k < markCount; k++) {
        const u = 0.5 + k * MARK_STEP;
        if (pointOn(P, u, pt, tn)) {
          q.setFromUnitVectors(up, tn);
          m4.compose(pt, q, sc.set(1, 1, 1));
        } else m4.makeScale(0, 0, 0);
        marks.setMatrixAt(k, m4);
      }
      marks.instanceMatrix.needsUpdate = true;
    }

    // travelling cable: wall fixing → loop → car underside, loop bottom from lift.js
    const yb = st.tcLoop;
    const yFix = L.tcFixY;
    const yCar = st.y - 0.3;
    tcA.scale.y = Math.max(0.01, yFix - yb);
    tcA.position.set(tcX, (yFix + yb) / 2, tcZ - 0.0);
    tcB.scale.y = Math.max(0.01, yCar - yb);
    tcB.position.set(tcX + 0.3, (yCar + yb) / 2, tcZ);
    tcU.position.set(tcX + 0.15, yb, tcZ);
    tcU.rotation.set(0, 0, Math.PI);
  };

  return {
    root, update, M, ghosts, car, cw, mx, sheave, housing, stator, rotor, brakes, pulleys, cwPulley, landing, walls, ghostMat, edgeMat,
    anchors: {housingX, HR, govTopY, slingBot, tcX, tcZ},
  };
}

/** world anchors for the labels: [name, sub, (st) => V3] */
export function labelAnchors(lift) {
  const A = lift.anchors;
  return [
    {key: 'mx10', name: 'MX10 HOISTING MACHINE', sub: 'AXIAL-FLUX PM · GEARLESS', at: () => new V3(L.xR + A.housingX, L.sheaveY + 0.25, L.sheaveZ + 0.25)},
    {key: 'sheave', name: 'TRACTION SHEAVE Ø480', sub: `${S.n} GROOVES · 2v AT THE RIM`, at: (st, ex = 0) => new V3(L.xR - 0.05 - 0.62 * ex, L.sheaveY - 0.1, L.sheaveZ + 0.12)},
    {key: 'rotor', name: 'ROTOR · MAGNET RING', sub: 'TURNS WITH THE SHEAVE', at: (st, ex = 0) => new V3(L.xR + A.housingX - 0.05 - 0.36 * ex, L.sheaveY + 0.3, L.sheaveZ - 0.1), exOnly: true},
    {key: 'stator', name: 'STATOR COILS', sub: 'AXIAL AIR GAP TO THE ROTOR', at: (st, ex = 0) => new V3(L.xR + A.housingX - 0.02 - 0.12 * ex, L.sheaveY - 0.33, L.sheaveZ + 0.05), exOnly: true},
    {key: 'brakes', name: 'TWIN BRAKES', sub: 'SET AT EVERY STOP', at: (st, ex = 0) => new V3(L.xR + A.housingX, L.sheaveY + A.HR + 0.05 + 0.2 * ex, L.sheaveZ + 0.25)},
    {key: 'hitch', name: 'DEAD-END HITCH', sub: '2:1 · ROPE ANCHORED HERE', at: () => new V3(L.xL, L.hitchY, L.ropeZ)},
    {key: 'car', name: 'CAR · 1100 × 2100', sub: 'P 1100 KG + LOAD', at: (st) => new V3(L.carX - 0.3, st.y + 1.6, L.carZ + 0.3)},
    {key: 'pulleys', name: 'UNDER-CAR PULLEYS', sub: 'ROPE RUNS BENEATH THE CAR', at: (st) => new V3(L.xR - rp, st.cY, L.ropeZ)},
    {key: 'door', name: 'TELESCOPIC DOOR', sub: 'FAST PANEL 2× SLOW', at: (st) => new V3(L.carX + 0.1, st.y + 1.2, L.SD / 2)},
    {key: 'cw', name: 'COUNTERWEIGHT 1600 KG', sub: `${L.plates} FILLER PLATES`, at: (st) => new V3(L.xR, st.cwBottom + L.cwFrameH * 0.5, L.cwZ)},
    {key: 'cwp', name: 'COUNTERWEIGHT PULLEY', sub: 'MOVES AT v, ROPE AT 2v', at: (st) => new V3(L.xR, st.cwY, L.cwZ)},
    {key: 'rail', name: 'CAR GUIDE RAIL', sub: 'T-PROFILE', at: (st) => new V3(L.carX - L.carOW / 2 - 0.07, Math.min(TRAVEL, Math.max(0, st.y + 3.2)), L.carZ)},
    {key: 'gov', name: 'OVERSPEED GOVERNOR', sub: 'TRIPS ≥ 1.15 m/s', at: () => new V3(L.govX + 0.03, A.govTopY, L.govZ)},
    {key: 'tc', name: 'TRAVELLING CABLE', sub: 'LOOP AT HALF THE CAR TRAVEL', at: (st) => new V3(A.tcX + 0.15, st.tcLoop, A.tcZ)},
    {key: 'ropes', name: `${S.n} × Ø8 ROPES`, sub: 'ORANGE MARKS RIDE WITH THE ROPE', at: (st) => new V3(L.xR, (st.cY + L.sheaveY) / 2, L.ropeZ)},
  ];
}
void DOOR;
