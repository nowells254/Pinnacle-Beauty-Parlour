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

function setAppMode(mode) {
  // mode: 'app' | 'website'
  document.body.classList.remove('mode-app', 'mode-website');
  document.body.classList.add(mode === 'website' ? 'mode-website' : 'mode-app');
  try { sessionStorage.setItem('pinnacle_mode', mode === 'website' ? 'website' : 'app'); } catch {}
}
function goToWebsite() {
  stopMsgPoll();
  $('#dashModal')?.classList.add('hidden');
  document.body.classList.remove('dash-open');
  setAppMode('website');
  window.scrollTo(0, 0);
}
function goToApp() {
  setAppMode('app');
  if (user) openDash();
  else {
    $('#dashModal')?.classList.add('hidden');
    document.body.classList.remove('dash-open');
  }
}


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
  const loginBtn = $('#loginNavBtn');
  const signupBtn = $('#signupNavBtn');
  if (user) {
    if (btn) {
      btn.textContent = user.role === 'admin' ? 'Owner dashboard' : 'My account';
      btn.classList.remove('hidden');
    }
    loginBtn?.classList.add('hidden');
    signupBtn?.classList.add('hidden');
  } else {
    if (btn) btn.classList.add('hidden');
    loginBtn?.classList.remove('hidden');
    signupBtn?.classList.remove('hidden');
  }
}

