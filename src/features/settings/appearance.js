import {
    THEME_OPTIONS, getThemePreference, getResolvedTheme, setThemePreference, onThemeChange
} from '../../services/theme-service.js';
import { escapeHtml } from '../../core/utils.js';

/** Panel de apariencia: Automático (según el sistema), Claro u Oscuro. */
export function mountAppearance(section) {
    section.innerHTML = `
        <h3>🎨 Apariencia</h3>
        <div class="theme-options" role="radiogroup" aria-label="Modo de color">
            ${THEME_OPTIONS.map(option => `
                <label class="theme-option">
                    <input type="radio" name="theme" value="${option.value}">
                    <span class="theme-option-icon" aria-hidden="true">${option.icon}</span>
                    <span class="theme-option-label">${escapeHtml(option.label)}</span>
                    <small>${escapeHtml(option.hint)}</small>
                </label>`).join('')}
        </div>
        <p class="provider-help" data-theme-note></p>
    `;

    section.querySelectorAll('input[name="theme"]').forEach(input => {
        input.addEventListener('change', () => setThemePreference(input.value));
    });

    refresh(section);
    onThemeChange(() => refresh(section));
}

function refresh(section) {
    const preference = getThemePreference();
    section.querySelectorAll('input[name="theme"]').forEach(input => {
        input.checked = input.value === preference;
    });
    const current = getResolvedTheme() === 'dark' ? 'oscuro' : 'claro';
    section.querySelector('[data-theme-note]').textContent = preference === 'auto'
        ? `Ahora se usa el modo ${current}, según el sistema. Cambiará solo si el sistema cambia.`
        : `Modo ${current} fijo en este dispositivo.`;
}
