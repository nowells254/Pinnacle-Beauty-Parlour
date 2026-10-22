'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let services = [];
let config = { name: 'Pinnacle BeautyParlour', currency: 'KSh', timeZone: 'Africa/Nairobi', whatsapp: '' };
let user = null;
let toastTimer;
let msgPollTimer = null;
let replyTarget = null;
let lastMsgCount = 0;

async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function toast(s) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = s;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function feedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError && !!msg);
  el.classList.toggle('ok', !isError && !!msg);
}

function money(n) {
  return `${config.currency || 'KSh'} ${Number(n).toLocaleString('en-KE')}`;
}

function todayLocal() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone || 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

function openAuth(tab = 'login') {
  $('#authModal').classList.remove('hidden');
  switchAuthTab(tab);
}
function closeAuth() { $('#authModal').classList.add('hidden'); }

function switchAuthTab(tab) {
  $$('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#loginForm').classList.toggle('hidden', tab !== 'login');
  $('#signupForm').classList.toggle('hidden', tab !== 'signup');
  $('#forgotForm').classList.toggle('hidden', tab !== 'forgot');
  $('#resetForm').classList.toggle('hidden', tab !== 'reset');
}

function updateAuthBtn() {
  const btn = $('#authBtn');
  if (user) {
    btn.textContent = user.role === 'admin' ? 'Owner dashboard' : 'My account';
  } else {
    btn.textContent = 'Sign in';
  }
}

async function checkAuth() {
  try {
    const d = await api('/api/me');
    if (d.authenticated) {
      user = { id: d.id, email: d.email, role: d.role, fullName: d.fullName || '' };
    } else {
      user = null;
    }
  } catch {
    user = null;
  }
  updateAuthBtn();
}

function renderServiceCards() {
  const grid = $('#serviceGrid');
  const q = ($('#serviceSearch')?.value || '').trim().toLowerCase();
  const category = $('#serviceCategoryFilter')?.value || '';
  const visible = services.filter(s =>
    (!category || (s.category || 'Other') === category) &&
    (!q || `${s.name} ${s.category || ''} ${s.description || ''}`.toLowerCase().includes(q))
  );
  grid.innerHTML = visible.length
    ? visible.map(s => `
      <article class="service-card">
        <div class="service-icon" aria-hidden="true">${esc(s.icon || '✧')}</div>
        <small class="service-category">${esc(s.category || 'Beauty services')}</small>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.description || 'Thoughtful beauty care.')}</p>
        <div class="service-bottom">
          <div>
            <div class="service-price">${Number(s.price) === 0 ? 'Consultation' : money(s.price)}</div>
            <div class="service-duration">Approx. ${Number(s.duration)} min</div>
          </div>
          <button class="service-book" data-book-service="${esc(s.id)}">Book this ↗</button>
        </div>
      </article>`).join('')
    : `<div class="empty-state">No services match that search.</div>`;
}

function renderServices() {
  const categories = [...new Set(services.map(s => s.category || 'Other'))].sort();
  const filter = $('#serviceCategoryFilter');
  if (filter) {
    const old = filter.value;
    filter.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (categories.includes(old)) filter.value = old;
  }
  renderServiceCards();

  const select = $('#bookingService');
  const oldVal = select.value;
  const groups = new Map();
  services.forEach(s => {
    const cat = s.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  });
  select.disabled = !services.length;
  let html = '<option value="">Select a service…</option>';
  for (const [cat, list] of groups) {
    html += `<optgroup label="${esc(cat)}">`;
    list.forEach(s => {
      html += `<option value="${esc(s.id)}">${esc(s.name)} — ${Number(s.price) === 0 ? 'Consultation' : money(s.price)} (${s.duration} min)</option>`;
    });
    html += '</optgroup>';
  }
  select.innerHTML = html;
  if (oldVal) select.value = oldVal;
}

