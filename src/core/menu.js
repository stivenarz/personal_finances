/**
 * Menú lateral móvil: botón hamburguesa, overlay y gestos de deslizamiento.
 *
 * El botón hamburguesa permanece SIEMPRE en el DOM y visible; al abrirse el menú
 * simplemente queda detrás del panel (el sidebar tiene mayor z-index).
 */
export function setMenuOpen(open) {
    const toggle = document.getElementById('mobile-menu-toggle');
    document.getElementById('sidebar').classList.toggle('open', open);
    document.getElementById('sidebar-overlay')?.classList.toggle('open', open);
    toggle?.setAttribute('aria-expanded', String(open));
}

export function setupMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');

    toggle?.addEventListener('click', () => setMenuOpen(true));
    document.getElementById('sidebar-close')?.addEventListener('click', () => setMenuOpen(false));
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => setMenuOpen(false));

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) setMenuOpen(false);
        });
    });

    let startX = 0;
    let startY = 0;

    document.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].clientX - startX;
        const deltaY = e.changedTouches[0].clientY - startY;
        if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) <= 50) return;

        if (startX < 50 && deltaX > 50) setMenuOpen(true);
        else if (sidebar.classList.contains('open') && deltaX < -50) setMenuOpen(false);
    }, { passive: true });
}