async function checkAuth() {
  try {
    const d = await api('/api/me');
    if (d.authenticated) {
      user = { id: d.id, email: d.email, role: d.role, fullName: d.fullName || '', avatarUrl: d.avatarUrl || '' };
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
  document.body.classList.add('dash-open');
  const displayName = (user.fullName && user.fullName.trim()) ? user.fullName.trim() : (user.email || 'Account');
  $('#dashTitle').textContent = user.role === 'admin' ? 'Overview' : 'My account';
  $('#dashUser').textContent = displayName + (user.email ? ' · ' + user.email : '');
  if ($('#dashSideBiz')) $('#dashSideBiz').textContent = (config.name || 'Pinnacle').split(' ')[0];
  if ($('#dashSideName')) $('#dashSideName').textContent = displayName;
  if ($('#dashSideEmail')) $('#dashSideEmail').textContent = user.email || '';
  if ($('#dashSideRole')) $('#dashSideRole').textContent = user.role === 'admin' ? 'Admin' : 'Client';
  setUserAvatarUI(displayName, user.avatarUrl);
  document.querySelectorAll('#dashModal .brand-mark').forEach(el => {
    el.textContent = logoInitials(config.name || 'P');
    el.dataset.style = config.logoStyle || 'gradient';
  });
  $('#dashSidebar')?.classList.remove('nav-open');
  renderDashTabs();
  loadDashTab(user.role === 'admin' ? 'overview' : 'mybookings');
  // refresh profile for avatar/name
  api('/api/profile').then(p => {
    user.fullName = p.full_name || user.fullName;
    user.avatarUrl = p.avatar_url || '';
    user.email = p.email || user.email;
    const dn = (user.fullName && user.fullName.trim()) ? user.fullName.trim() : user.email;
    if ($('#dashSideName')) $('#dashSideName').textContent = dn;
    if ($('#dashSideEmail')) $('#dashSideEmail').textContent = user.email || '';
    if ($('#dashUser')) $('#dashUser').textContent = dn + (user.email ? ' · ' + user.email : '');
    setUserAvatarUI(dn, user.avatarUrl);
  }).catch(() => {});
}

function closeDash() {
  stopMsgPoll();
  $('#dashModal').classList.add('hidden');
  document.body.classList.remove('dash-open');
  // Stay in app mode (login screen) unless user chose website
}

function renderDashTabs() {
  const tabs = $('#dashTabs');
  if (user.role === 'admin') {
    tabs.innerHTML = `
      <button class="dash-tab active" data-tab="overview">Overview</button>
      <button class="dash-tab" data-tab="bookings">Bookings</button>
      <button class="dash-tab" data-tab="services">Services</button>
      <button class="dash-tab" data-tab="messages">Messages</button>
      <button class="dash-tab" data-tab="gallery">Gallery</button>
      <button class="dash-tab" data-tab="reviews">Reviews</button>
      <button class="dash-tab" data-tab="staff">Staff</button>
      <button class="dash-tab" data-tab="settings">Settings</button>
      <button class="dash-tab" data-tab="profile">Profile</button>
      <button class="dash-tab" data-tab="clients">Clients</button>`;
  } else {
    tabs.innerHTML = `
      <button class="dash-tab active" data-tab="mybookings">My bookings</button>
      <button class="dash-tab" data-tab="messages">Messages</button>
      <button class="dash-tab" data-tab="review">Leave review</button>
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
  const titles = {
    overview: 'Overview', bookings: 'Bookings', mybookings: 'My bookings',
    services: 'Services', messages: 'Messages', gallery: 'Gallery',
    reviews: 'Reviews', staff: 'Staff', settings: 'Settings',
    profile: 'Profile', clients: 'Clients', review: 'Leave a review'
  };
  if ($('#dashTitle')) $('#dashTitle').textContent = titles[tab] || 'Dashboard';
  host.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (tab === 'overview') await renderOverview(host);
    else if (tab === 'bookings') await renderAdminBookings(host);
    else if (tab === 'mybookings') await renderMyBookings(host);
    else if (tab === 'services') await renderAdminServices(host);
    else if (tab === 'messages') await renderMessages(host);
    else if (tab === 'gallery') await renderAdminGallery(host);
    else if (tab === 'reviews') await renderAdminReviews(host);
    else if (tab === 'staff') await renderStaff(host);
    else if (tab === 'settings') await renderSettings(host);
    else if (tab === 'profile') await renderProfile(host);
    else if (tab === 'clients') await renderClients(host);
    else if (tab === 'review') await renderClientReview(host);
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
        const out = await api(`/api/admin/bookings/${encodeURIComponent(btn.dataset.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: btn.dataset.status })
        });
        toast(out.notify?.whatsapp ? `Marked ${btn.dataset.status} · client notified` : `Marked as ${btn.dataset.status}`);
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
    host.innerHTML = '<div class="empty">You have no bookings yet. <button type="button" class="btn btn-primary btn-sm" id="emptyBookNow">Book on website</button></div>';
    $('#emptyBookNow')?.addEventListener('click', () => { goToWebsite(); location.hash = 'booking'; });
    return;
  }
  host.innerHTML = `
    <div style="overflow-x:auto">
      <table class="dash-table">
        <thead><tr><th>Service</th><th>Date</th><th>Time</th><th>Status</th><th>Price</th><th></th></tr></thead>
        <tbody>
          ${rows.map(b => `
            <tr>
              <td>${esc(b.service_name)}</td>
              <td>${esc(String(b.appointment_date).slice(0, 10))}</td>
              <td>${esc(String(b.appointment_time).slice(0, 5))}</td>
              <td><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td>
              <td>${money(b.price)}</td>
              <td>${['Requested','Confirmed'].includes(b.status) ? `<button class="btn-sm btn-cancel" data-cancel="${esc(b.id)}">Cancel</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  host.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this booking?')) return;
      try {
        await api(`/api/my/bookings/${encodeURIComponent(btn.dataset.cancel)}/cancel`, { method: 'PATCH' });
        toast('Booking cancelled');
        loadDashTab('mybookings');
      } catch (e) { toast(e.message); }
    });
  });
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

function playMsgSound() {
  try {
    const ctx = playMsgSound._ctx || (playMsgSound._ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.28);
  } catch {}
}

async function renderMessages(host) {
  stopMsgPoll();
  const isAdmin = user.role === 'admin';
  let activePeer = replyTarget ? { id: replyTarget.id, name: replyTarget.name } : null;
  let knownMsgIds = new Set();
  let typingTimer = null;

  host.innerHTML = `
    <div class="inbox">
      <aside class="conv-list" id="convList"><div class="loading">Loading…</div></aside>
      <section class="chat-pane">
        <div class="chat-header" id="chatHeader">
          <button type="button" class="chat-back hidden" id="chatBack">←</button>
          <div>
            <div class="chat-peer-name" id="chatPeerName">Select a chat</div>
            <div class="chat-peer-status" id="chatPeerStatus"></div>
          </div>
        </div>
        <div class="msg-list" id="msgList"><div class="empty">Choose a conversation on the left</div></div>
        <div class="typing-line hidden" id="typingLine">typing…</div>
        <div class="msg-compose hidden" id="composeBox">
          <textarea id="msgBody" rows="2" placeholder="Type a message…"></textarea>
          <button class="btn btn-primary btn-sm" id="sendMsg">Send</button>
        </div>
      </section>
    </div>`;

  const convList = $('#convList');
  const msgList = $('#msgList');
  const composeBox = $('#composeBox');
  const chatPeerName = $('#chatPeerName');
  const chatPeerStatus = $('#chatPeerStatus');
  const typingLine = $('#typingLine');
  const chatBack = $('#chatBack');

  function setActivePeer(peer) {
    activePeer = peer;
    replyTarget = peer ? { id: peer.id, name: peer.name } : null;
    if (peer) {
      chatPeerName.textContent = peer.name;
      composeBox.classList.remove('hidden');
      chatBack.classList.remove('hidden');
      host.querySelector('.inbox')?.classList.add('chat-open');
    } else {
      chatPeerName.textContent = 'Select a chat';
      chatPeerStatus.textContent = '';
      composeBox.classList.add('hidden');
      chatBack.classList.add('hidden');
      host.querySelector('.inbox')?.classList.remove('chat-open');
      msgList.innerHTML = '<div class="empty">Choose a conversation on the left</div>';
    }
  }

  async function loadConversations() {
    try {
      const rows = await api('/api/messages/conversations');
      if (!rows.length) {
        convList.innerHTML = '<div class="empty">No conversations yet</div>';
        return rows;
      }
      convList.innerHTML = rows.map(c => `
        <button type="button" class="conv-item ${activePeer && activePeer.id === c.userId ? 'active' : ''}" data-id="${esc(c.userId)}" data-name="${esc(c.name)}">
          <div class="conv-top">
            <span class="conv-name">${esc(c.name)}</span>
            <span class="conv-dot ${c.online ? 'online' : 'offline'}" title="${c.online ? 'Online' : 'Offline'}"></span>
          </div>
          <div class="conv-preview">${esc((c.lastMessage || '').slice(0, 48))}${c.lastMessage && c.lastMessage.length > 48 ? '…' : ''}</div>
          <div class="conv-meta">
            <span>${c.lastAt ? new Date(c.lastAt).toLocaleString() : ''}</span>
            ${c.unread > 0 ? `<span class="msg-badge">${c.unread}</span>` : ''}
          </div>
        </button>`).join('');
      return rows;
    } catch (e) {
      convList.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return [];
    }
  }

  async function loadThread(playSound = false) {
    if (!activePeer) return;
    try {
      const data = await api(`/api/messages/thread/${encodeURIComponent(activePeer.id)}`);
      const rows = data.messages || [];
      const peer = data.peer || {};

      if (playSound) {
        for (const m of rows) {
          if (!knownMsgIds.has(m.id) && m.from_user_id !== user.id) {
            playMsgSound();
            break;
          }
        }
      }
      knownMsgIds = new Set(rows.map(m => m.id));

      chatPeerStatus.innerHTML = peer.online
        ? '<span class="status-online">Online</span>'
        : '<span class="status-offline">Offline</span>';
      typingLine.classList.toggle('hidden', !peer.typing);
      if (peer.typing) typingLine.textContent = `${activePeer.name.split(' ')[0]} is typing…`;

      const wasAtBottom = msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight < 90;
      if (!rows.length) {
        msgList.innerHTML = '<div class="empty">No messages yet. Say hello 👋</div>';
      } else {
        msgList.innerHTML = rows.map(m => {
          const mine = m.from_user_id === user.id;
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `<div class="msg-row ${mine ? 'mine' : 'theirs'}"><div class="msg-bubble"><div class="msg-text">${esc(m.body)}</div><div class="meta">${esc(time)}</div></div></div>`;
        }).join('');
      }
      if (wasAtBottom || playSound) msgList.scrollTop = msgList.scrollHeight;
    } catch (e) {
      msgList.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  convList.addEventListener('click', async e => {
    const item = e.target.closest('.conv-item');
    if (!item) return;
    setActivePeer({ id: item.dataset.id, name: item.dataset.name });
    knownMsgIds = new Set();
    await loadThread(false);
    await loadConversations();
    try {
      const u = await api('/api/messages/unread-count');
      updateMsgBadge(u.count);
    } catch {}
  });

  chatBack?.addEventListener('click', async () => {
    setActivePeer(null);
    await loadConversations();
  });

  if (!isAdmin) {
    const rows = await loadConversations();
    if (rows[0]) {
      setActivePeer({ id: rows[0].userId, name: rows[0].name });
      await loadThread(false);
    }
  } else {
    await loadConversations();
  }

  $('#sendMsg')?.addEventListener('click', async () => {
    const body = $('#msgBody').value.trim();
    if (!body) return;
    if (!activePeer?.id) return toast('Select a conversation first');
    try {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ body, toUserId: activePeer.id })
      });
      $('#msgBody').value = '';
      await loadThread(false);
      await loadConversations();
    } catch (e) { toast(e.message); }
  });

  $('#msgBody')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#sendMsg')?.click();
    }
  });

  $('#msgBody')?.addEventListener('input', () => {
    if (!activePeer?.id) return;
    clearTimeout(typingTimer);
    api('/api/presence/typing', {
      method: 'POST',
      body: JSON.stringify({ toUserId: activePeer.id })
    }).catch(() => {});
    typingTimer = setTimeout(() => {
      api('/api/presence/typing', { method: 'POST', body: JSON.stringify({ toUserId: '' }) }).catch(() => {});
    }, 2500);
  });

  msgPollTimer = setInterval(async () => {
    api('/api/presence/ping', { method: 'POST' }).catch(() => {});
    await loadConversations();
    if (activePeer) await loadThread(true);
    try {
      const u = await api('/api/messages/unread-count');
      updateMsgBadge(u.count);
    } catch {}
  }, 3000);
}

async function renderOverview(host) {
  const st = await api('/api/admin/stats');
  host.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><strong>${st.pending}</strong><span>Pending requests</span></div>
      <div class="stat-card"><strong>${st.today.length}</strong><span>Today's appointments</span></div>
      <div class="stat-card"><strong>${st.unreadMessages}</strong><span>Unread messages</span></div>
      <div class="stat-card"><strong>${st.clients}</strong><span>Clients</span></div>
      <div class="stat-card"><strong>${st.completed}</strong><span>Completed</span></div>
    </div>
    <h3 style="margin:8px 0 10px;color:var(--plum)">Today · ${esc(st.date)}</h3>
    ${st.today.length ? `<div style="overflow-x:auto"><table class="dash-table"><thead><tr><th>Time</th><th>Client</th><th>Service</th><th>Status</th></tr></thead><tbody>
      ${st.today.map(b => `<tr><td>${esc(String(b.appointment_time).slice(0,5))}</td><td>${esc(b.customer_name)}</td><td>${esc(b.service_name)}</td><td><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No appointments today.</div>'}
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-outline btn-sm" href="/api/admin/bookings/export" target="_blank" rel="noopener">Export bookings CSV</a>
      <button type="button" class="btn btn-outline btn-sm" id="runReminders">Run tomorrow reminders</button>
    </div>
    <p class="muted" style="margin-top:8px">Reminders log to the server (or REMINDER_WEBHOOK if set).</p>`;
  $('#runReminders')?.addEventListener('click', async () => {
    try {
      const d = await api('/api/admin/reminders/run', { method: 'POST' });
      toast(`Reminders: ${d.found} found, ${d.sent} sent`);
    } catch (e) { toast(e.message); }
  });
}

async function renderAdminGallery(host) {
  const rows = await api('/api/admin/gallery');
  host.innerHTML = `
    <form id="galForm" class="service-form" style="margin-bottom:16px">
      <label>Title<input name="title" placeholder="Style name (optional)"></label>
      <label>Caption<input name="caption" placeholder="Optional note"></label>
      <label>Photo from your device
        <input type="file" id="galFile" accept="image/*" required>
      </label>
      <div id="galPreviewWrap" class="upload-preview hidden"><img id="galPreview" alt="Preview"></div>
      <button type="submit" class="btn btn-primary btn-sm" id="galSubmit">Upload photo</button>
    </form>
    <div class="gallery-grid">
      ${rows.length ? rows.map(g => `
        <article class="gallery-card">
          <img src="${esc(g.image_url)}" alt="${esc(g.title)}" loading="lazy">
          <div class="cap"><strong>${esc(g.title || 'Photo')}</strong>${esc(g.caption || '')}
            <button type="button" class="btn-sm btn-delete" data-del="${esc(g.id)}" style="margin-top:8px">Delete</button>
          </div>
        </article>`).join('') : '<div class="empty">No gallery photos yet. Upload from your phone or computer.</div>'}
    </div>`;
  let pendingDataUrl = '';
  $('#galFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast('Preparing photo…');
      pendingDataUrl = await readImageFileAsDataUrl(file, 1000, 0.7);
      const wrap = $('#galPreviewWrap');
      const img = $('#galPreview');
      if (img) img.src = pendingDataUrl;
      wrap?.classList.remove('hidden');
      toast('Photo ready — tap Upload');
    } catch (err) { pendingDataUrl = ''; toast(err.message); }
  });
  $('#galForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pendingDataUrl) return toast('Choose a photo first');
    const fd = new FormData(e.target);
    const btn = $('#galSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    try {
      await api('/api/admin/gallery', {
        method: 'POST',
        body: JSON.stringify({
          title: fd.get('title') || '',
          caption: fd.get('caption') || '',
          image_url: pendingDataUrl
        })
      });
      toast('Photo added');
      loadDashTab('gallery');
      loadGalleryPublic();
    } catch (err) { toast(err.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Upload photo'; } }
  });
  host.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this photo?')) return;
      try {
        await api(`/api/admin/gallery/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
        loadDashTab('gallery');
        loadGalleryPublic();
      } catch (e) { toast(e.message); }
    });
  });
}

async function renderAdminReviews(host) {
  const rows = await api('/api/admin/reviews');
  host.innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="dash-table">
    <thead><tr><th>Name</th><th>Rating</th><th>Comment</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td>${esc(r.customer_name)}</td>
        <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
        <td>${esc(r.comment)}</td>
        <td>${r.approved ? 'Live' : 'Pending'}</td>
        <td>
          ${!r.approved ? `<button class="btn-sm btn-confirm" data-approve="${esc(r.id)}">Approve</button>` : ''}
          ${r.approved ? `<button class="btn-sm btn-cancel" data-hide="${esc(r.id)}">Hide</button>` : ''}
        </td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No reviews yet.</div>';
  host.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/reviews/${encodeURIComponent(btn.dataset.approve)}`, { method: 'PATCH', body: JSON.stringify({ approved: true }) });
      loadDashTab('reviews');
      loadReviewsPublic();
    });
  });
  host.querySelectorAll('[data-hide]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/reviews/${encodeURIComponent(btn.dataset.hide)}`, { method: 'PATCH', body: JSON.stringify({ approved: false }) });
      loadDashTab('reviews');
      loadReviewsPublic();
    });
  });
}

