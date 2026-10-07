const $ = id => document.getElementById(id);
let mode = 'login';
let pending = false;
let signedIn = false;
$('year').textContent = new Date().getFullYear();

function message(id, text = '') { $(id).textContent = text; $(id).hidden = !text; }
function clearErrors() {
  for (const id of ['name', 'email', 'password', 'confirm-password']) $(id).removeAttribute('aria-invalid');
  for (const id of ['name-error', 'email-error', 'password-error', 'confirm-error', 'form-message']) message(id);
}
function setMode(next, focus = true) {
  if (pending || signedIn) return;
  mode = next;
  const register = mode === 'register';
  clearErrors();
  $('auth-form').reset();
  $('password').type = 'password';
  $('toggle-password').setAttribute('aria-label', 'Show password');
  $('toggle-password').setAttribute('aria-pressed', 'false');
  $('name-field').hidden = $('confirm-field').hidden = !register;
  $('name').disabled = $('confirm-password').disabled = !register;
  $('name').required = $('confirm-password').required = register;
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('form-title').textContent = register ? 'Your workspace starts here.' : 'Welcome back.';
  $('form-subtitle').textContent = register ? 'Create an account to get started with Countersign.' : 'Sign in to your Countersign workspace.';
  $('submit-label').textContent = register ? 'Create account' : 'Sign in';
  $('top-switch').textContent = register ? 'Already have an account? ↗' : 'Create an account ↗';
  $('switch-copy').firstChild.textContent = register ? 'Already have an account? ' : 'New to Countersign? ';
  $('bottom-switch').textContent = register ? 'Sign in' : 'Create an account';
  for (const [id, active] of [['login-tab', !register], ['register-tab', register]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-selected', String(active));
    $(id).tabIndex = active ? 0 : -1;
  }
  $('form-panel').setAttribute('aria-labelledby', register ? 'register-tab' : 'login-tab');
  document.title = `${register ? 'Create account' : 'Sign in'} · Countersign`;
  if (focus) $(register ? 'name' : 'email').focus();
}
function busy(value) {
  pending = value;
  $('auth-form').setAttribute('aria-busy', String(value));
  for (const id of ['submit-button', 'login-tab', 'register-tab', 'top-switch', 'bottom-switch']) $(id).disabled = value;
  for (const id of ['email', 'password', 'toggle-password']) $(id).disabled = value;
  $('name').disabled = $('confirm-password').disabled = value || mode !== 'register';
  $('submit-label').textContent = value ? (mode === 'register' ? 'Creating account…' : 'Signing in…') : (mode === 'register' ? 'Create account' : 'Sign in');
}
function showUser(user) {
  signedIn = true;
  $('auth-view').hidden = true;
  $('workspace-view').hidden = false;
  $('top-switch').hidden = true;
  $('welcome-name').textContent = `Welcome, ${user.name.split(' ')[0]}.`;
  $('account-name').textContent = user.name;
  $('account-email').textContent = user.email;
  $('auth-form').reset();
  document.title = 'Your workspace · Countersign';
}
async function api(path, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
    const result = await response.json();
    return { response, result };
  } finally { clearTimeout(timer); }
}
function error(field, id, text) {
  $(field).setAttribute('aria-invalid', 'true');
  $(field).setAttribute('aria-describedby', id);
  message(id, text);
  return field;
}
$('login-tab').addEventListener('click', () => setMode('login'));
$('register-tab').addEventListener('click', () => setMode('register'));
for (const id of ['top-switch', 'bottom-switch']) $(id).addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || pending) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login';
  setMode(next, false); $(next === 'login' ? 'login-tab' : 'register-tab').focus();
});
$('toggle-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('toggle-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $('toggle-password').setAttribute('aria-pressed', String(show));
});
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  clearErrors();
  const email = $('email').value.trim();
  const password = $('password').value;
  const name = $('name').value.trim();
  const invalid = [];
  if (mode === 'register' && (name.length < 2 || name.length > 60)) invalid.push(error('name', 'name-error', 'Use 2–60 characters for your name.'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) invalid.push(error('email', 'email-error', 'Enter a valid email address.'));
  if (password.length < 10 || password.length > 128) invalid.push(error('password', 'password-error', 'Use a password with 10–128 characters.'));
  if (mode === 'register' && password !== $('confirm-password').value) invalid.push(error('confirm-password', 'confirm-error', 'Your passwords do not match.'));
  if (invalid.length) { $(invalid[0]).focus(); return; }
  busy(true);
  try {
    const { response, result } = await api(`/api/${mode}`, { email, password, ...(mode === 'register' ? { name } : {}) });
    if (!response.ok) { message('form-message', result.error || 'Unable to sign in. Please try again.'); return; }
    showUser(result.user);
  } catch {
    message('form-message', 'We couldn’t reach the server. Check your connection and try again.');
  } finally { busy(false); }
});
$('logout-button').addEventListener('click', async () => {
  $('logout-button').disabled = true;
  message('workspace-message');
  try {
    const { response } = await api('/api/logout', {});
    if (!response.ok) throw new Error();
    signedIn = false;
    $('auth-view').hidden = false; $('workspace-view').hidden = true; $('top-switch').hidden = false;
    setMode('login');
  } catch { message('workspace-message', 'Unable to sign out. Please try again.'); }
  finally { $('logout-button').disabled = false; }
});
setMode('login', false);
busy(true);
api('/api/me').then(({ response, result }) => {
  if (response.ok) showUser(result.user);
  else if (response.status !== 401) message('form-message', 'Unable to check your session. Please refresh the page.');
}).catch(() => message('form-message', 'We couldn’t reach the server. Refresh the page to reconnect.')).finally(() => busy(false));
