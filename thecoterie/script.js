document.addEventListener('DOMContentLoaded', function() {
    // --- Mobile Viewport Height Fix ---
    const setVhVariable = () => {
        let vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    window.addEventListener('resize', setVhVariable);
    setVhVariable();

    // --- Dynamic Proximity Connections Background ---
    class GlowingConstellation {
        constructor(canvasId) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) return;
            this.ctx = this.canvas.getContext('2d');
            this.settings = {
                starCount: window.innerWidth > 768 ? 60 : 30,
                connectionDistance: 130,
                kleinBlue: 'rgba(0, 47, 167, 0.9)',
                velocity: 0.4
            };
            this.stars = [];
            window.addEventListener('resize', () => this.resize());
            this.init();
        }
        init() { this.resize(); this.animate(); }
        resize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.createStars();
        }
        createStars() {
            this.stars = [];
            for (let i = 0; i < this.settings.starCount; i++) {
                this.stars.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    vx: (Math.random() - 0.5) * this.settings.velocity,
                    vy: (Math.random() - 0.5) * this.settings.velocity,
                    radius: Math.random() * 1.5 + 0.5
                });
            }
        }
        animate() {
            this.ctx.clearRect(0, 0, this.width, this.height);
            this.stars.forEach(star => {
                star.x += star.vx;
                star.y += star.vy;
                if (star.x < -star.radius) star.x = this.width + star.radius;
                if (star.x > this.width + star.radius) star.x = -star.radius;
                if (star.y < -star.radius) star.y = this.height + star.radius;
                if (star.y > this.height + star.radius) star.y = -star.radius;
            });
            for (let i = 0; i < this.stars.length; i++) {
                for (let j = i + 1; j < this.stars.length; j++) {
                    const dist = Math.hypot(this.stars[i].x - this.stars[j].x, this.stars[i].y - this.stars[j].y);
                    if (dist < this.settings.connectionDistance) {
                        const opacity = 1 - (dist / this.settings.connectionDistance);
                        this.ctx.beginPath();
                        this.ctx.moveTo(this.stars[i].x, this.stars[i].y);
                        this.ctx.lineTo(this.stars[j].x, this.stars[j].y);
                        this.ctx.strokeStyle = `rgba(220, 230, 255, ${opacity * 0.5})`;
                        this.ctx.lineWidth = 1;
                        this.ctx.shadowColor = this.settings.kleinBlue;
                        this.ctx.shadowBlur = opacity * 20;
                        this.ctx.stroke();
                    }
                }
            }
            this.ctx.shadowBlur = 0;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            this.stars.forEach(star => {
                this.ctx.beginPath();
                this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
                this.ctx.fill();
            });
            requestAnimationFrame(() => this.animate());
        }
    }

    const SERVER_URL = 'https://nomination-server.onrender.com';

    // --- Pre-warm the server on page load ---
    fetch(`${SERVER_URL}/wake-up`)
        .then(res => res.json())
        .then(data => console.log(data.message))
        .catch(err => console.error('Server wake-up call failed:', err));

    // Background Animation
    if (document.getElementById('gradient-canvas')) {
        new GlowingConstellation('gradient-canvas');
    }

    // Animate on Scroll
    const observerOptions = { threshold: 0.2, rootMargin: '0px 0px -50px 0px' };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                if (entry.target.classList.contains('stagger-children')) {
                    const children = entry.target.querySelectorAll('.animate-on-scroll');
                    children.forEach((child, index) => {
                        child.style.setProperty('--stagger-index', index);
                    });
                }
            }
        });
    }, observerOptions);
    document.querySelectorAll('.animate-on-scroll, .stagger-children').forEach(el => observer.observe(el));

    // Side Navigation
    const navDots = document.querySelectorAll('.nav-dot');
    const sections = document.querySelectorAll('.section');
    const headerHeight = 80;
    navDots.forEach(dot => {
        dot.addEventListener('click', function(e) {
            // ✅ IMPROVEMENT: Prevent default anchor behavior
            e.preventDefault();
            const targetId = this.getAttribute('data-target');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                const targetPosition = targetSection.offsetTop - headerHeight + 5;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
            }
        });
    });
    const navObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const currentId = entry.target.getAttribute('id');
                navDots.forEach(dot => {
                    dot.classList.toggle('active', dot.getAttribute('data-target') === currentId);
                });
            }
        });
    }, { threshold: 0.3, rootMargin: `-${headerHeight}px 0px -40% 0px` });
    sections.forEach(section => navObserver.observe(section));
    
    // Card Flip
    document.querySelectorAll('.community-card').forEach(card => {
        card.addEventListener('click', () => { card.classList.toggle('flipped'); });
    });

    // Modal Logic
    const modalOverlay = document.getElementById('nomination-modal');
    const modalContainer = document.querySelector('.modal-container');
    const openModalBtns = document.querySelectorAll('.open-modal-btn');
    const closeModalBtn = document.querySelector('.close-modal');
    let lastFocusedElement; // For accessibility

    // ✅ IMPROVEMENT: Focus trap logic for modal accessibility
    const focusableElementsSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let focusableElements;
    
    const handleFocusTrap = (e) => {
        if (e.key !== 'Tab') return;

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) { // Shift + Tab
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else { // Tab
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    };
    
    const openModal = (e) => {
        lastFocusedElement = document.activeElement; // Save the element that opened the modal
        modalOverlay.classList.add('active');
        document.addEventListener('keydown', handleFocusTrap);
        
        // Find focusable elements and focus the close button
        focusableElements = modalContainer.querySelectorAll(focusableElementsSelector);
        closeModalBtn.focus();
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        document.removeEventListener('keydown', handleFocusTrap);
        if (lastFocusedElement) {
            lastFocusedElement.focus(); // Return focus to the original element
        }
    };
    
    openModalBtns.forEach(btn => btn.addEventListener('click', openModal));
    closeModalBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Form Submission
    const form = document.getElementById('membership-form');
    if(form) {
        // ... (The rest of your form logic remains the same)
        const nominationRadios = form.querySelectorAll('input[name="nominationType"]');
        const nominatorDetails = form.querySelector('#nominator-details');
        const nominatorFields = nominatorDetails.querySelectorAll('input');
        nominationRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'peer') {
                    nominatorDetails.style.display = 'block';
                    nominatorFields.forEach(field => field.required = true);
                } else {
                    nominatorDetails.style.display = 'none';
                    nominatorFields.forEach(field => field.required = false);
                }
            });
        });
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitButton = this.querySelector('.btn');
            const formMessage = this.querySelector('#form-message');
            formMessage.style.display = 'none';
            let isValid = true;
            this.querySelectorAll('[required]').forEach(input => {
                if (!input.value.trim()) {
                    isValid = false;
                    input.style.borderColor = '#dc3545';
                } else {
                    input.style.borderColor = 'var(--border-color)';
                }
            });
            
            if (!isValid) {
                formMessage.textContent = 'Please fill in all required fields.';
                formMessage.className = 'error';
                formMessage.style.display = 'block';
                return;
            }

            submitButton.textContent = 'Submitting...';
            submitButton.disabled = true;

            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(`${SERVER_URL}/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    throw new Error('Network response was not ok.');
                }
                
                const result = await response.json();
                
                formMessage.innerHTML = 'Thank you for your nomination. We are excited about the possibility of welcoming this leader to the circle. Our team will review the submission and be in touch within two weeks with the next steps.';
                formMessage.className = 'success';
                this.reset();
                nominatorDetails.style.display = 'none';
                nominatorFields.forEach(field => field.required = false);

            } catch (error) {
                console.error('Submission error:', error);
                formMessage.textContent = 'An error occurred. Please try again later.';
                formMessage.className = 'error';
            } finally {
                formMessage.style.display = 'block';
                submitButton.textContent = 'Submit Nomination';
                submitButton.disabled = false;
            }
        });
    }
});