async function renderStaff(host) {
  const rows = await api('/api/admin/staff');
  host.innerHTML = `
    <p class="muted">Promote an existing client account to staff/admin by email.</p>
    <form id="promoteForm" class="service-form" style="margin-bottom:16px">
      <label>Client email<input name="email" type="email" required placeholder="staff@email.com"></label>
      <button type="submit" class="btn btn-primary btn-sm">Promote to admin</button>
    </form>
    <table class="dash-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
    <tbody>${rows.map(u => `
      <tr>
        <td>${esc(u.full_name)}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.role)}</td>
        <td>${u.id !== user.id ? `<button class="btn-sm btn-cancel" data-demote="${esc(u.id)}">Demote</button>` : 'You'}</td>
      </tr>`).join('')}</tbody></table>`;
  $('#promoteForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/staff/promote', { method: 'POST', body: JSON.stringify({ email: e.target.email.value }) });
      toast('Promoted');
      loadDashTab('staff');
    } catch (err) { toast(err.message); }
  });
  host.querySelectorAll('[data-demote]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Demote this admin to client?')) return;
      try {
        await api('/api/admin/staff/demote', { method: 'POST', body: JSON.stringify({ userId: btn.dataset.demote }) });
        loadDashTab('staff');
      } catch (e) { toast(e.message); }
    });
  });
}

