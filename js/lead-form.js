/**
 * DermLite DL5 Plus - B2B Medical Lead Capture & Brochure Download System
 */

const LeadForm = (() => {
  // Configuration: update with your target email or configure via UI / localStorage
  const CONFIG = {
    // Default email address for inquiries and brochure leads
    TARGET_EMAIL: 'myempire0307@gmail.com',
    // Official DermLite DL5 Plus Brochure PDF from assets
    BROCHURE_PDF_URL: 'assets/Dermlite%20DL5%20Plus%20-%20Aakaar.pdf',
    BROCHURE_FILENAME: 'Dermlite DL5 Plus - Aakaar.pdf'
  };

  // DOM Elements
  let leadModal, modalOverlay, modalForm, modalSuccess, leadTitle, leadSubtitle;
  let onPageForm, onPageSuccess;

  function getRecipientEmail() {
    return localStorage.getItem('dermlite_recipient_email') || CONFIG.TARGET_EMAIL;
  }

  function updateRecipientDisplay() {
    const el = document.getElementById('footerRecipientEmail');
    if (el) {
      el.textContent = getRecipientEmail();
    }
  }

  function configureRecipientEmail() {
    const current = getRecipientEmail();
    const newEmail = prompt('Enter your email address where all inquiry and download leads should be sent:', current);
    if (newEmail && newEmail.trim().includes('@')) {
      localStorage.setItem('dermlite_recipient_email', newEmail.trim());
      updateRecipientDisplay();
      showToast(`Lead recipient email updated to: ${newEmail.trim()}`);
    }
  }

  function init() {
    leadModal = document.getElementById('leadModal');
    modalOverlay = document.getElementById('leadModalOverlay');
    modalForm = document.getElementById('modalLeadForm');
    modalSuccess = document.getElementById('modalLeadSuccess');
    leadTitle = document.getElementById('leadModalTitle');
    leadSubtitle = document.getElementById('leadModalSubtitle');

    onPageForm = document.getElementById('onPageLeadForm');
    onPageSuccess = document.getElementById('onPageLeadSuccess');

    // Update display of recipient email
    updateRecipientDisplay();

    // Close modal triggers
    const closeBtn = document.getElementById('closeLeadModal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

    // Global CTA triggers
    document.querySelectorAll('[data-action="open-brochure"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const accessory = btn.getAttribute('data-product-title') || 'DermLite DL5 Plus';
        openModal('brochure', accessory);
      });
    });

    document.querySelectorAll('[data-action="open-contact"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const accessory = btn.getAttribute('data-product-title') || 'DermLite DL5 Plus';
        openModal('contact', accessory);
      });
    });

    // Bind modal form submit
    if (modalForm) {
      modalForm.addEventListener('submit', (e) => handleFormSubmit(e, 'modal'));
    }

    // Bind on-page form submit
    if (onPageForm) {
      onPageForm.addEventListener('submit', (e) => handleFormSubmit(e, 'onpage'));
    }

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      // Admin shortcut to view leads: Ctrl + Shift + L
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        showLeadsAdmin();
      }
    });

    // Wire up live validation handlers for on-page form
    setupPhoneField(document.getElementById('onPageLeadMobile'), document.getElementById('onPageLeadMobileHint'));
    setupEmailField(document.getElementById('onPageLeadEmail'), document.getElementById('onPageLeadEmailHint'));
    setupTextField(document.getElementById('onPageLeadName'), document.getElementById('onPageLeadNameHint'), 'Full Name');
    setupTextField(document.getElementById('onPageLeadCity'), document.getElementById('onPageLeadCityHint'), 'City / Region');

    // Wire up live validation handlers for modal form
    setupPhoneField(document.getElementById('modalLeadMobile'), document.getElementById('modalLeadMobileHint'));
    setupEmailField(document.getElementById('modalLeadEmail'), document.getElementById('modalLeadEmailHint'));
    setupTextField(document.getElementById('modalLeadName'), document.getElementById('modalLeadNameHint'), 'Full Name');
    setupTextField(document.getElementById('modalLeadCity'), document.getElementById('modalLeadCityHint'), 'City / Region');
  }

  // Standard email regex (accepts doctor@gmail.com, doctor@hospital.com, etc.)
  const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  function setFieldState(input, hintEl, state, message = '') {
    if (!input) return;
    const group = input.closest('.phone-input-group');

    input.classList.remove('is-invalid', 'is-valid');
    if (group) group.classList.remove('is-invalid', 'is-valid');

    if (hintEl) {
      hintEl.className = 'form-field-hint';
      hintEl.textContent = '';
    }

    if (state === 'invalid') {
      input.classList.add('is-invalid');
      if (group) group.classList.add('is-invalid');
      if (hintEl) {
        hintEl.classList.add('error');
        hintEl.textContent = message;
      }
    } else if (state === 'valid') {
      input.classList.add('is-valid');
      if (group) group.classList.add('is-valid');
      if (hintEl) {
        hintEl.classList.add('success');
        hintEl.textContent = message;
      }
    } else if (state === 'info') {
      if (hintEl) {
        hintEl.classList.add('info');
        hintEl.textContent = message;
      }
    }
  }

  function resetFormValidation(formElement) {
    if (!formElement) return;
    formElement.querySelectorAll('.form-input').forEach(input => {
      input.classList.remove('is-invalid', 'is-valid');
    });
    formElement.querySelectorAll('.phone-input-group').forEach(group => {
      group.classList.remove('is-invalid', 'is-valid');
    });
    formElement.querySelectorAll('.form-field-hint').forEach(hint => {
      hint.className = 'form-field-hint';
      hint.textContent = '';
    });
  }

  function setupPhoneField(mobileInput, hintEl) {
    if (!mobileInput) return;
    let isTouched = false;

    // 1. Strictly allow only number keys, navigation, and editing shortcuts
    mobileInput.addEventListener('keydown', (e) => {
      const allowedNavigation = [
        'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End'
      ];
      if (allowedNavigation.includes(e.key)) return;

      // Allow Ctrl/Command shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z)
      if (e.ctrlKey || e.metaKey) return;

      // Block non-numeric characters
      if (!/^[0-9]$/.test(e.key)) {
        e.preventDefault();
      }
    });

    // 2. Clean input and give real-time feedback
    mobileInput.addEventListener('input', () => {
      let digits = mobileInput.value.replace(/\D/g, '');
      if (digits.length > 10) {
        digits = digits.slice(0, 10);
      }
      mobileInput.value = digits;

      if (!isTouched && digits.length === 0) {
        setFieldState(mobileInput, hintEl, 'neutral');
        return;
      }

      if (digits.length === 10) {
        setFieldState(mobileInput, hintEl, 'valid', '✓ Valid 10-digit mobile number');
      } else if (isTouched) {
        if (digits.length === 0) {
          setFieldState(mobileInput, hintEl, 'invalid', 'Mobile number is required (10 digits)');
        } else {
          setFieldState(mobileInput, hintEl, 'invalid', `Please enter 10 digits (${digits.length}/10 entered)`);
        }
      } else if (digits.length > 0) {
        setFieldState(mobileInput, hintEl, 'info', `${digits.length}/10 digits`);
      }
    });

    // 3. Validate on blur
    mobileInput.addEventListener('blur', () => {
      isTouched = true;
      const digits = mobileInput.value.replace(/\D/g, '');
      if (digits.length === 10) {
        setFieldState(mobileInput, hintEl, 'valid', '✓ Valid 10-digit mobile number');
      } else if (digits.length === 0) {
        setFieldState(mobileInput, hintEl, 'invalid', 'Mobile number is required (10 digits)');
      } else {
        setFieldState(mobileInput, hintEl, 'invalid', `Please enter a valid 10-digit mobile number (${digits.length}/10 entered)`);
      }
    });
  }

  function setupEmailField(emailInput, hintEl) {
    if (!emailInput) return;
    let isTouched = false;

    emailInput.addEventListener('input', () => {
      const val = emailInput.value.trim();

      if (!isTouched && val.length === 0) {
        setFieldState(emailInput, hintEl, 'neutral');
        return;
      }

      if (EMAIL_REGEX.test(val)) {
        setFieldState(emailInput, hintEl, 'valid', '✓ Valid email address');
      } else if (isTouched) {
        if (val.length === 0) {
          setFieldState(emailInput, hintEl, 'invalid', 'Email address is required');
        } else {
          setFieldState(emailInput, hintEl, 'invalid', 'Please enter a valid email address (e.g., doctor@gmail.com)');
        }
      }
    });

    emailInput.addEventListener('blur', () => {
      isTouched = true;
      emailInput.value = emailInput.value.trim();
      const val = emailInput.value;

      if (val.length === 0) {
        setFieldState(emailInput, hintEl, 'invalid', 'Email address is required');
      } else if (EMAIL_REGEX.test(val)) {
        setFieldState(emailInput, hintEl, 'valid', '✓ Valid email address');
      } else {
        setFieldState(emailInput, hintEl, 'invalid', 'Please enter a valid email address (e.g., doctor@gmail.com)');
      }
    });
  }

  function setupTextField(input, hintEl, label, minLength = 2) {
    if (!input) return;
    let isTouched = false;

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (!isTouched && val.length === 0) {
        setFieldState(input, hintEl, 'neutral');
        return;
      }
      if (val.length >= minLength) {
        setFieldState(input, hintEl, 'valid', `✓ Valid ${label.toLowerCase()}`);
      } else if (isTouched) {
        setFieldState(input, hintEl, 'invalid', `${label} is required (at least ${minLength} characters)`);
      }
    });

    input.addEventListener('blur', () => {
      isTouched = true;
      input.value = input.value.trim();
      const val = input.value;
      if (val.length >= minLength) {
        setFieldState(input, hintEl, 'valid', `✓ Valid ${label.toLowerCase()}`);
      } else {
        setFieldState(input, hintEl, 'invalid', `Please enter your ${label.toLowerCase()}`);
      }
    });
  }

  function openModal(mode = 'brochure', productContext = 'DermLite DL5 Plus') {
    if (!leadModal || !modalOverlay) return;

    // Reset view & validation
    if (modalForm) {
      modalForm.style.display = 'block';
      resetFormValidation(modalForm);
      const prodField = document.getElementById('modalProductContext');
      if (prodField) prodField.value = productContext;
    }
    if (modalSuccess) modalSuccess.style.display = 'none';

    if (mode === 'brochure') {
      if (leadTitle) leadTitle.textContent = 'Download Official Brochure';
      if (leadSubtitle) leadSubtitle.textContent = `Get the complete technical specifications, optical blueprints, and clinical guides for the ${productContext}.`;
    } else {
      if (leadTitle) leadTitle.textContent = 'Contact Us / Request Quote';
      if (leadSubtitle) leadSubtitle.textContent = `Connect with our medical device specialists for practice pricing, institution quotes, and clinical consultations.`;
    }

    leadModal.classList.add('is-open');
    modalOverlay.classList.add('is-open');
    document.body.classList.add('no-scroll');

    // Focus on first input
    const firstInput = document.getElementById('modalLeadName');
    if (firstInput) setTimeout(() => firstInput.focus(), 150);
  }

  function closeModal() {
    if (!leadModal || !modalOverlay) return;
    leadModal.classList.remove('is-open');
    modalOverlay.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  }

  function validateLeadData(data, prefix = 'onPageLead') {
    const errors = [];
    const nameInput = document.getElementById(`${prefix}Name`);
    const cityInput = document.getElementById(`${prefix}City`);
    const mobileInput = document.getElementById(`${prefix}Mobile`);
    const emailInput = document.getElementById(`${prefix}Email`);

    const nameHint = document.getElementById(`${prefix}NameHint`);
    const cityHint = document.getElementById(`${prefix}CityHint`);
    const mobileHint = document.getElementById(`${prefix}MobileHint`);
    const emailHint = document.getElementById(`${prefix}EmailHint`);

    let firstInvalidInput = null;

    // Name validation
    if (!data.name || data.name.trim().length < 2) {
      errors.push('Please enter your full name (at least 2 characters).');
      setFieldState(nameInput, nameHint, 'invalid', 'Please enter your full name');
      if (!firstInvalidInput) firstInvalidInput = nameInput;
    } else {
      setFieldState(nameInput, nameHint, 'valid', '✓ Valid name');
    }

    // City validation
    if (!data.city || data.city.trim().length < 2) {
      errors.push('Please enter your city or region.');
      setFieldState(cityInput, cityHint, 'invalid', 'Please enter your city or region');
      if (!firstInvalidInput) firstInvalidInput = cityInput;
    } else {
      setFieldState(cityInput, cityHint, 'valid', '✓ Valid city');
    }

    // Mobile validation: exactly 10 digits
    const cleanedMobile = (data.mobileRaw || '').replace(/\D/g, '');
    if (cleanedMobile.length !== 10) {
      errors.push('Please enter a valid 10-digit mobile number.');
      setFieldState(mobileInput, mobileHint, 'invalid', 'Please enter a valid 10-digit mobile number');
      if (!firstInvalidInput) firstInvalidInput = mobileInput;
    } else {
      setFieldState(mobileInput, mobileHint, 'valid', '✓ Valid 10-digit mobile number');
    }

    // Email validation: strict format check
    if (!data.email || !EMAIL_REGEX.test(data.email.trim())) {
      errors.push('Please enter a valid email address (e.g., doctor@gmail.com).');
      setFieldState(emailInput, emailHint, 'invalid', 'Please enter a valid email address (e.g., doctor@gmail.com)');
      if (!firstInvalidInput) firstInvalidInput = emailInput;
    } else {
      setFieldState(emailInput, emailHint, 'valid', '✓ Valid email address');
    }

    return { errors, firstInvalidInput };
  }

  async function handleFormSubmit(event, formType) {
    event.preventDefault();

    const prefix = formType === 'modal' ? 'modalLead' : 'onPageLead';
    const nameInput = document.getElementById(`${prefix}Name`);
    const cityInput = document.getElementById(`${prefix}City`);
    const mobileInput = document.getElementById(`${prefix}Mobile`);
    const emailInput = document.getElementById(`${prefix}Email`);
    const messageInput = document.getElementById(`${prefix}Message`);
    const submitBtn = document.getElementById(`${prefix}SubmitBtn`);

    const rawMobileDigits = mobileInput ? mobileInput.value.replace(/\D/g, '') : '';
    const fullMobileNumber = rawMobileDigits ? `+91 ${rawMobileDigits}` : '';

    const leadData = {
      name: nameInput ? nameInput.value.trim() : '',
      city: cityInput ? cityInput.value.trim() : '',
      mobile: fullMobileNumber,
      mobileRaw: rawMobileDigits,
      countryCode: '+91',
      email: emailInput ? emailInput.value.trim() : '',
      message: messageInput ? messageInput.value.trim() : '',
      product: formType === 'modal' && document.getElementById('modalProductContext')
        ? document.getElementById('modalProductContext').value
        : 'DermLite DL5 Plus',
      timestamp: new Date().toISOString(),
      formattedDate: new Date().toLocaleString()
    };

    // Validation
    const { errors, firstInvalidInput } = validateLeadData(leadData, prefix);
    if (errors.length > 0) {
      showToast(errors[0]);
      if (firstInvalidInput) firstInvalidInput.focus();
      return;
    }

    // Loading UI state
    const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Submit';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="10" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
        <span>Processing & Delivering Brochure...</span>
      `;
    }

    // 1. Save locally to localStorage (guarantees zero lead loss)
    saveLeadLocally(leadData);

    // 2. Send email notification via FormSubmit directly to destination inbox
    sendLeadEmail(leadData);

    // 3. Trigger immediate brochure PDF download
    triggerBrochureDownload();

    // 4. Update UI to success screen
    setTimeout(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }

      if (formType === 'modal') {
        if (modalForm) modalForm.style.display = 'none';
        if (modalSuccess) {
          modalSuccess.style.display = 'block';
          const nameSpan = document.getElementById('modalSuccessName');
          if (nameSpan) nameSpan.textContent = leadData.name;
        }
      } else {
        if (onPageForm) onPageForm.style.display = 'none';
        if (onPageSuccess) {
          onPageSuccess.style.display = 'block';
          const nameSpan = document.getElementById('onPageSuccessName');
          if (nameSpan) nameSpan.textContent = leadData.name;
        }
      }

      showToast(`Thank you, ${leadData.name}! Your brochure download has started.`);
    }, 700);
  }

  function saveLeadLocally(lead) {
    try {
      const stored = localStorage.getItem('dermlite_leads');
      const leads = stored ? JSON.parse(stored) : [];
      leads.unshift(lead);
      localStorage.setItem('dermlite_leads', JSON.stringify(leads));
      console.info('[LeadForm] New lead saved to storage:', lead);
    } catch (e) {
      console.warn('[LeadForm] Could not save lead to localStorage:', e);
    }
  }

  async function sendLeadEmail(lead) {
    const recipient = getRecipientEmail();
    try {
      // Send directly to configured email via FormSubmit AJAX endpoint
      await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          _subject: `[New DermLite DL5 Plus Lead] ${lead.name} from ${lead.city}`,
          _template: 'table',
          _captcha: 'false',
          'Full Name': lead.name,
          'City': lead.city,
          'Mobile Number': lead.mobile,
          'Email Address': lead.email,
          'Requirements / Note': lead.message || 'Requested DL5 Plus Brochure & Clinical Consultation',
          'Product Context': lead.product,
          'Submission Timestamp': lead.formattedDate
        })
      }).then(res => res.json()).then(data => {
        console.info('[LeadForm] Lead forwarded to recipient:', recipient, data);
      }).catch(err => {
        console.info('[LeadForm] Email submission note: lead is securely archived in localStorage.');
      });
    } catch (err) {
      console.info('[LeadForm] Dispatched lead payload to:', recipient);
    }
  }

  function triggerBrochureDownload() {
    const a = document.createElement('a');
    a.href = CONFIG.BROCHURE_PDF_URL;
    a.download = CONFIG.BROCHURE_FILENAME;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 200);
  }

  function getStoredLeads() {
    try {
      return JSON.parse(localStorage.getItem('dermlite_leads') || '[]');
    } catch (e) {
      return [];
    }
  }

  function exportLeadsCSV() {
    const leads = getStoredLeads();
    if (leads.length === 0) {
      showToast('No leads recorded yet.');
      return;
    }

    const headers = ['Timestamp', 'Full Name', 'City', 'Mobile Number', 'Email', 'Product', 'Message'];
    const rows = leads.map(l => [
      `"${l.formattedDate || l.timestamp}"`,
      `"${l.name}"`,
      `"${l.city}"`,
      `"${l.mobile}"`,
      `"${l.email}"`,
      `"${l.product}"`,
      `"${(l.message || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `DermLite_DL5_Plus_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Leads exported to CSV successfully.');
  }

  function showLeadsAdmin() {
    const leads = getStoredLeads();
    alert(`[DermLite Lead Log]\nTotal Captured Leads: ${leads.length}\n\nCheck browser console or click Export CSV in the footer to download.`);
    console.table(leads);
  }

  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  return {
    init,
    openModal,
    closeModal,
    triggerBrochureDownload,
    getStoredLeads,
    exportLeadsCSV,
    showLeadsAdmin,
    showToast,
    getRecipientEmail,
    configureRecipientEmail
  };
})();

window.LeadForm = LeadForm;
