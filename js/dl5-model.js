/**
 * DermLite DL5 Plus - Photo-textured 3D Model (Three.js r147 classic build)
 *
 * Proportions and details follow the real device (official photos + assets/dermlite_360_photos):
 *   - slim handle (~25 mm deep) with dotted grip texture and a chrome seam
 *   - black knurled band wrapping the head rim, chrome edge lines
 *   - finely knurled silver polarization dial and contact plate at the back
 *   - two round buttons on one side, one on the other
 *
 * Surfaces are real photographs projected in object space (see scripts/build_dl5_textures.py):
 *   +Z front  : official straight-on front (lens, indicator bar, LED button, logo, 5V)
 *   -Z back   : IMG_8004 (torch LED, "D" mark, printed ruler)
 *   +X / -X   : IMG_8006 / IMG_8007 (buttons, seam, grip dots)
 *   plate     : official contact plate + LED ring + silver dial face
 * Everything not covered by a photo uses the matte black sampled from the official photos,
 * so the whole body reads as one material.
 *
 * Units: 1 unit = 10 mm.
 */

const DL5Model = (() => {
  const HEAD_Y = 6.2;          // head centre
  const HEAD_R = 2.72;         // body head outline
  // Head layout measured on the real device (360° rotation video, side / back / front frames):
  // the head sits forward of the handle — its front shell stands ~4 mm proud of the handle face
  // and the silver dial ~9 mm behind the handle back; the band is ~21 mm, the dial ~14.5 mm.
  const BAND_R = 2.74;         // black knurled band (peak of a subtle barrel)
  const SILVER_R = 2.62;       // silver dial outer radius (= band back end, real side view)
  const HALF_DEPTH = 1.25;     // handle half thickness
  const FRONT_Z = 1.68;        // head front face (lens), proud of the handle face
  const BAND_FRONT = 1.42;     // band front edge (chrome line), just behind the front shell rim
  const BAND_BACK = -0.67;     // band meets the silver dial's toothed drum
  const PLATE_R = 1.9;         // black LED ring + glass window (texture): 73% of the dial (real back view)
  const PLATE_Z = -2.06;

  /* ---------- Textures ---------- */

  function photoTexture(THREE, uri, srgb) {
    const t = new THREE.TextureLoader().load(uri);
    t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
    t.anisotropy = 8;
    return t;
  }

  function glowTexture(THREE) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  const srgbToLinear = v => Math.pow(v / 255, 2.2);

  /* ---------- Geometry helpers ---------- */

  // The body's own head circle is hidden inside the front shell, band and dial; it is kept
  // smaller (BODY_HEAD_R) so it never pokes out between them.
  const BODY_HEAD_R = 2.5;
  function bodyShape(THREE) {
    const s = new THREE.Shape();
    const bottomR = 1.93;
    const bottomY = -9.1 + bottomR;
    const jx = 2.15;
    const jy = HEAD_Y - Math.sqrt(BODY_HEAD_R * BODY_HEAD_R - jx * jx);
    s.moveTo(-bottomR, bottomY);
    s.absarc(0, bottomY, bottomR, Math.PI, Math.PI * 2, false);
    s.lineTo(2.0, 3.2);
    s.quadraticCurveTo(2.0, 4.1, jx, jy);
    const a = Math.atan2(jy - HEAD_Y, jx);
    s.absarc(0, HEAD_Y, BODY_HEAD_R, a, Math.PI - a, false);
    s.quadraticCurveTo(-2.0, 4.1, -2.0, 3.2);
    s.lineTo(-bottomR, bottomY);
    return s;
  }

  function halfWidth(y) {
    const by = -9.1 + 1.93;
    return 1.93 + ((y - by) / (3.2 - by)) * 0.07;
  }

  // ExtrudeGeometry is non-indexed, so its normals come out faceted.
  // Average normals of coincident vertices to get a smooth, moulded body.
  function smoothNormals(THREE, geo) {
    const pos = geo.attributes.position;
    const acc = new Map();
    const keys = new Array(pos.count);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const cb = new THREE.Vector3(), ab = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      keys[i] = `${Math.round(pos.getX(i) * 1000)}|${Math.round(pos.getY(i) * 1000)}|${Math.round(pos.getZ(i) * 1000)}`;
    }
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      cb.subVectors(c, b);
      ab.subVectors(a, b);
      cb.cross(ab);
      for (let k = i; k < i + 3; k++) {
        let v = acc.get(keys[k]);
        if (!v) {
          v = new THREE.Vector3();
          acc.set(keys[k], v);
        }
        v.add(cb);
      }
    }
    const normals = new Float32Array(pos.count * 3);
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      n.copy(acc.get(keys[i])).normalize();
      normals[i * 3] = n.x;
      normals[i * 3 + 1] = n.y;
      normals[i * 3 + 2] = n.z;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  }

  // Revolved ring around the Z axis from a [r, z] profile (listed back -> front, so normals
  // face outward), knurled with `ridges` ridges whose depth follows knurlW(z).
  // style: 'round' = soft rubber ridges (head band), 'teeth' = square milled teeth (silver dial)
  const toothGroove = f => 1 - (smooth(0.06, 0.14, f) - smooth(0.56, 0.64, f));
  function smooth(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function knurledLathe(THREE, profile, ridges, depth, style, knurlW) {
    const rounded = style === 'round';
    const seg = ridges * (rounded ? 8 : 10);
    const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), seg);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const zc = p.getZ(i);
      const rr = Math.hypot(x, zc);
      if (rr < 1e-4) continue;
      let f = ((Math.atan2(x, zc) / (Math.PI * 2)) * ridges) % 1;
      if (f < 0) f += 1;
      const prof = rounded ? Math.pow(0.5 - 0.5 * Math.cos(f * Math.PI * 2), 2.2) : toothGroove(f);
      const nr = rr - depth * prof * knurlW(p.getY(i));
      p.setX(i, (x / rr) * nr);
      p.setZ(i, (zc / rr) * nr);
    }
    g.computeVertexNormals();
    g.rotateX(Math.PI / 2); // lathe axis Y -> model Z (profile z is preserved)
    return g;
  }

  // Subtle barrel-shaped band (real side views): widest at z≈0.35 (R), ~1 mm smaller at each
  // end, with small rounded shoulders (e), flowing into the front shell.
  const BAND_PEAK_Z = 0.35;
  function bandRadius(z) {
    const kb = 0.1 / Math.pow(BAND_PEAK_Z - BAND_BACK, 2);
    const kf = 0.12 / Math.pow(BAND_FRONT - BAND_PEAK_Z, 2);
    return BAND_R - (z < BAND_PEAK_Z ? kb : kf) * Math.pow(z - BAND_PEAK_Z, 2);
  }
  function bandProfile(R, zBack, zFront, e) {
    const pts = [];
    const rb = bandRadius(zBack + e), rf = bandRadius(zFront - e);
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI / 2;
      pts.push([rb - e + e * Math.sin(t), zBack + e - e * Math.cos(t)]);
    }
    for (let k = 1; k < 16; k++) {
      const z = zBack + e + ((zFront - zBack - 2 * e) * k) / 16;
      pts.push([bandRadius(z), z]);
    }
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI / 2;
      pts.push([rf - e + e * Math.cos(t), zFront - e + e * Math.sin(t)]);
    }
    return pts;
  }

  // Silver dial (real side + back views): one long convex curve from the band joint down to a
  // thin lip around the recessed plate — no straight drum. The fine milled teeth sit on the
  // steep outer part of the curve, next to the band.
  const DIAL_CZ = BAND_BACK - 0.05;   // ellipse centre z (the curve meets the band here)
  function dialProfile() {
    const pts = [[PLATE_R, PLATE_Z], [PLATE_R + 0.03, PLATE_Z - 0.04], [PLATE_R + 0.07, PLATE_Z - 0.065]];
    const r0 = PLATE_R + 0.07;
    const z0 = PLATE_Z - 0.065;         // back-most point (lip)
    for (let i = 1; i <= 26; i++) {
      const t = (i / 26) * Math.PI / 2;
      pts.push([r0 + (SILVER_R - r0) * Math.sin(t), DIAL_CZ - (DIAL_CZ - z0) * Math.cos(t)]);
    }
    pts.push([SILVER_R - 0.02, BAND_BACK - 0.02], [SILVER_R - 0.06, BAND_BACK]);
    return pts;
  }
  // Front shell of the head: proud of the handle face, rounded rim (r 0.28), flat lens face.
  // Starts inside the band's front shoulder; the front photo is projected onto it.
  function frontCapProfile() {
    const pts = [[2.52, BAND_FRONT - 0.16]];  // starts inside the band's front end
    const rr = 0.4, R0 = 2.66;                 // big soft rim: shell + band read as one form
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI / 2;
      pts.push([R0 - rr + rr * Math.cos(t), FRONT_Z - rr + rr * Math.sin(t)]);
    }
    [2.0, 1.6, 1.1, 0.6, 0.2, 0].forEach(r => pts.push([r, FRONT_Z]));
    return pts;
  }
  /* ---------- Photo-projected matte body material ---------- */

  // Projects the four photos onto whichever surfaces face their camera (object-space UVs),
  // blending across the rounded edges. Uncovered areas use the official matte black.
  // Colour fidelity: the material skips filmic tone mapping and splits the photo albedo into
  // a steady emissive part (photoGlow) plus a smaller lit part (photoShade), so a front-facing
  // surface renders at ~1.0x the photographed colour and turning away only shades it gently.
  function photoBodyMaterial(THREE, maps, T, blackRGB) {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(blackRGB[0], blackRGB[1], blackRGB[2]),
      toneMapped: false,
      roughness: 0.72, metalness: 0, specularIntensity: 0.4,
      clearcoat: 0.08, clearcoatRoughness: 0.5, envMapIntensity: 0.14
    });
    const vb = b => new THREE.Vector4(b.u0, b.v0, b.u1 - b.u0, b.v1 - b.v0);
    // calibrated in the browser: face-on surfaces render at the official sRGB 45 (+-3)
    m.userData.photoGlow = { value: 0.43 };
    m.userData.photoShade = { value: 0.32 };
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        mapFront: { value: maps.front }, bFront: { value: vb(T.front.bounds) },
        mapBack: { value: maps.back }, bBack: { value: vb(T.back.bounds) },
        mapSideR: { value: maps.sideR }, bSideR: { value: vb(T.sideR.bounds) },
        mapSideL: { value: maps.sideL }, bSideL: { value: vb(T.sideL.bounds) },
        photoGlow: m.userData.photoGlow,
        photoShade: m.userData.photoShade
      });

      shader.vertexShader = 'varying vec3 vObjPos;\nvarying vec3 vObjNormal;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vObjPos = position;\n  vObjNormal = normal;'
        );

      shader.fragmentShader = `
uniform sampler2D mapFront, mapBack, mapSideR, mapSideL;
uniform vec4 bFront, bBack, bSideR, bSideL;
uniform float photoGlow;
uniform float photoShade;
varying vec3 vObjPos;
varying vec3 vObjNormal;
vec4 photoAt(sampler2D tex, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec4 t = texture2D(tex, uv);
  return vec4(pow(t.rgb, vec3(2.2)), t.a);
}
` + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 pn = normalize(vObjNormal);
  float wF = smoothstep(0.3, 0.8, pn.z);
  float wB = smoothstep(0.3, 0.8, -pn.z);
  float wR = smoothstep(0.3, 0.8, pn.x);
  float wL = smoothstep(0.3, 0.8, -pn.x);
  vec4 cF = photoAt(mapFront, vec2((vObjPos.x - bFront.x) / bFront.z, (vObjPos.y - bFront.y) / bFront.w));
  vec4 cB = photoAt(mapBack,  vec2((bBack.x + bBack.z - vObjPos.x) / bBack.z, (vObjPos.y - bBack.y) / bBack.w));
  vec4 cR = photoAt(mapSideR, vec2((bSideR.x + bSideR.z - vObjPos.z) / bSideR.z, (vObjPos.y - bSideR.y) / bSideR.w));
  vec4 cL = photoAt(mapSideL, vec2((vObjPos.z - bSideL.x) / bSideL.z, (vObjPos.y - bSideL.y) / bSideL.w));
  float aF = wF * cF.a, aB = wB * cB.a, aR = wR * cR.a, aL = wL * cL.a;
  float aSum = aF + aB + aR + aL;
  vec3 photo = (cF.rgb * aF + cB.rgb * aB + cR.rgb * aR + cL.rgb * aL) / max(aSum, 1e-4);
  vec3 photoAlbedo = mix(diffuseColor.rgb, photo, clamp(aSum, 0.0, 1.0));
  diffuseColor.rgb = photoAlbedo * photoShade;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += photoAlbedo * photoGlow;`);
    };
    return m;
  }

  /* ---------- Build ---------- */

  function build(THREE) {
    const T = window.DL5_TEXTURES;
    if (!T) throw new Error('DL5 photo textures missing (js/dl5-textures.js)');

    // Official matte black (sampled from the official product photos), in linear RGB
    const blackSrgb = T.blackRGB || [T.black || 40, T.black || 40, T.black || 40];
    const blackRGB = blackSrgb.map(srgbToLinear);
    const root = new THREE.Group();
    root.name = 'DL5Plus';

    const tex = {
      front: photoTexture(THREE, T.front.src, false),
      back: photoTexture(THREE, T.back.src, false),
      sideR: photoTexture(THREE, T.sideR.src, false),
      sideL: photoTexture(THREE, T.sideL.src, false),
      plate: photoTexture(THREE, T.plate, true),
      glow: glowTexture(THREE)
    };

    const matteBlack = c => new THREE.Color(blackRGB[0] * c, blackRGB[1] * c, blackRGB[2] * c);
    const M = {
      body: photoBodyMaterial(THREE, tex, T, blackRGB),
      band: new THREE.MeshStandardMaterial({
        // same split as the body: 0.32 lit + 0.43 emissive, no tone mapping
        // more lit, less self-lit than the body so the rubber ribs cast real groove shading
        color: matteBlack(0.34), emissive: matteBlack(0.32), roughness: 0.62, metalness: 0, envMapIntensity: 0.15,
        toneMapped: false
      }),
      // satin bead-blasted aluminium (official close-up), not a mirror
      silverKnurl: new THREE.MeshStandardMaterial({
        color: 0x75787d, roughness: 0.48, metalness: 1, envMapIntensity: 0.34
      }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd0d3d8, roughness: 0.18, metalness: 1, envMapIntensity: 1 }),
      plate: new THREE.MeshStandardMaterial({
        map: tex.plate, color: 0x6e6e6e, emissiveMap: tex.plate, emissive: 0xffffff, emissiveIntensity: 0.18,
        roughness: 0.3, metalness: 0.1, alphaTest: 0.5, envMapIntensity: 0.4
      }),
      lensGlass: new THREE.MeshPhysicalMaterial({
        color: 0x1a1f3a, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
        iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [220, 560],
        transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 1.2
      }),
      // dark contact glass: visible reflections like the official close-up
      plateGlass: new THREE.MeshPhysicalMaterial({
        color: 0x000000, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
        transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.3
      })
    };

    /* Handle + head shell (photos projected onto it) */
    const bevel = 0.42;
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(THREE), {
      depth: HALF_DEPTH * 2 - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 10,
      curveSegments: 80
    });
    bodyGeo.translate(0, 0, -(HALF_DEPTH - bevel));
    // Neck: on the real device the handle tucks in under the head (in side view the band's
    // bottom is barely covered and the neck is slimmer than the handle, ~0.65 of the head).
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const n = smooth(2.6, 3.6, y) * (1 - smooth(4.4, 5.0, y));
      if (n <= 0) continue;
      bp.setX(i, bp.getX(i) * (1 - 0.15 * n));
    }
    smoothNormals(THREE, bodyGeo);
    root.add(new THREE.Mesh(bodyGeo, M.body));

    // Side buttons: real positions from the side photos; their faces carry the photo too
    // [side, z, y, radius] measured on the registered side photos (IMG_8006 / IMG_8007)
    [[1, 0.04, 2.74, 0.62], [1, 0.04, 1.45, 0.62], [-1, -0.17, 2.12, 0.66]].forEach(([side, z, y, r]) => {
      const g = new THREE.CylinderGeometry(r - 0.03, r, 0.08, 48);
      g.rotateZ(Math.PI / 2);
      g.translate(side * (halfWidth(y) + 0.02), y, z);
      root.add(new THREE.Mesh(g, M.body));
    });

    const face = new THREE.Group();
    face.position.z = HALF_DEPTH;
    root.add(face);

    /* Head: black knurled band wrapping the rim. Its rounded shoulders tuck under the body's
       rounded front edge (so no extra circle / flat ring), thin chrome line at the joint. */
    const head = new THREE.Group();
    head.position.set(0, HEAD_Y, 0);
    root.add(head);
    const bandEdge = 0.08;
    const bandW = z => Math.min(1, Math.max(0, (Math.min(z - BAND_BACK, BAND_FRONT - z) - 0.07) / 0.12));
    head.add(new THREE.Mesh(
      knurledLathe(THREE, bandProfile(BAND_R, BAND_BACK, BAND_FRONT, bandEdge), 68, 0.085, 'round', bandW), M.band));
    const seamLine = new THREE.Mesh(new THREE.TorusGeometry(bandRadius(BAND_FRONT - 0.06) - 0.035, 0.009, 6, 220),
      new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.35, metalness: 1, envMapIntensity: 0.5 }));
    seamLine.position.z = BAND_FRONT - 0.05;
    head.add(seamLine);

    // Front shell (proud of the handle, as on the device) carrying the official front photo
    const capGeo = knurledLathe(THREE, frontCapProfile(), 32, 0, 'round', () => 0);
    capGeo.translate(0, HEAD_Y, 0);
    root.add(new THREE.Mesh(capGeo, M.body));

    /* Front lens: thin coated-glass cap over the photographed lens for live reflections */
    const front = new THREE.Group();
    root.add(front);
    const capR = 1.45;                 // lens circle fitted on the official front photo
    const sphR = 4.4;
    const theta = Math.asin(capR / sphR);
    const domeGeo = new THREE.SphereGeometry(sphR, 96, 12, 0, Math.PI * 2, 0, theta);
    domeGeo.rotateX(Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, M.lensGlass);
    dome.position.set(0, HEAD_Y + 0.449, FRONT_Z + 0.004 - sphR * Math.cos(theta));
    front.add(dome);

    /* Back: finely knurled silver polarization dial -> contact plate */
    const back = new THREE.Group();
    back.position.set(0, HEAD_Y, 0);
    root.add(back);

    const dialGroup = new THREE.Group();
    back.add(dialGroup);
    // fine milled teeth along the drum next to the band; smooth satin corner and back
    const dialW = z => smooth(-1.32, -1.12, z) * (1 - smooth(BAND_BACK - 0.1, BAND_BACK - 0.04, z));
    dialGroup.add(new THREE.Mesh(knurledLathe(THREE, dialProfile(), 120, 0.03, 'teeth', dialW), M.silverKnurl));
    // engraved index mark on the satin face (small arrow, as on the device)
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.2), new THREE.MeshBasicMaterial({ color: 0x2a2b2e }));
    mark.position.set(0, -2.258, -1.986);   // on the dial curve at r 2.25, lifted along its normal
    mark.rotation.y = Math.PI;
    mark.rotation.x = -0.835;                // curve normal (0, -0.74, -0.67)
    dialGroup.add(mark);

    const plate = new THREE.Group();
    back.add(plate);
    const plateFace = new THREE.Mesh(new THREE.CircleGeometry(PLATE_R + 0.01, 128), M.plate);
    plateFace.rotation.y = Math.PI;
    plateFace.position.z = PLATE_Z;
    plate.add(plateFace);

    // LED glows sit over the photographed LEDs and tint for UV / PigmentBoost chapters
    const glowMat = new THREE.SpriteMaterial({
      map: tex.glow, color: 0xffffff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    // Real LED layout in the plate photo: 4 groups of 3 at 30/45/60 deg (+90 deg), r ~ 1.55
    const LED_R = 1.6;                // LED ring inside the black carrier ring (real back view)
    for (let i = 0; i < 12; i++) {
      const a = ((30 + (i % 3) * 15 + Math.floor(i / 3) * 90) * Math.PI) / 180;
      const g = new THREE.Sprite(glowMat);
      g.scale.set(0.58, 0.58, 1);
      g.position.set(Math.cos(a) * LED_R, Math.sin(a) * LED_R, PLATE_Z - 0.06);
      plate.add(g);
    }
    const bigGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.glow, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    bigGlow.scale.set(8.5, 8.5, 1);
    bigGlow.position.z = PLATE_Z - 0.55;
    plate.add(bigGlow);

    const glassGroup = new THREE.Group();
    back.add(glassGroup);
    const plateGlass = new THREE.Mesh(new THREE.CircleGeometry(PLATE_R - 0.03, 96), M.plateGlass);
    plateGlass.rotation.y = Math.PI;
    plateGlass.position.z = PLATE_Z - 0.02;
    glassGroup.add(plateGlass);

    /* Hotspot anchors (world positions are projected to screen by the app) */
    const anchor = (parent, x, y, z, id) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.userData.id = id;
      parent.add(o);
      return o;
    };
    const anchors = [
      anchor(front, 0, HEAD_Y + 1.1, FRONT_Z + 0.12, 'lens'),
      anchor(face, 0.35, 2.95, 0.02, 'control'),
      anchor(back, SILVER_R, 0.6, -1.0, 'dial'),
      anchor(plate, -1.1, -1.1, PLATE_Z, 'plate'),
      anchor(root, 0, -6.5, HALF_DEPTH, 'battery')
    ];

    /* State application */
    const cWhite = new THREE.Color(1, 0.96, 0.9);
    const cUV = new THREE.Color(0.48, 0.28, 1);
    const cCool = new THREE.Color(0.78, 0.86, 1);
    const cWarm = new THREE.Color(1, 0.55, 0.2);
    const tmp = new THREE.Color();
    const tmp2 = new THREE.Color();

    function apply(S, time) {
      const e = S.explode || 0;
      front.position.z = e * 1.5;
      dialGroup.position.z = -e * 1.3;
      plate.position.z = -e * 2.6;
      glassGroup.position.z = -e * 3.4;
      face.position.z = HALF_DEPTH + e * 0.3;
      dialGroup.rotation.z = S.dial || 0;

      tmp.copy(cWhite).lerp(cUV, S.uv || 0);
      tmp2.copy(cCool).lerp(cWarm, S.level || 0);
      tmp.lerp(tmp2, S.pb || 0);

      const power = S.power == null ? 0.4 : S.power;
      const pulse = 0.94 + Math.sin(time * 2.4) * 0.06;
      glowMat.color.copy(tmp);
      glowMat.opacity = smooth(0.42, 0.95, power) * 0.8 * pulse;
      bigGlow.material.color.copy(tmp);
      bigGlow.material.opacity = Math.max(0, power - 0.45) * 0.45 * pulse;

      // Tint the photographed plate toward the active illumination colour
      const tint = Math.max(S.uv || 0, S.pb || 0);
      M.plate.emissive.setRGB(1, 1, 1).lerp(tmp, tint * 0.8);
      M.plate.emissiveIntensity = 0.18 + tint * 0.35;
      M.plate.color.setScalar(0.43).lerp(tmp2.copy(tmp).multiplyScalar(0.35), tint * 0.75);
    }

    return {
      root,
      anchors,
      apply,
      ledColor: tmp,
      dispose() {
        root.traverse(o => {
          if (o.geometry) o.geometry.dispose();
        });
        Object.values(M).forEach(m => m.dispose());
        Object.values(tex).forEach(t => t.dispose());
      }
    };
  }

  return { build, HEAD_Y };
})();

window.DL5Model = DL5Model;
