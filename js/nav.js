/**
 * DermLite DL5 Plus - Navigation & Floating Sticky Consultation Bar
 */

const Nav = (() => {
  function init() {
    // Ensure no residual scroll lock
    document.body.classList.remove('no-scroll');

    const header = document.querySelector('.main-header');
    const stickyBuyBar = document.getElementById('stickyBuyBar');
    const heroSection = document.getElementById('hero');
    const contactSection = document.getElementById('contact');

    // Scroll listener for sticky header & consultation bar
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;

      if (header) {
        if (scrollY > 20) {
          header.classList.add('is-scrolled');
        } else {
          header.classList.remove('is-scrolled');
        }
      }

      // The contact section has its own form: the floating bar and WhatsApp button step
      // aside while it is on screen (the bar stays hidden over the footer below it too)
      let reachedContact = false;
      if (contactSection) {
        const r = contactSection.getBoundingClientRect();
        reachedContact = r.top < window.innerHeight * 0.85;
        document.body.classList.toggle('at-contact', reachedContact && r.bottom > window.innerHeight * 0.25);
      }

      if (stickyBuyBar) {
        const pastHero = heroSection ? heroSection.getBoundingClientRect().bottom < 60 : scrollY > 500;
        stickyBuyBar.classList.toggle('is-visible', pastHero && !reachedContact);

        // Lift the floating WhatsApp button above the sticky bar while it is shown
        const barOffset = stickyBuyBar.classList.contains('is-visible') ? stickyBuyBar.offsetHeight : 0;
        document.documentElement.style.setProperty('--sticky-bar-offset', `${barOffset}px`);
      }
    });

    // Mobile Hamburger Toggle
    const mobileToggle = document.getElementById('mobileToggle');
    const mobileDrawer = document.getElementById('mobileDrawer');
    const mobileOverlay = document.getElementById('mobileOverlay');
    const closeMobileDrawer = document.getElementById('closeMobileDrawer');

    if (mobileToggle && mobileDrawer && mobileOverlay) {
      const toggleDrawer = () => {
        mobileToggle.classList.toggle('is-active');
        mobileDrawer.classList.toggle('is-open');
        mobileOverlay.classList.toggle('is-open');
        document.body.classList.toggle('no-scroll');
      };

      mobileToggle.addEventListener('click', toggleDrawer);
      if (closeMobileDrawer) closeMobileDrawer.addEventListener('click', toggleDrawer);
      mobileOverlay.addEventListener('click', toggleDrawer);
    }

    // Mobile Accordion Submenus
    document.querySelectorAll('.mobile-nav-item.has-sub').forEach(item => {
      const link = item.querySelector('.mobile-nav-link');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          item.classList.toggle('is-expanded');
        });
      }
    });
  }

  return { init };
})();

window.Nav = Nav;
