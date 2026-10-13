function setMenuOpen(open) {
    const toggle = document.getElementById('mobile-menu-toggle');
    document.getElementById('sidebar').classList.toggle('open', open);
    document.getElementById('sidebar-overlay')?.classList.toggle('open', open);
    toggle?.setAttribute('aria-expanded', String(open));
}

/**
 * Menú lateral móvil: botón hamburguesa, botón cerrar, fondo oscuro y gestos de deslizamiento
 * (desde el borde izquierdo abre; hacia la izquierda cierra). El botón hamburguesa nunca sale del DOM:
 * al abrirse el menú queda detrás del panel.
 */
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
