/**
 * Toasts de notificación (se cierran al tocar o a los 5 s).
 */

function dismiss(notification) {
    if (notification.classList.contains('leaving')) return;
    notification.classList.add('leaving');
    setTimeout(() => notification.remove(), 300);
}

export function showNotification(message, type = 'info') {
    let root = document.getElementById('toast-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'toast-root';
        document.body.appendChild(root);
    }

    const notification = document.createElement('div');
    notification.className = `toast toast-${type}`;
    notification.textContent = message;
    notification.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        dismiss(notification);
    });

    root.appendChild(notification);
    setTimeout(() => dismiss(notification), 5000);
}
