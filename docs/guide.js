/** Cierra la guía; si el navegador no deja cerrar la pestaña, vuelve atrás o a la app. */
function closeGuide() {
    window.close();
    setTimeout(function () {
        if (window.closed) return;
        if (history.length > 1) history.back();
        else location.href = '../index.html';
    }, 200);
}

/** Añade un botón "Copiar" a cada bloque de código, salvo los marcados con data-no-copy. */
(function () {
    /** Texto del bloque. En <pre> usa textContent para que funcione aunque esté oculto (<details> cerrado). */
    function textOf(block) {
        var pre = block.querySelector('pre');
        var text = pre ? pre.textContent : block.innerText;
        return text.replace(/\u00a0/g, ' ').replace(/^\n+|\s+$/g, '');
    }

    /** Copia con un textarea temporal cuando la API del portapapeles no está disponible. */
    function fallbackCopy(text) {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        area.remove();
        return ok;
    }

    function copy(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
        }
        return Promise.resolve(fallbackCopy(text));
    }

    document.querySelectorAll('.code-block').forEach(function (block) {
        if (block.hasAttribute('data-no-copy')) return;

        var wrap = document.createElement('div');
        wrap.className = 'code-wrap';
        block.parentNode.insertBefore(wrap, block);
        wrap.appendChild(block);

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-btn';
        button.textContent = '📋 Copiar';
        button.setAttribute('aria-label', 'Copiar el código al portapapeles');
        wrap.appendChild(button);

        button.addEventListener('click', function () {
            copy(textOf(block)).then(function (ok) {
                button.textContent = ok ? '✅ Copiado' : '⚠️ No se pudo copiar';
                button.className = 'copy-btn ' + (ok ? 'copied' : 'failed');
                setTimeout(function () {
                    button.textContent = '📋 Copiar';
                    button.className = 'copy-btn';
                }, 2000);
            });
        });
    });
})();
