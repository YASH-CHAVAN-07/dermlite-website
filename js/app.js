/**
 * DermLite DL5 Plus - Main Application Coordinator
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize submodules
  if (window.LeadForm) LeadForm.init();
  if (window.Simulator) Simulator.init();
  if (window.Gallery) Gallery.init();
  if (window.Nav) Nav.init();

  // Hero Video Custom Controls
  const heroVideo = document.getElementById('heroVideo');
  const btnTogglePlay = document.getElementById('btnTogglePlay');
  const btnToggleMute = document.getElementById('btnToggleMute');

  if (heroVideo && btnTogglePlay) {
    btnTogglePlay.addEventListener('click', () => {
      if (heroVideo.paused) {
        heroVideo.play();
        btnTogglePlay.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        `;
      } else {
        heroVideo.pause();
        btnTogglePlay.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        `;
      }
    });
  }

  if (heroVideo && btnToggleMute) {
    btnToggleMute.addEventListener('click', () => {
      heroVideo.muted = !heroVideo.muted;
      if (heroVideo.muted) {
        btnToggleMute.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        `;
      } else {
        btnToggleMute.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        `;
      }
    });
  }

  // Newsletter Submission
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('newsletterEmail');
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailInput || !emailRegex.test(emailInput.value.trim())) {
        if (window.LeadForm) LeadForm.showToast('Please enter a valid email address (e.g., doctor@gmail.com).');
        return;
      }
      if (window.LeadForm) {
        LeadForm.showToast('Thank you for joining the DermLite clinical mailing list!');
      }
      emailInput.value = '';
    });
  }

  // Interactive PDF Trigger
  document.querySelectorAll('[data-action="download-pdf"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.LeadForm) {
        LeadForm.openModal('brochure', 'DermLite DL5 Plus');
      }
    });
  });

  // Comparison CTA
  document.querySelectorAll('[data-action="compare-table"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById('specs');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        if (window.LeadForm) {
          LeadForm.showToast('Navigating to DL5 Plus Technical Comparison & Specifications.');
        }
      }
    });
  });
});
