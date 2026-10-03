/**
 * DermLite DL5 Plus - Interactive Clinical Optical & Polarization Simulator
 */

const Simulator = (() => {
  const MODES = {
    xp: {
      id: 'xp',
      name: 'Cross-Polarized (XP)',
      image: 'assets/images/1f45_DL5_XP.png',
      filter: 'none',
      isUV: false,
      title: 'Deep Penetrating Cross-Polarization',
      desc: 'Eliminates surface glare. Reveals dermal melanin, subtle pigment networks, and deep vascular blush essential for melanocytic lesion evaluation.'
    },
    np: {
      id: 'np',
      name: 'Non-Polarized (NP)',
      image: 'assets/images/5e60_DL5_NP.png',
      filter: 'brightness(1.05) contrast(1.02)',
      isUV: false,
      title: 'Contact Non-Polarized Illumination',
      desc: 'Accentuates stratum corneum, epidermal surface reflection, milia-like cysts, and comedo-like openings in seborrheic keratoses.'
    },
    pp: {
      id: 'pp',
      name: 'Parallel-Polarized (PP)',
      image: 'assets/images/976b_DL5_PP.png',
      filter: 'brightness(1.02) contrast(1.08)',
      isUV: false,
      title: 'Superficial Parallel Polarization',
      desc: 'Scroll continuously to extremely superficial parallel polarization to visualize fine surface texture and optical depth transitions.'
    },
    uv: {
      id: 'uv',
      name: '365 nm UV Mode (2x DL5)',
      image: 'assets/images/1f45_DL5_XP.png',
      filter: 'hue-rotate(240deg) saturate(2.4) contrast(1.4) brightness(0.9)',
      isUV: true,
      title: 'Ultraviolet-Induced Fluorescence (UVFD)',
      desc: 'Now twice as bright as DL5. Reveals luminescent fluorescence in porokeratosis, fungal infections, Trichobacteriosis, and basal cell carcinoma globules.'
    },
    torch: {
      id: 'torch',
      name: 'Torch Mode (Distant)',
      image: 'assets/images/w1200_93eb_DL5_torchOn.jpg',
      filter: 'brightness(1.2) contrast(1.15)',
      isUV: false,
      title: 'Ultrabright Torch LED',
      desc: 'Distant clinical inspection beam for surveying wide skin areas, finding lesions quickly before close-up dermoscopic examination.'
    }
  };

  const DEFAULT_MODE = 'uv';
  let activeMode = DEFAULT_MODE;
  let pigmentLevel = 5;

  // DOM Elements
  let lensBezel, clinicalImg, infoTitle, infoDesc, infoCard, pigmentSlider, pigmentValueLabel, modeBtns;

  function init() {
    lensBezel = document.getElementById('simLensBezel');
    clinicalImg = document.getElementById('simClinicalImg');
    infoTitle = document.getElementById('simInfoTitle');
    infoDesc = document.getElementById('simInfoDesc');
    infoCard = document.getElementById('simInfoCard');
    pigmentSlider = document.getElementById('pigmentSlider');
    pigmentValueLabel = document.getElementById('pigmentValueLabel');
    modeBtns = document.querySelectorAll('.sim-mode-btn');

    if (!clinicalImg) return;

    // Mode button clicks
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        setMode(mode);
      });
    });

    // PigmentBoost Slider change
    if (pigmentSlider) {
      pigmentSlider.addEventListener('input', (e) => {
        pigmentLevel = parseInt(e.target.value, 10);
        if (pigmentValueLabel) {
          pigmentValueLabel.textContent = `Level ${pigmentLevel} of 9`;
        }
        applyPigmentBoost();
      });
    }

    setMode(DEFAULT_MODE);
  }

  function setMode(modeKey) {
    if (!MODES[modeKey]) return;
    activeMode = modeKey;
    const mode = MODES[modeKey];

    // Update active button
    modeBtns.forEach(btn => {
      if (btn.getAttribute('data-mode') === modeKey) {
        btn.classList.add('active');
        if (mode.isUV) btn.classList.add('uv-mode');
      } else {
        btn.classList.remove('active', 'uv-mode');
      }
    });

    // Update bezel glow
    if (lensBezel) {
      if (mode.isUV) {
        lensBezel.classList.add('uv-active');
      } else {
        lensBezel.classList.remove('uv-active');
      }
    }

    // Update image
    if (clinicalImg) {
      clinicalImg.style.opacity = '0.3';
      clinicalImg.style.transform = 'scale(0.98)';
      setTimeout(() => {
        clinicalImg.src = mode.image;
        clinicalImg.style.filter = mode.filter;
        clinicalImg.style.opacity = '1';
        clinicalImg.style.transform = 'scale(1)';
        applyPigmentBoost();
      }, 150);
    }

    // Update info text
    if (infoTitle) infoTitle.textContent = mode.title;
    if (infoDesc) infoDesc.textContent = mode.desc;
    if (infoCard) {
      if (mode.isUV) {
        infoCard.classList.add('uv-accent');
      } else {
        infoCard.classList.remove('uv-accent');
      }
    }
  }

  function applyPigmentBoost() {
    if (!clinicalImg || activeMode === 'uv' || activeMode === 'torch') return;

    // Level 1: Cooler/bluer (temperature 4000K), Level 9: Warm amber (temperature 7000K)
    const hueShift = (pigmentLevel - 5) * 5; // -20deg to +20deg
    const contrastVal = 1 + (pigmentLevel * 0.03); // 1.03 to 1.27
    const sepiaVal = Math.max(0, (pigmentLevel - 4) * 0.06);

    clinicalImg.style.filter = `hue-rotate(${hueShift}deg) contrast(${contrastVal}) sepia(${sepiaVal})`;
  }

  return {
    init,
    setMode
  };
})();

window.Simulator = Simulator;
