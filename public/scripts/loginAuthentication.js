const loginButton  = document.getElementById('login-button');
const loginMessage  = document.getElementById('login-message');


document.addEventListener('DOMContentLoaded', () => {
    setupFormValidation();
});

async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showMessage('Por favor, completa todos los campos', 'error');
        return;
    }

    showLoading(true);

    try {
        const response = await fetch('/api/auth/login', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',  // ← El browser guarda la cookie httpOnly automáticamente
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (result.success) {
            showMessage(result.message, 'success');
            setTimeout(() => { window.location.href = '/login-successfully'; }, 1000);
        } else {
            showMessage(result.message || 'Usuario o contraseña incorrectos', 'error');
        }

    } catch (error) {
        console.error('Error en login:', error);
        showMessage('Error de conexión con el servidor', 'error');
    } finally {
        showLoading(false);
    }
}

function showMessage(message, type) {
    loginMessage.textContent   = message;
    loginMessage.className     = `message ${type}`;
    loginMessage.style.display = 'block';
    if (type !== 'success') setTimeout(() => { loginMessage.style.display = 'none'; }, 5000);
}

function showLoading(isLoading) {
    loginButton.disabled  = isLoading;
    loginButton.innerHTML = isLoading
        ? '<i class="fas fa-spinner fa-spin"></i> Iniciando sesión...'
        : 'Iniciar Sesión';
    loginButton.style.opacity = isLoading ? '0.7' : '1';
}

function setupFormValidation() {
    document.querySelectorAll('.form-input').forEach(input => {
        input.addEventListener('blur', function () {
            this.style.borderColor = this.value.trim() === '' ? 'rgba(220,53,69,0.5)' : 'rgba(255,255,255,0.1)';
        });
        input.addEventListener('focus', function () { this.style.borderColor = '#60e61a'; });
    });
}

document.addEventListener('keypress', e => { if (e.key === 'Enter') handleLogin(new Event('submit')); });
window.handleLogin = handleLogin;