async function renderClientReview(host) {
  host.innerHTML = `
    <form id="reviewForm" class="profile-form">
      <p class="muted">Share how your visit went. Reviews appear after approval.</p>
      <label>Rating
        <select name="rating" required>
          <option value="5">5 ★★★★★</option>
          <option value="4">4 ★★★★</option>
          <option value="3">3 ★★★</option>
          <option value="2">2 ★★</option>
          <option value="1">1 ★</option>
        </select>
      </label>
      <label>Comment<textarea name="comment" rows="3" maxlength="500" placeholder="Optional feedback"></textarea></label>
      <button type="submit" class="btn btn-primary btn-sm">Submit review</button>
    </form>`;
  $('#reviewForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const d = await api('/api/reviews', { method: 'POST', body: JSON.stringify({ rating: Number(fd.get('rating')), comment: fd.get('comment') }) });
      toast(d.message || 'Thanks!');
      e.target.reset();
    } catch (err) { toast(err.message); }
  });
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
      <label>Theme
        <select name="theme_mode">
          <option value="light" ${(s.theme_mode || 'light') === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${s.theme_mode === 'dark' ? 'selected' : ''}>Dark</option>
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
      <div class="profile-avatar-row">
        <img id="profileAvatarPreview" class="profile-avatar-preview ${p.avatar_url ? '' : 'hidden'}" src="${esc(p.avatar_url || '')}" alt="">
        <div class="dash-avatar" id="profileAvatarFallback">${esc(logoInitials(p.full_name || p.email || 'U'))}</div>
      </div>
      <label>Profile photo
        <input type="file" id="avatarFile" accept="image/*">
      </label>
      <input type="hidden" name="avatarUrl" id="avatarUrlField" value="${esc(p.avatar_url || '')}">
      <p class="muted">Choose a photo from your phone or computer. Leave empty to keep initials.</p>
      <button type="button" class="btn btn-outline btn-sm" id="clearAvatar">Remove photo</button>
      <label>Full name<input name="fullName" value="${esc(p.full_name || '')}" required></label>
      <label>Email<input name="email" type="email" value="${esc(p.email || '')}" required></label>
      <label>Phone<input name="phone" value="${esc(p.phone || '')}"></label>
      <hr style="border:none;border-top:1px solid var(--line);margin:8px 0">
      <p class="muted">Change password (optional)</p>
      <label>Current password<input name="currentPassword" type="password"></label>
      <label>New password<input name="newPassword" type="password" minlength="8"></label>
      <p class="muted">Forgot password? Sign out, open Log in → Forgot password.</p>
      <button type="submit" class="btn btn-primary btn-sm">Save profile</button>
      <button type="button" class="btn btn-outline btn-sm" id="logoutBtn" style="margin-top:8px">Sign out</button>
    </form>`;
  $('#avatarFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast('Preparing photo…');
      const dataUrl = await readImageFileAsDataUrl(file, 500, 0.75);
      const field = $('#avatarUrlField');
      if (field) field.value = dataUrl;
      const prev = $('#profileAvatarPreview');
      const fb = $('#profileAvatarFallback');
      if (prev) { prev.src = dataUrl; prev.classList.remove('hidden'); }
      fb?.classList.add('hidden');
      toast('Photo ready — save profile');
    } catch (err) { toast(err.message); }
  });
  $('#clearAvatar')?.addEventListener('click', () => {
    const field = $('#avatarUrlField');
    if (field) field.value = '';
    if ($('#avatarFile')) $('#avatarFile').value = '';
    $('#profileAvatarPreview')?.classList.add('hidden');
    $('#profileAvatarFallback')?.classList.remove('hidden');
  });
  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (!body.currentPassword) delete body.currentPassword;
    if (!body.newPassword) delete body.newPassword;
    try {
      const updated = await api('/api/profile', { method: 'PATCH', body: JSON.stringify(body) });
      user = { ...user, email: updated.email, fullName: updated.full_name, avatarUrl: updated.avatar_url || '' };
      updateAuthBtn();
      const dn = (user.fullName && user.fullName.trim()) ? user.fullName.trim() : user.email;
      $('#dashUser').textContent = dn + (user.email ? ' · ' + user.email : '');
      if ($('#dashSideName')) $('#dashSideName').textContent = dn;
      if ($('#dashSideEmail')) $('#dashSideEmail').textContent = user.email || '';
      setUserAvatarUI(dn, user.avatarUrl);
      toast('Profile updated');
    } catch (err) { toast(err.message); }
  });
  $('#logoutBtn')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    user = null;
    updateAuthBtn();
    closeDash();
    setAppMode('app');
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


function setUserAvatarUI(name, avatarUrl) {
  const img = $('#dashAvatarImg');
  const fallback = $('#dashAvatar');
  const url = (avatarUrl || '').trim();
  if (img && url) {
    img.src = url;
    img.classList.remove('hidden');
    fallback?.classList.add('hidden');
  } else {
    img?.classList.add('hidden');
    if (fallback) {
      fallback.classList.remove('hidden');
      fallback.textContent = logoInitials(name || 'U');
    }
  }
}


function readImageFileAsDataUrl(file, maxSide = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected'));
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image (JPG, PNG, etc.)'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Image must be under 10MB'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not process image'));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
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
  document.body.classList.toggle('theme-dark', (config.themeMode || 'light') === 'dark');
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
    logoStyle: cfg.logoStyle,
    themeMode: cfg.themeMode
  };
  applyBranding();
  renderServices();
  loadGalleryPublic();
  loadReviewsPublic();
  const dateInput = $('#bookingForm [name=date]');
  if (dateInput) {
    dateInput.min = todayLocal();
    dateInput.value = todayLocal();
  }
}

function bindEvents() {
  $('#menuToggle')?.addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#authBtn')?.addEventListener('click', () => { if (user) { setAppMode('app'); openDash(); } else openAuth('login'); });
  
  $('#appHomeLogin')?.addEventListener('click', () => openAuth('login'));
  $('#appHomeSignup')?.addEventListener('click', () => openAuth('signup'));
  $('#appHomeForgot')?.addEventListener('click', () => openAuth('forgot'));
  $('#appHomeTerms')?.addEventListener('click', () => $('#termsModal')?.classList.remove('hidden'));
  $('#termsClose')?.addEventListener('click', () => $('#termsModal')?.classList.add('hidden'));
  $('#termsOk')?.addEventListener('click', () => $('#termsModal')?.classList.add('hidden'));

  $('#loginNavBtn')?.addEventListener('click', () => openAuth('login'));
  $('#signupNavBtn')?.addEventListener('click', () => openAuth('signup'));
  $('#dashSignOut')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    user = null;
    updateAuthBtn();
    closeDash();
    toast('Signed out');
  });
  $('#dashBurger')?.addEventListener('click', () => {
    $('#dashSidebar')?.classList.toggle('nav-open');
  });
  $('#dashProfileCard')?.addEventListener('click', () => {
    document.querySelectorAll('.dash-tab').forEach(x => x.classList.remove('active'));
    loadDashTab('profile');
  });
  $('#authClose')?.addEventListener('click', closeAuth);
  $('#dashClose')?.addEventListener('click', goToWebsite);
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
      setAppMode('app');
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


async function loadGalleryPublic() {
  const grid = $('#galleryGrid');
  if (!grid) return;
  try {
    const rows = await api('/api/gallery');
    grid.innerHTML = rows.length
      ? rows.map(g => `<article class="gallery-card"><img src="${esc(g.image_url)}" alt="${esc(g.title)}" loading="lazy"><div class="cap"><strong>${esc(g.title || '')}</strong>${esc(g.caption || '')}</div></article>`).join('')
      : '<div class="empty-state">Gallery photos coming soon.</div>';
  } catch {
    grid.innerHTML = '<div class="empty-state">Gallery unavailable.</div>';
  }
}

async function loadReviewsPublic() {
  const grid = $('#reviewsGrid');
  if (!grid) return;
  try {
    const rows = await api('/api/reviews');
    grid.innerHTML = rows.length
      ? rows.map(r => `<article class="review-card"><div class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div><p>${esc(r.comment || 'Great experience.')}</p><div class="who">— ${esc(r.customer_name)}</div></article>`).join('')
      : '<div class="empty-state">Be the first to leave a review after your visit.</div>';
  } catch {
    grid.innerHTML = '<div class="empty-state">Reviews unavailable.</div>';
  }
}

// Boot - force all modals closed on load
document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.body.classList.remove('dash-open');
  $('#dashModal')?.classList.add('hidden');
bindEvents();
checkAuth()
  .then(() => loadPublic())
  .then(() => {
    // Brand app home
    if ($('#appHomeName')) $('#appHomeName').textContent = (config.name || 'Pinnacle').split(' ')[0];
    if ($('#appHomeTag') && config.tagline) $('#appHomeTag').textContent = config.tagline;
    document.querySelectorAll('#appHome .brand-mark').forEach(el => {
      el.textContent = logoInitials(config.name || 'P');
      el.dataset.style = config.logoStyle || 'gradient';
    });
    let mode = 'app';
    try { mode = sessionStorage.getItem('pinnacle_mode') || 'app'; } catch {}
    if (user) {
      setAppMode('app');
      openDash();
    } else {
      setAppMode(mode === 'website' ? 'website' : 'app');
    }
  })
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