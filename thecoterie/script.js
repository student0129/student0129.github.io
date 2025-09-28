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

    // !! IMPORTANT !!: Replace with your actual Render server URL
    const SERVER_URL = 'https://coterie-nomination-server.onrender.com'; // Example URL

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
    
    // =========================================================================
    // --- Touch Device Interactivity for Click-to-Flip Cards ---
    // =========================================================================
    const handleInteractiveTouch = (selector, activeClass) => {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) return;

        elements.forEach(element => {
            element.addEventListener('click', function(event) {
                event.stopPropagation(); 
                
                const isAlreadyActive = this.classList.contains(activeClass);

                elements.forEach(el => {
                    if (el !== this) {
                        el.classList.remove(activeClass);
                    }
                });
                
                if (!isAlreadyActive) {
                    this.classList.add(activeClass);
                } else {
                    this.classList.remove(activeClass);
                }
            });
        });

        document.addEventListener('click', function() {
            elements.forEach(el => el.classList.remove(activeClass));
        });
    };

    // Apply the logic ONLY to the flippable community cards
    handleInteractiveTouch('.community-card', 'is-flipped');

    // =================================================================
    // --- MODAL & FORM LOGIC ---
    // =================================================================
    const modalOverlay = document.getElementById('nomination-modal');
    const modalContent = document.querySelector('.modal-content');
    const modalTitle = document.getElementById('modal-title');
    const openModalBtns = document.querySelectorAll('.open-modal-btn');
    const closeModalBtn = document.querySelector('.close-modal');
    
    let lastFocusedElement; 
    const focusableElementsSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleFocusTrap = (e) => {
        if (e.key !== 'Tab') return;
        
        const activeStep = modalContent.querySelector('.form-step.active');
        if (!activeStep) return;

        const currentFocusable = Array.from(activeStep.querySelectorAll(focusableElementsSelector));
        if (currentFocusable.length === 0) return;

        const firstFocusable = currentFocusable[0];
        const lastFocusable = currentFocusable[currentFocusable.length - 1];

        if (e.shiftKey) { 
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else { 
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    };
    
    const openModal = () => {
        modalContent.querySelectorAll('.form-step').forEach(step => {
            step.classList.remove('active', 'slide-in', 'slide-out');
        });
        
        modalContent.querySelector('.form-step[data-step="1"]').classList.add('active');
        modalTitle.textContent = "Nominate a Leader";
        
        modalContent.querySelectorAll('.nomination-form').forEach(form => {
            form.reset();
            const formMessage = form.querySelector('.form-message');
            if (formMessage) {
                formMessage.style.display = 'none';
                formMessage.className = 'form-message';
            }
        });

        lastFocusedElement = document.activeElement;
        modalOverlay.classList.add('active');
        document.addEventListener('keydown', handleFocusTrap);
        
        const activeStep = modalContent.querySelector('.form-step.active');
        const focusableElements = activeStep.querySelectorAll(focusableElementsSelector);
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        document.removeEventListener('keydown', handleFocusTrap);
        if (lastFocusedElement) {
            lastFocusedElement.focus();
        }
    };
    
    const goToStep = (stepName) => {
        const currentStep = modalContent.querySelector('.form-step.active');
        const nextStep = modalContent.querySelector(`.form-step[data-step="${stepName}"]`);

        if (!currentStep || !nextStep || currentStep === nextStep) return;

        currentStep.classList.add('slide-out');

        currentStep.addEventListener('animationend', () => {
            currentStep.classList.remove('active', 'slide-out');
            
            nextStep.classList.add('active', 'slide-in');
            
            if (stepName === '2-self') modalTitle.textContent = "Your Nomination";
            else if (stepName === '2-peer') modalTitle.textContent = "Peer Nomination";
            else modalTitle.textContent = "Nominate a Leader";
            
            const nextFocusable = nextStep.querySelectorAll(focusableElementsSelector);
            if(nextFocusable.length > 0) nextFocusable[0].focus();

            nextStep.addEventListener('animationend', () => {
                nextStep.classList.remove('slide-in');
            }, { once: true });

        }, { once: true });
    };

    // --- Event Listeners ---
    openModalBtns.forEach(btn => btn.addEventListener('click', openModal));
    closeModalBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    modalContent.querySelectorAll('.choice-btn').forEach(btn => {
        btn.addEventListener('click', () => goToStep(btn.dataset.nextStep));
    });

    modalContent.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => goToStep('1'));
    });

    document.querySelectorAll('.nomination-form').forEach(form => {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitButton = this.querySelector('button[type="submit"]');
            const formMessage = this.querySelector('.form-message');
            
            formMessage.style.display = 'none';
            formMessage.textContent = '';
            
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
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Network response was not ok.');
                }
                
                formMessage.innerHTML = 'Thank you! Your nomination has been received. Our team will review it and be in touch.';
                formMessage.className = 'form-message success';
                this.reset();
                
            } catch (error) {
                console.error('Submission error:', error);
                formMessage.textContent = 'An error occurred. Please try again later.';
                formMessage.className = 'form-message error';
            } finally {
                formMessage.style.display = 'block';
                submitButton.textContent = 'Submit Nomination';
                submitButton.disabled = false;
            }
        });
    });
});
