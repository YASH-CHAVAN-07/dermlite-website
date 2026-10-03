/**
 * DermLite DL5 Plus - Multi-Angle Gallery & Lightbox
 */

const Gallery = (() => {
  const IMAGES = [
    {
      full: 'assets/images/DL5P_FrontRight_3.png',
      alt: 'DermLite DL5 Plus Front Right View'
    },
    {
      full: 'assets/images/DL5P_MCCiPhone13ProScreenApp.webp',
      alt: 'DermLite DL5 Plus with iPhone 13 Pro and DermLite App'
    },
    {
      full: 'assets/images/DL5P_TopAngle_4.png',
      alt: 'DermLite DL5 Plus Top Angle with Magnetic Ruler'
    },
    {
      full: 'assets/images/DL5P_1sm.webp',
      alt: 'DermLite DL5 Plus Front Profile'
    },
    {
      full: 'assets/images/DL5P_2.jpg',
      alt: 'DermLite DL5 Plus Lens Bezel Detail'
    },
    {
      full: 'assets/images/DL5P-CB_1_2e7dafce-dd4e-4bca-a68d-e6b6d266320e.jpg',
      alt: 'DermLite DL5 Plus in Charging Base'
    },
    {
      full: 'assets/images/DL5P_4.jpg',
      alt: 'DermLite DL5 Plus Side Profile & Controls'
    },
    {
      full: 'assets/images/DL5P-CB_4_89b660f0-4fda-4cbb-9410-90e4f7e55f86.jpg',
      alt: 'DermLite DL5 Plus in Desktop Stand'
    }
  ];

  let currentIndex = 0;

  let mainImg, thumbs, lightbox, lightboxImg;

  function init() {
    mainImg = document.getElementById('galleryMainImg');
    thumbs = document.querySelectorAll('.thumb-item');
    lightbox = document.getElementById('lightboxModal');
    lightboxImg = document.getElementById('lightboxImg');

    if (!mainImg) return;

    thumbs.forEach((thumb, index) => {
      thumb.addEventListener('click', () => {
        selectImage(index);
      });
    });

    const viewport = document.getElementById('galleryViewport');
    if (viewport) {
      viewport.addEventListener('click', () => {
        openLightbox(currentIndex);
      });
    }

    const closeBtn = document.getElementById('closeLightbox');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    if (lightbox) {
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.classList.contains('lightbox-content')) {
          closeLightbox();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (lightbox && lightbox.classList.contains('is-open')) {
        if (e.key === 'ArrowRight') nextImage();
        if (e.key === 'ArrowLeft') prevImage();
      }
    });
  }

  function selectImage(index) {
    if (index < 0 || index >= IMAGES.length) return;
    currentIndex = index;

    thumbs.forEach((thumb, i) => {
      if (i === index) {
        thumb.classList.add('active');
      } else {
        thumb.classList.remove('active');
      }
    });

    if (mainImg) {
      mainImg.style.opacity = '0.3';
      setTimeout(() => {
        mainImg.src = IMAGES[index].full;
        mainImg.alt = IMAGES[index].alt;
        mainImg.style.opacity = '1';
      }, 150);
    }
  }

  function openLightbox(index) {
    if (!lightbox || !lightboxImg) return;
    currentIndex = index;
    lightboxImg.src = IMAGES[index].full;
    lightbox.classList.add('is-open');
    document.body.classList.add('no-scroll');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  }

  function nextImage() {
    const next = (currentIndex + 1) % IMAGES.length;
    selectImage(next);
    if (lightboxImg) lightboxImg.src = IMAGES[next].full;
  }

  function prevImage() {
    const prev = (currentIndex - 1 + IMAGES.length) % IMAGES.length;
    selectImage(prev);
    if (lightboxImg) lightboxImg.src = IMAGES[prev].full;
  }

  return {
    init,
    selectImage,
    openLightbox,
    closeLightbox
  };
})();

window.Gallery = Gallery;