async function loadSlots() {
  const date = $('#bookingForm [name=date]').value;
  const service = $('#bookingService').value;
  const timeSelect = $('#bookingTime');
  if (!date || !service) {
    timeSelect.innerHTML = '<option value="">Select date & service first</option>';
    return;
  }
  timeSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const d = await api(`/api/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`);
    if (d.closed) {
      timeSelect.innerHTML = '<option value="">Salon closed this day</option>';
      return;
    }
    if (!d.slots?.length) {
      timeSelect.innerHTML = '<option value="">No slots available</option>';
      return;
    }
    timeSelect.innerHTML = '<option value="">Choose a time</option>' + d.slots.map(t => `<option value="${t}">${t}</option>`).join('');
  } catch (e) {
    timeSelect.innerHTML = `<option value="">${esc(e.message)}</option>`;
  }
}

async function submitBooking(e) {
  e.preventDefault();
  const form = e.target;
  const fb = $('#bookingFeedback');
  feedback(fb, '');
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const body = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      service: form.service.value,
      date: form.date.value,
      time: form.time.value,
      notes: form.notes.value.trim()
    };
    const d = await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
    form.reset();
    $('#bookingTime').innerHTML = '<option value="">Select date & service first</option>';
    showSuccess(d);
  } catch (err) {
    feedback(fb, err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function showSuccess(d) {
  $('#successMsg').textContent = d.message || 'Your appointment request has been submitted.';
  const actions = $('#contactActions');
  const c = d.contactOptions || {};
  let html = '';
  if (c.whatsapp) html += `<a class="wa" href="${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp the salon</a>`;
  if (c.call) html += `<a class="call" href="${esc(c.call)}">Call the salon</a>`;
  if (c.sms) html += `<a class="sms" href="${esc(c.sms)}">Send SMS</a>`;
  if (!html) html = '<p class="muted">The salon will contact you shortly.</p>';
  actions.innerHTML = html;
  $('#successModal').classList.remove('hidden');
}

function openDash() {
  if (!user) return openAuth('login');
  $('#dashModal').classList.remove('hidden');
  $('#dashTitle').textContent = user.role === 'admin' ? 'Owner Dashboard' : 'My Account';
  $('#dashUser').textContent = `${user.fullName || user.email} · ${user.role}`;
  renderDashTabs();
  loadDashTab(user.role === 'admin' ? 'bookings' : 'mybookings');
}

function closeDash() { stopMsgPoll(); $('#dashModal').classList.add('hidden'); }

function renderDashTabs() {
  const tabs = $('#dashTabs');
  if (user.role === 'admin') {
    tabs.innerHTML = `
      <button class="dash-tab active" data-tab="bookings">Bookings</button>
      <button class="dash-tab" data-tab="services">Services</button>
      <button class="dash-tab" data-tab="messages">Messages</button>
      <button class="dash-tab" data-tab="settings">Settings</button>
      <button class="dash-tab" data-tab="profile">Profile</button>
      <button class="dash-tab" data-tab="clients">Clients</button>`;
  } else {
    tabs.innerHTML = `
      <button class="dash-tab active" data-tab="mybookings">My bookings</button>
      <button class="dash-tab" data-tab="messages">Messages</button>
      <button class="dash-tab" data-tab="profile">Profile</button>`;
  }
  tabs.querySelectorAll('.dash-tab').forEach(b => {
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.dash-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      loadDashTab(b.dataset.tab);
    });
  });
}
async function loadDashTab(tab) {
  const host = $('#dashContent');
  host.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (tab === 'bookings') await renderAdminBookings(host);
    else if (tab === 'mybookings') await renderMyBookings(host);
    else if (tab === 'services') await renderAdminServices(host);
    else if (tab === 'messages') await renderMessages(host);
    else if (tab === 'settings') await renderSettings(host);
    else if (tab === 'profile') await renderProfile(host);
    else if (tab === 'clients') await renderClients(host);
  } catch (e) {
    host.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

async function renderAdminBookings(host) {
  const rows = await api('/api/admin/bookings');
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No bookings yet.</div>';
    return;
  }
  host.innerHTML = `
    <div style="overflow-x:auto">
      <table class="dash-table">
        <thead><tr><th>ID</th><th>Client</th><th>Service</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${rows.map(b => `
            <tr>
              <td>${esc(b.id)}</td>
              <td>${esc(b.customer_name)}<br><small>${esc(b.phone)}</small></td>
              <td>${esc(b.service_name)}</td>
              <td>${esc(String(b.appointment_date).slice(0, 10))}</td>
              <td>${esc(String(b.appointment_time).slice(0, 5))}</td>
              <td><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td>
              <td class="dash-actions">
                ${b.status === 'Requested' ? `<button class="btn-sm btn-confirm" data-status="Confirmed" data-id="${esc(b.id)}">Confirm</button>` : ''}
                ${b.status !== 'Cancelled' && b.status !== 'Completed' ? `<button class="btn-sm btn-cancel" data-status="Cancelled" data-id="${esc(b.id)}">Cancel</button>` : ''}
                ${b.status === 'Confirmed' ? `<button class="btn-sm btn-confirm" data-status="Completed" data-id="${esc(b.id)}">Complete</button>` : ''}
                <button class="btn-sm btn-delete" data-delete="${esc(b.id)}">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  host.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/bookings/${encodeURIComponent(btn.dataset.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: btn.dataset.status })
        });
        toast(`Marked as ${btn.dataset.status}`);
        loadDashTab('bookings');
      } catch (e) { toast(e.message); }
    });
  });
  host.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Permanently delete this booking?')) return;
      try {
        await api(`/api/admin/bookings/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
        toast('Booking deleted');
        loadDashTab('bookings');
      } catch (e) { toast(e.message); }
    });
  });
}

async function renderMyBookings(host) {
  const rows = await api('/api/my/bookings');
  if (!rows.length) {
    host.innerHTML = '<div class="empty">You have no bookings yet. <a href="#booking" onclick="closeDash()">Book now</a></div>';
    return;
  }
  host.innerHTML = `
    <div style="overflow-x:auto">
      <table class="dash-table">
        <thead><tr><th>Service</th><th>Date</th><th>Time</th><th>Status</th><th>Price</th></tr></thead>
        <tbody>
          ${rows.map(b => `
            <tr>
              <td>${esc(b.service_name)}</td>
              <td>${esc(String(b.appointment_date).slice(0, 10))}</td>
              <td>${esc(String(b.appointment_time).slice(0, 5))}</td>
              <td><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td>
              <td>${money(b.price)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderAdminServices(host) {
  const rows = await api('/api/admin/services');
  host.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-primary btn-sm" id="addServiceBtn">+ Add service</button>
    </div>
    <div id="serviceAdminList" style="overflow-x:auto">
      <table class="dash-table">
        <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Duration</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${rows.map(s => `
            <tr>
              <td>${esc(s.name)}</td>
              <td>${esc(s.category)}</td>
              <td>${money(s.price)}</td>
              <td>${s.duration} min</td>
              <td>${s.active ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn-sm" data-toggle="${esc(s.id)}" data-active="${s.active}">${s.active ? 'Hide' : 'Show'}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div id="addServiceForm" class="service-form hidden" style="margin-top:20px;padding:16px;border:1px solid var(--line);border-radius:12px">
      <h3 style="margin:0 0 10px">New service</h3>
      <label>Name<input id="newSvcName" required></label>
      <label>Category<input id="newSvcCat" placeholder="e.g. Nails"></label>
      <label>Price (KSh)<input id="newSvcPrice" type="number" min="0" value="0"></label>
      <label>Duration (min)<input id="newSvcDur" type="number" min="5" max="600" value="30"></label>
      <label>Description<textarea id="newSvcDesc" rows="2"></textarea></label>
      <button class="btn btn-primary btn-sm" id="saveNewSvc">Save service</button>
    </div>`;
  host.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/services/${encodeURIComponent(btn.dataset.toggle)}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: btn.dataset.active !== 'true' })
        });
        toast('Service updated');
        loadDashTab('services');
        services = await api('/api/services');
        renderServices();
      } catch (e) { toast(e.message); }
    });
  });
  $('#addServiceBtn')?.addEventListener('click', () => $('#addServiceForm').classList.toggle('hidden'));
  $('#saveNewSvc')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/services', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#newSvcName').value.trim(),
          category: $('#newSvcCat').value.trim() || 'Other',
          price: Number($('#newSvcPrice').value),
          duration: Number($('#newSvcDur').value),
          description: $('#newSvcDesc').value.trim()
        })
      });
      toast('Service added');
      loadDashTab('services');
      services = await api('/api/services');
      renderServices();
    } catch (e) { toast(e.message); }
  });
}

function stopMsgPoll() {
  if (msgPollTimer) { clearInterval(msgPollTimer); msgPollTimer = null; }
}

function updateMsgBadge(count) {
  document.querySelectorAll('.dash-tab[data-tab="messages"]').forEach(t => {
    t.innerHTML = count > 0 ? `Messages <span class="msg-badge">${count}</span>` : 'Messages';
  });
  const btn = $('#authBtn');
  if (btn && user) {
    const label = user.role === 'admin' ? 'Owner dashboard' : 'My account';
    btn.textContent = count > 0 ? `${label} (${count})` : label;
  }
}

async function renderMessages(host) {
  stopMsgPoll();
  const isAdmin = user.role === 'admin';
  host.innerHTML = `
    <div class="chat-wrap">
      <div class="msg-list" id="msgList"><div class="loading">Loading chat…</div></div>
      <div class="msg-compose">
        <div id="replyBar" class="reply-bar hidden">
          <span id="replyLabel"></span>
          <button type="button" id="clearReply" class="reply-clear" title="Cancel">×</button>
        </div>
        <textarea id="msgBody" rows="2" placeholder="${isAdmin ? 'Click Reply on a client message, then type…' : 'Type a message to the salon…'}"></textarea>
        <button class="btn btn-primary btn-sm" id="sendMsg">Send</button>
      </div>
    </div>`;

  async function paint() {
    const list = $('#msgList');
    if (!list) return;
    try {
      const rows = await api('/api/messages');
      const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (!rows.length) {
        list.innerHTML = '<div class="empty">No messages yet.</div>';
      } else {
        list.innerHTML = rows.map(m => {
          const mine = m.from_user_id === user.id || (isAdmin && m.sender_role === 'admin');
          const name = m.from_name || (m.sender_role === 'admin' ? 'Salon' : 'Client');
          const time = new Date(m.created_at).toLocaleString();
          const replyBtn = (isAdmin && m.sender_role === 'client' && m.from_user_id)
            ? `<button type="button" class="msg-reply" data-uid="${esc(m.from_user_id)}" data-name="${esc(name)}">Reply</button>`
            : '';
          return `<div class="msg-row ${mine ? 'mine' : 'theirs'}"><div class="msg-bubble"><div class="meta">${esc(name)} · ${esc(time)}</div><div class="msg-text">${esc(m.body)}</div>${replyBtn}</div></div>`;
        }).join('');
      }
      if (wasAtBottom || rows.length !== lastMsgCount) list.scrollTop = list.scrollHeight;
      lastMsgCount = rows.length;
    } catch (e) {
      list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  function setReply(id, name) {
    replyTarget = { id, name };
    const bar = $('#replyBar'), label = $('#replyLabel');
    if (bar && label) { label.textContent = 'Replying to ' + name; bar.classList.remove('hidden'); }
    $('#msgBody')?.focus();
  }
  function clearReply() {
    replyTarget = null;
    $('#replyBar')?.classList.add('hidden');
  }

  host.querySelector('#clearReply')?.addEventListener('click', clearReply);
  host.addEventListener('click', e => {
    const btn = e.target.closest('.msg-reply');
    if (btn) setReply(btn.dataset.uid, btn.dataset.name);
  });

  $('#sendMsg')?.addEventListener('click', async () => {
    const body = $('#msgBody').value.trim();
    if (!body) return toast('Message is empty');
    try {
      const payload = { body };
      if (isAdmin) {
        if (!replyTarget?.id) return toast('Click Reply on a client message first');
        payload.toUserId = replyTarget.id;
      }
      await api('/api/messages', { method: 'POST', body: JSON.stringify(payload) });
      $('#msgBody').value = '';
      await paint();
      toast('Sent');
    } catch (e) { toast(e.message); }
  });

  $('#msgBody')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#sendMsg')?.click(); }
  });

  await paint();
  try {
    const rows = await api('/api/messages');
    for (const m of rows) {
      if (m.to_user_id === user.id && !m.read) {
        api(`/api/messages/${encodeURIComponent(m.id)}/read`, { method: 'PATCH' }).catch(() => {});
      }
    }
    updateMsgBadge(0);
  } catch {}
  msgPollTimer = setInterval(paint, 3000);
}

async function renderSettings(host) {
  const s = await api('/api/admin/settings');
  const logoStyles = [
    ['gradient', 'Gradient circle'],
    ['outline', 'Outline ring'],
    ['solid', 'Solid badge'],
    ['minimal', 'Minimal letter'],
    ['square', 'Rounded square'],
    ['diamond', 'Soft diamond']
  ];
  host.innerHTML = `
    <form class="settings-form settings-wide" id="settingsForm">
      <h3 class="settings-heading">Business</h3>
      <label>Salon / Business name<input name="salon_name" value="${esc(s.salon_name || '')}"></label>
      <label>Business type<input name="business_type" value="${esc(s.business_type || 'Beauty Salon')}" placeholder="Beauty Salon, Boutique, Spa…"></label>
      <label>Tagline<input name="tagline" value="${esc(s.tagline || '')}"></label>
      <label>WhatsApp (international digits)<input name="whatsapp" value="${esc(s.whatsapp || '')}" placeholder="2547XXXXXXXX"></label>

      <h3 class="settings-heading">Hours</h3>
      <label>Opening time<input name="opening_time" value="${esc(s.opening_time || '09:00')}" placeholder="09:00"></label>
      <label>Closing time<input name="closing_time" value="${esc(s.closing_time || '18:00')}" placeholder="18:00"></label>
      <label>Slot interval (minutes)<input name="slot_interval" type="number" min="5" max="120" value="${esc(s.slot_interval || '30')}"></label>
      <label>Closed weekdays (0=Sun … 6=Sat)<input name="closed_days" value="${esc(s.closed_days || '')}" placeholder="0"></label>

      <h3 class="settings-heading">Look & logo</h3>
      <p class="muted">Logo letter updates automatically from your business name.</p>
      <label>Primary colour<input name="color_primary" type="color" value="${esc(s.color_primary || '#391b31')}"></label>
      <label>Accent colour<input name="color_accent" type="color" value="${esc(s.color_accent || '#b86e82')}"></label>
      <label>Background colour<input name="color_cream" type="color" value="${esc(s.color_cream || '#fffaf6')}"></label>
      <label>Logo style
        <select name="logo_style">
          ${logoStyles.map(([v, lab]) => `<option value="${v}" ${(s.logo_style || 'gradient') === v ? 'selected' : ''}>${lab}</option>`).join('')}
        </select>
      </label>
      <div class="logo-preview-row">
        <span class="muted">Preview</span>
        <span class="brand-mark" id="settingsLogoPreview" data-style="${esc(s.logo_style || 'gradient')}">P</span>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Save settings</button>
    </form>`;

  const nameInput = host.querySelector('[name=salon_name]');
  const styleSelect = host.querySelector('[name=logo_style]');
  const preview = $('#settingsLogoPreview');
  function refreshPreview() {
    if (!preview) return;
    const initials = logoInitials(nameInput?.value || config.name || 'P');
    preview.textContent = initials;
    preview.dataset.style = styleSelect?.value || 'gradient';
  }
  nameInput?.addEventListener('input', refreshPreview);
  styleSelect?.addEventListener('change', refreshPreview);
  refreshPreview();

  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
      toast('Settings saved — look updated');
      const cfg = await api('/api/config');
      config = { ...config, ...cfg };
      applyBranding();
    } catch (err) { toast(err.message); }
  });
}

async function renderProfile(host) {
  const p = await api('/api/profile');
  host.innerHTML = `
    <form class="profile-form" id="profileForm">
      <label>Full name<input name="fullName" value="${esc(p.full_name || '')}" required></label>
      <label>Email<input name="email" type="email" value="${esc(p.email || '')}" required></label>
      <label>Phone<input name="phone" value="${esc(p.phone || '')}"></label>
      <hr style="border:none;border-top:1px solid var(--line);margin:8px 0">
      <p class="muted">Change password (optional)</p>
      <label>Current password<input name="currentPassword" type="password"></label>
      <label>New password<input name="newPassword" type="password" minlength="8"></label>
      <button type="submit" class="btn btn-primary btn-sm">Save profile</button>
      <button type="button" class="btn btn-outline btn-sm" id="logoutBtn" style="margin-top:8px">Sign out</button>
    </form>`;
  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (!body.currentPassword) delete body.currentPassword;
    if (!body.newPassword) delete body.newPassword;
    try {
      const updated = await api('/api/profile', { method: 'PATCH', body: JSON.stringify(body) });
      user = { ...user, email: updated.email, fullName: updated.full_name };
      updateAuthBtn();
      $('#dashUser').textContent = `${user.fullName || user.email} · ${user.role}`;
      toast('Profile updated');
    } catch (err) { toast(err.message); }
  });
  $('#logoutBtn')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    user = null;
    updateAuthBtn();
    closeDash();
    toast('Signed out');
  });
}

async function renderClients(host) {
  const rows = await api('/api/admin/clients');
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No registered clients yet.</div>';
    return;
  }
  host.innerHTML = `
    <div style="overflow-x:auto">
      <table class="dash-table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>ID</th></tr></thead>
        <tbody>
          ${rows.map(c => `
            <tr>
              <td>${esc(c.full_name)}</td>
              <td>${esc(c.email)}</td>
              <td>${esc(c.phone || '—')}</td>
              <td>${new Date(c.created_at).toLocaleDateString()}</td>
              <td><small>${esc(c.id)}</small></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function logoInitials(name) {
  const parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function applyBranding() {
  const name = config.name || config.salon_name || 'Pinnacle BeautyParlour';
  const parts = name.trim().split(/\s+/);
  $('#brandName').textContent = parts[0] || 'Pinnacle';
  $('#brandSub').textContent = (parts.slice(1).join(' ') || 'BEAUTY PARLOUR').toUpperCase();
  $('#footerName').textContent = name;
  if (config.tagline) $('#heroTagline').textContent = config.tagline;
  document.title = name;

  const initials = logoInitials(name);
  document.querySelectorAll('.brand-mark').forEach(el => {
    el.textContent = initials;
    el.dataset.style = config.logoStyle || 'gradient';
  });
  const art = document.querySelector('.art-letter');
  if (art) art.innerHTML = initials + '<span>✦</span>';

  const primary = config.colorPrimary || '#391b31';
  const accent = config.colorAccent || '#b86e82';
  const cream = config.colorCream || '#fffaf6';
  const root = document.documentElement;
  root.style.setProperty('--plum', primary);
  root.style.setProperty('--rose', accent);
  root.style.setProperty('--cream', cream);
  root.style.setProperty('--pink', accent + '22');
  root.style.setProperty('--plum2', primary);
}

async function loadPublic() {
  const [svc, cfg] = await Promise.all([api('/api/services'), api('/api/config')]);
  services = svc;
  config = {
    ...config,
    ...cfg,
    name: cfg.name,
    currency: cfg.currency,
    timeZone: cfg.timeZone,
    whatsapp: cfg.whatsapp,
    colorPrimary: cfg.colorPrimary,
    colorAccent: cfg.colorAccent,
    colorCream: cfg.colorCream,
    logoStyle: cfg.logoStyle
  };
  applyBranding();
  renderServices();
  const dateInput = $('#bookingForm [name=date]');
  if (dateInput) {
    dateInput.min = todayLocal();
    dateInput.value = todayLocal();
  }
}

function bindEvents() {
  $('#menuToggle')?.addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#authBtn')?.addEventListener('click', () => user ? openDash() : openAuth('login'));
  $('#authClose')?.addEventListener('click', closeAuth);
  $('#dashClose')?.addEventListener('click', closeDash);
  $('#successClose')?.addEventListener('click', () => $('#successModal').classList.add('hidden'));
  $('#successDone')?.addEventListener('click', () => $('#successModal').classList.add('hidden'));

  $$('.auth-tab').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.tab)));
  $('#forgotBtn')?.addEventListener('click', () => switchAuthTab('forgot'));
  $('#backToLogin')?.addEventListener('click', () => switchAuthTab('login'));

  $('#loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fb = $('#loginFeedback');
    feedback(fb, '');
    try {
      const d = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: e.target.email.value, password: e.target.password.value })
      });
      user = { id: d.id, email: d.email, role: d.role, fullName: d.fullName };
      updateAuthBtn();
      closeAuth();
      toast(`Welcome, ${d.fullName || d.email}`);
      openDash();
    } catch (err) { feedback(fb, err.message, true); }
  });

  $('#signupForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fb = $('#signupFeedback');
    feedback(fb, '');
    try {
      const d = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          fullName: e.target.fullName.value,
          email: e.target.email.value,
          phone: e.target.phone.value,
          password: e.target.password.value
        })
      });
      user = { id: d.id, email: d.email, role: d.role, fullName: d.fullName };
      updateAuthBtn();
      closeAuth();
      toast('Account created!');
      openDash();
    } catch (err) { feedback(fb, err.message, true); }
  });

  $('#forgotForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fb = $('#forgotFeedback');
    feedback(fb, '');
    try {
      const d = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: e.target.email.value })
      });
      if (d.resetToken) {
        feedback(fb, `Token (dev only): ${d.resetToken}`, false);
        switchAuthTab('reset');
        $('#resetForm [name=token]').value = d.resetToken;
      } else {
        feedback(fb, d.message || 'If that email exists, a reset was sent.', false);
      }
    } catch (err) { feedback(fb, err.message, true); }
  });

  $('#resetForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fb = $('#resetFeedback');
    feedback(fb, '');
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: e.target.token.value, password: e.target.password.value })
      });
      feedback(fb, 'Password updated. You can sign in now.', false);
      setTimeout(() => switchAuthTab('login'), 1500);
    } catch (err) { feedback(fb, err.message, true); }
  });

  $('#bookingForm')?.addEventListener('submit', submitBooking);
  $('#bookingService')?.addEventListener('change', loadSlots);
  $('#bookingForm [name=date]')?.addEventListener('change', loadSlots);
  $('#serviceSearch')?.addEventListener('input', renderServiceCards);
  $('#serviceCategoryFilter')?.addEventListener('change', renderServiceCards);

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-book-service]');
    if (btn) {
      $('#bookingService').value = btn.dataset.bookService;
      loadSlots();
      location.hash = '#booking';
    }
  });

  $('#year').textContent = new Date().getFullYear();
}

// Boot - force all modals closed on load
document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
bindEvents();
checkAuth()
  .then(() => loadPublic())
  .then(() => { if ($('#bookingService')?.value) loadSlots(); })
  .then(async () => {
    if (!user) return;
    try {
      const u = await api('/api/messages/unread-count');
      updateMsgBadge(u.count);
    } catch {}
    setInterval(async () => {
      if (!user) return;
      try {
        const u = await api('/api/messages/unread-count');
        updateMsgBadge(u.count);
      } catch {}
    }, 15000);
  })
  .catch(e => {
    $('#serviceGrid').innerHTML = `<div class="empty-state">Could not load services: ${esc(e.message)}</div>`;
    if ($('#bookingService')) {
      $('#bookingService').innerHTML = '<option value="">Service menu unavailable</option>';
      $('#bookingService').disabled = true;
    }
  });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}