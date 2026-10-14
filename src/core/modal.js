import { escapeHtml, parseDecimal, sanitizeDecimal, toggleSign } from './utils.js';
import { showNotification } from './notifications.js';

function renderField(field) {
    const id = `modal-${field.name}`;
    const label = `<label for="${id}">${escapeHtml(field.label)}</label>`;
    const hint = field.hint ? `<small class="modal-hint">${field.hint}</small>` : '';
    const disabled = field.disabled ? 'disabled' : '';
    let control;

    if (field.type === 'select') {
        const options = (field.options || []).map(opt =>
            `<option value="${escapeHtml(opt.value)}" ${String(opt.value) === String(field.value ?? '') ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
        ).join('');
        control = `<select id="${id}" name="${field.name}" ${disabled}>${options}</select>`;
    } else {
        const attrs = [`type="${field.type || 'text'}"`];
        if (field.type === 'number') {
            const integer = field.step === 1;
            attrs[0] = 'type="text"';
            attrs.push(`inputmode="${integer ? 'numeric' : 'decimal'}"`, 'autocomplete="off"', 'data-number');
            if (integer) attrs.push('data-integer');
            if (field.min === undefined) attrs.push('data-negative');
        }
        if (field.placeholder) attrs.push(`placeholder="${escapeHtml(field.placeholder)}"`);
        control = `<input id="${id}" name="${field.name}" ${attrs.join(' ')} value="${escapeHtml(field.value ?? '')}" ${disabled}>`;
        if (field.type === 'number' && field.min === undefined) {
            control = `<div class="modal-input-group">${control}<button type="button" class="sign-toggle" data-sign-toggle
                title="Cambiar signo (positivo o negativo)" aria-label="Cambiar signo (positivo o negativo)" ${disabled}>±</button></div>`;
        }
    }

    return `<div class="modal-field" data-field="${field.name}">${label}${control}${hint}</div>`;
}

function readValues(form, fields) {
    const values = {};
    fields.forEach(field => {
        const el = form.elements[field.name];
        if (!el) return;
        if (field.type === 'number') values[field.name] = parseDecimal(el.value);
        else values[field.name] = el.value;
    });
    return values;
}

/**
 * Abre un formulario modal (alta o edición).
 *
 * @param {Object} options
 * @param {Array<{name: string, label: string, type?: 'text'|'number'|'date'|'select', value?: any,
 *   options?: Array<{value: string, label: string}>, required?: boolean, disabled?: boolean,
 *   min?: number, max?: number, step?: number, placeholder?: string, hint?: string,
 *   visibleIf?: (values: Object) => boolean}>} options.fields
 *   Un campo con `visibleIf` falso se oculta, no se valida y llega como `undefined`.
 *   Los campos `number` sin `min` admiten valores negativos y muestran un botón ± para cambiar el signo
 *   (el teclado numérico de iOS no trae el signo menos).
 * @param {(values: Object) => (string|void|Promise<string|void>)} options.onSubmit
 *   Si devuelve un texto, se muestra como error y el modal sigue abierto; en cualquier otro caso se cierra.
 * @returns {{close: () => void}}
 */
export function openFormModal({ title, note = '', fields, submitLabel = 'Guardar', cancelLabel = 'Cancelar', danger = false, successMessage = null, onSubmit }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
            <h2>${escapeHtml(title)}</h2>
            ${note ? `<p class="modal-note">${note}</p>` : ''}
            <form class="modal-form" novalidate>
                ${fields.map(renderField).join('')}
                <p class="modal-error" role="alert" hidden></p>
                <div class="modal-actions">
                    <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(submitLabel)}</button>
                    <button type="button" class="btn btn-secondary" data-cancel>${escapeHtml(cancelLabel)}</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('.modal-form');
    const errorEl = overlay.querySelector('.modal-error');
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
    };
    document.addEventListener('keydown', onKey);

    const showError = (message) => {
        errorEl.textContent = message;
        errorEl.hidden = !message;
        if (message) showNotification(message, 'error');
    };

    const refreshVisibility = () => {
        const values = readValues(form, fields);
        fields.forEach(field => {
            if (!field.visibleIf) return;
            const visible = !!field.visibleIf(values);
            const wrapper = form.querySelector(`[data-field="${field.name}"]`);
            wrapper.hidden = !visible;
            wrapper.dataset.hidden = visible ? '' : '1';
        });
    };
    const markSign = (input) => {
        const negative = input.value.startsWith('-');
        input.classList.toggle('is-negative', negative);
        input.parentElement.querySelector('[data-sign-toggle]')?.classList.toggle('active', negative);
    };
    form.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.hasAttribute('data-number')) return;
        const clean = sanitizeDecimal(el.value, { decimals: !el.hasAttribute('data-integer'), negative: el.hasAttribute('data-negative') });
        if (clean !== el.value) el.value = clean;
        markSign(el);
    });
    form.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-sign-toggle]')) e.preventDefault();
    });
    form.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-sign-toggle]');
        if (!toggle) return;
        const input = toggle.parentElement.querySelector('input');
        input.value = toggleSign(input.value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
    });
    form.querySelectorAll('[data-number][data-negative]').forEach(markSign);
    form.addEventListener('input', refreshVisibility);
    form.addEventListener('change', refreshVisibility);
    refreshVisibility();

    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError('');

        const values = readValues(form, fields);
        for (const field of fields) {
            const wrapper = form.querySelector(`[data-field="${field.name}"]`);
            if (wrapper.dataset.hidden) {
                values[field.name] = undefined;
                continue;
            }
            const required = field.required !== false && !field.disabled;
            const value = values[field.name];
            if (required && (value === null || value === undefined || value === '' || Number.isNaN(value))) {
                showError(`Completa el campo "${field.label}"`);
                form.elements[field.name]?.focus();
                return;
            }
        }

        const submitBtn = form.querySelector('[type="submit"]');
        submitBtn.disabled = true;
        try {
            const error = await onSubmit(values);
            if (typeof error === 'string' && error) {
                showError(error);
                return;
            }
            close();
            if (successMessage) showNotification(successMessage, 'success');
        } catch (err) {
            console.error(err);
            showError('❌ ' + (err.message || 'Error inesperado'));
        } finally {
            submitBtn.disabled = false;
        }
    });

    form.querySelector('input:not([disabled]), select:not([disabled])')?.focus();

    return { close };
}

/** Modal de confirmación. Resuelve `true` si se acepta y `false` si se cancela (botón, Esc o clic fuera). */
export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-card" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title)}">
                <h2>${escapeHtml(title)}</h2>
                <p class="modal-note">${message}</p>
                <div class="modal-actions">
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(confirmLabel)}</button>
                    <button type="button" class="btn btn-secondary" data-cancel>${escapeHtml(cancelLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const onKey = (e) => { if (e.key === 'Escape') finish(false); };
        const finish = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };
        document.addEventListener('keydown', onKey);
        overlay.querySelector('[data-ok]').addEventListener('click', () => finish(true));
        overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(false); });
        overlay.querySelector('[data-ok]').focus();
    });
}
