'use strict';
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? '' : 'local-development-secret-change-this-before-deploying');
if (isProd && (!SESSION_SECRET || SESSION_SECRET.length < 32)) throw new Error('SESSION_SECRET must be at least 32 characters in production.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const presenceMap = new Map();
const salon = {
  name: process.env.SALON_NAME || 'Pinnacle BeautyParlour',
  whatsapp: process.env.SALON_WHATSAPP || '',
  currency: process.env.SALON_CURRENCY || 'KSh',
  timeZone: process.env.TIME_ZONE || 'Africa/Nairobi'
};

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith('/api/media') || req.path.startsWith('/api/avatar')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Store media in Postgres so files survive Render restarts
function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only photos and videos are allowed'));
  }
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1h' : 0, etag: true }));

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function setAuthCookie(res, token) {
  res.cookie('pinnacle_session', token, {
    httpOnly: true, secure: isProd, sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, path: '/'
  });
}
function clearAuthCookie(res) {
  res.clearCookie('pinnacle_session', { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/' });
}
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const p of header.split(';')) {
    const i = p.indexOf('=');
    if (i > -1 && p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return '';
}
function requireAuth(req, res, next) {
  const user = verifyToken(getCookie(req, 'pinnacle_session'));
  if (!user || !user.id) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}
function optionalAuth(req, res, next) {
  const user = verifyToken(getCookie(req, 'pinnacle_session'));
  if (user && user.id) req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  const user = verifyToken(getCookie(req, 'pinnacle_session'));
  if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Please sign in as the salon owner.' });
  req.admin = user;
  req.user = user;
  next();
}
function cleanText(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function validTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function makeId(prefix = 'U') {
  return prefix + '-' + crypto.randomBytes(5).toString('hex').toUpperCase();
}
const defaultServices = [
  ['hair', 'Hair styling', 'Wash, blow-dry & style', 'Wash, blow-dry and a polished everyday finish.', 1500, 60, '✂', true],
  ['silk-press', 'Hair styling', 'Silk press', 'A smooth, sleek finish for natural hair.', 2500, 120, '✂', true],
  ['wash-set', 'Hair styling', 'Shampoo & set', 'Cleansing, setting and a salon-finished look.', 1200, 60, '✧', true],
  ['roller-set', 'Hair styling', 'Roller setting', 'Classic rollers for volume and bounce.', 1200, 60, '✧', true],
  ['haircut-trim', 'Hair styling', 'Haircut or trim', 'Shape and refresh your hairstyle.', 800, 30, '✂', true],
  ['blow-dry', 'Hair styling', 'Blow-dry', 'Professional blow-dry finish.', 1000, 40, '✧', true],
  ['updo', 'Hair styling', 'Evening updo', 'An elegant style for special occasions.', 2500, 75, '✦', true],
  ['bridal-hair', 'Hair styling', 'Bridal hairstyling', 'Wedding-day styling consultation and finish.', 5000, 120, '✦', true],
  ['hair-colour', 'Hair colouring', 'Full hair colour', 'All-over colour service; consultation may be needed.', 3500, 120, '🎨', true],
  ['highlights', 'Hair colouring', 'Highlights', 'Dimension and brightness with highlights.', 4500, 150, '🎨', true],
  ['balayage', 'Hair colouring', 'Balayage', 'Hand-painted colour for a dimensional look.', 6500, 180, '🎨', true],
  ['root-touchup', 'Hair colouring', 'Root touch-up', 'Refresh regrowth with matching colour.', 2500, 75, '🎨', true],
  ['relaxer', 'Hair treatments', 'Relaxer application', 'Chemical straightening service after consultation.', 2500, 90, '❀', true],
  ['relaxer-touchup', 'Hair treatments', 'Relaxer touch-up', 'Retouch new growth after consultation.', 1800, 75, '❀', true],
  ['deep-condition', 'Hair treatments', 'Deep conditioning', 'Moisture-focused conditioning treatment.', 1200, 40, '❀', true],
  ['protein-treatment', 'Hair treatments', 'Protein treatment', 'Strength-focused treatment selected for hair needs.', 1800, 45, '❀', true],
  ['steam-treatment', 'Hair treatments', 'Hair steaming treatment', 'Steam-assisted conditioning treatment.', 1500, 45, '❀', true],
  ['scalp-treatment', 'Hair treatments', 'Scalp care treatment', 'Targeted scalp care and cleansing.', 1500, 45, '❀', true],
  ['keratin-treatment', 'Hair treatments', 'Smoothing treatment', 'Smoothing service; suitability consultation required.', 6500, 180, '❀', true],
  ['hair-reconstruction', 'Hair treatments', 'Hair reconstruction', 'Intensive conditioning and strengthening ritual.', 2500, 60, '❀', true],
  ['braids', 'Braids & twists', 'Box braids', 'Classic protective box braids.', 3500, 240, '❋', true],
  ['knotless-braids', 'Braids & twists', 'Knotless braids', 'Lightweight knotless protective braids.', 5000, 300, '❋', true],
  ['small-knotless', 'Braids & twists', 'Small knotless braids', 'Fine-part knotless braids; duration varies by length.', 7500, 360, '❋', true],
  ['cornrows', 'Braids & twists', 'Cornrows', 'Classic cornrow styling.', 1500, 90, '❋', true],
  ['feed-in', 'Braids & twists', 'Feed-in braids', 'Neat feed-in braiding style.', 2500, 150, '❋', true],
  ['ghana-weaving', 'Braids & twists', 'Ghana weaving', 'Traditional Ghana weaving style.', 2000, 120, '❋', true],
  ['fulani-braids', 'Braids & twists', 'Fulani braids', 'Decorative Fulani-inspired braid style.', 4500, 240, '❋', true],
  ['passion-twists', 'Braids & twists', 'Passion twists', 'Textured twist protective style.', 4500, 240, '❋', true],
  ['senegalese-twists', 'Braids & twists', 'Senegalese twists', 'Smooth two-strand twist extensions.', 4500, 240, '❋', true],
  ['faux-locs', 'Braids & twists', 'Faux locs', 'Protective faux loc installation.', 5000, 300, '❋', true],
  ['crochet-braids', 'Braids & twists', 'Crochet braids', 'Crochet protective style installation.', 2500, 120, '❋', true],
  ['braid-removal', 'Braids & twists', 'Braid or extension removal', 'Careful removal of braids or extensions.', 1000, 60, '❋', true],
  ['natural-wash', 'Natural hair', 'Natural hair wash & condition', 'Cleansing and conditioning for natural hair.', 1000, 45, '❀', true],
  ['twist-out', 'Natural hair', 'Twist-out styling', 'Defined natural curl styling.', 1500, 60, '❀', true],
  ['loc-retwist', 'Locs', 'Loc retwist', 'Maintenance and neat retwisting of locs.', 2000, 120, '❋', true],
  ['loc-style', 'Locs', 'Loc styling', 'Style and finish existing locs.', 1000, 45, '❋', true],
  ['loc-repair', 'Locs', 'Loc repair consultation', 'Assessment and maintenance for damaged locs.', 1500, 60, '❋', true],
  ['wig-install', 'Wigs & extensions', 'Wig installation', 'Secure wig installation and styling.', 2500, 90, '✦', true],
  ['wig-customize', 'Wigs & extensions', 'Wig customization', 'Customise hairline and fit where appropriate.', 2000, 60, '✦', true],
  ['wig-wash', 'Wigs & extensions', 'Wig wash & style', 'Clean, condition and style a wig.', 1500, 60, '✦', true],
  ['wig-revamp', 'Wigs & extensions', 'Wig revamp', 'Refresh an existing wig; assessment first.', 2500, 90, '✦', true],
  ['extensions-install', 'Wigs & extensions', 'Hair extensions installation', 'Extension installation based on method and length.', 3500, 150, '✦', true],
  ['manicure', 'Nails', 'Classic manicure', 'Nail shaping, cuticle care and polish.', 800, 40, '✧', true],
  ['luxury-manicure', 'Nails', 'Luxury spa manicure', 'Extended hand care and nourishing finish.', 1500, 60, '✧', true],
  ['gel-manicure', 'Nails', 'Gel manicure', 'Long-wear gel colour and finish.', 1500, 60, '✧', true],
  ['acrylic-fullset', 'Nails', 'Acrylic full set', 'Acrylic nail extensions with basic finish.', 2500, 100, '✧', true],
  ['builder-gel', 'Nails', 'Builder gel overlay', 'Structured gel overlay on natural nails.', 2200, 75, '✧', true],
  ['gel-extensions', 'Nails', 'Gel extensions', 'Extensions with gel system.', 3000, 120, '✧', true],
  ['french-tips', 'Nails', 'French tips', 'Classic French nail finish.', 1800, 70, '✧', true],
  ['nail-art', 'Nails', 'Custom nail art', 'Decorative nail art; complexity affects price.', 500, 30, '✧', true],
  ['nail-repair', 'Nails', 'Nail repair', 'Repair of one or more damaged nails.', 300, 20, '✧', true],
  ['nail-removal', 'Nails', 'Artificial nail removal', 'Safe removal of enhancements.', 700, 35, '✧', true],
  ['pedicure', 'Pedicure & foot care', 'Classic pedicure', 'Foot soak, nail care and polish.', 1200, 50, '✧', true],
  ['spa-pedicure', 'Pedicure & foot care', 'Luxury spa pedicure', 'Extended exfoliation and foot-care ritual.', 2000, 75, '✧', true],
  ['gel-pedicure', 'Pedicure & foot care', 'Gel pedicure', 'Pedicure with long-wear gel polish.', 1800, 60, '✧', true],
  ['foot-scrub', 'Pedicure & foot care', 'Foot scrub & soak', 'Refreshing exfoliation and soak.', 800, 30, '✧', true],
  ['facial', 'Facials & skincare', 'Classic facial', 'Cleansing, exfoliation, mask and moisturising.', 2000, 50, '☼', true],
  ['deep-cleanse', 'Facials & skincare', 'Deep-cleansing facial', 'A thorough cleansing facial tailored to skin.', 2500, 60, '☼', true],
  ['hydrating-facial', 'Facials & skincare', 'Hydrating facial', 'Moisture-focused facial ritual.', 2500, 60, '☼', true],
  ['brightening-facial', 'Facials & skincare', 'Brightening facial', 'Glow-focused facial; results vary by skin.', 2800, 60, '☼', true],
  ['acne-facial', 'Facials & skincare', 'Blemish-care facial', 'Gentle facial for blemish-prone skin.', 2800, 60, '☼', true],
  ['sensitive-facial', 'Facials & skincare', 'Sensitive-skin facial', 'Gentle products selected after consultation.', 2500, 50, '☼', true],
  ['face-mask', 'Facials & skincare', 'Express face mask', 'Quick mask and moisturising treatment.', 800, 25, '☼', true],
  ['skin-consult', 'Facials & skincare', 'Skincare consultation', 'Discuss skin goals and suitable salon treatments.', 500, 20, '☼', true],
  ['makeup-natural', 'Makeup', 'Natural makeup', 'Everyday natural makeup look.', 2000, 45, '◉', true],
  ['makeup-glam', 'Makeup', 'Glam makeup', 'Full glam look for events.', 3500, 75, '◉', true],
  ['makeup-bridal', 'Makeup', 'Bridal makeup', 'Wedding-day makeup with trial option.', 6000, 90, '◉', true],
  ['makeup-lesson', 'Makeup', 'Makeup lesson', 'One-to-one makeup guidance.', 3000, 90, '◉', true],
  ['brow-shape', 'Brows & lashes', 'Eyebrow shaping', 'Shape brows to suit your features.', 500, 20, '✦', true],
  ['brow-thread', 'Brows & lashes', 'Eyebrow threading', 'Threading for neat brow definition.', 400, 15, '✦', true],
  ['brow-tint', 'Brows & lashes', 'Brow tint', 'Tint brows for a fuller-looking finish.', 800, 25, '✦', true],
  ['brow-lamination', 'Brows & lashes', 'Brow lamination', 'Set and shape brow hairs.', 1800, 45, '✦', true],
  ['classic-lashes', 'Brows & lashes', 'Classic lash extensions', 'Natural-looking individual lash extensions.', 2500, 90, '✦', true],
  ['hybrid-lashes', 'Brows & lashes', 'Hybrid lash extensions', 'Blend of classic and volume lashes.', 3500, 105, '✦', true],
  ['volume-lashes', 'Brows & lashes', 'Volume lash extensions', 'Fuller volume lash set.', 4500, 120, '✦', true],
  ['lash-refill', 'Brows & lashes', 'Lash refill', 'Maintenance refill for existing extensions.', 1800, 60, '✦', true],
  ['lash-lift', 'Brows & lashes', 'Lash lift', 'Lift and curl natural lashes.', 2000, 45, '✦', true],
  ['lash-tint', 'Brows & lashes', 'Lash tint', 'Tint natural lashes.', 700, 20, '✦', true],
  ['upperlip-wax', 'Waxing & body care', 'Upper-lip waxing', 'Quick upper-lip hair removal.', 300, 10, '❀', true],
  ['chin-wax', 'Waxing & body care', 'Chin waxing', 'Targeted facial waxing.', 300, 10, '❀', true],
  ['underarm-wax', 'Waxing & body care', 'Underarm waxing', 'Underarm hair removal.', 700, 20, '❀', true],
  ['half-leg-wax', 'Waxing & body care', 'Half-leg waxing', 'Hair removal for lower or upper legs.', 1200, 30, '❀', true],
  ['full-leg-wax', 'Waxing & body care', 'Full-leg waxing', 'Hair removal for both full legs.', 2200, 45, '❀', true],
  ['arm-wax', 'Waxing & body care', 'Arm waxing', 'Hair removal for arms.', 1200, 30, '❀', true],
  ['bikini-wax', 'Waxing & body care', 'Bikini waxing', 'Bikini-line hair removal.', 1500, 25, '❀', true],
  ['body-scrub', 'Spa & body', 'Body scrub', 'Body exfoliation and moisturising.', 2500, 60, '☼', true],
  ['relax-massage', 'Spa & body', 'Relaxation massage', 'Relaxation-focused massage by qualified staff.', 3000, 60, '☼', true],
  ['back-massage', 'Spa & body', 'Back massage', 'Focused back and shoulder massage.', 1800, 30, '☼', true],
  ['bridal-package', 'Packages & occasions', 'Bridal beauty package', 'Consultation-based hair and makeup package.', 15000, 240, '✦', true],
  ['graduation-package', 'Packages & occasions', 'Graduation glam package', 'Makeup and hairstyling for graduation.', 6000, 150, '✦', true],
  ['birthday-package', 'Packages & occasions', 'Birthday glam package', 'Special-occasion hair and makeup package.', 6500, 150, '✦', true],
  ['consultation', 'Consultations', 'Beauty consultation', 'Discuss services, style options and estimates.', 0, 20, '✧', true],
  ['mens-haircut', "Men's grooming", "Men's haircut", 'Classic haircut and finish.', 800, 30, '✂', true],
  ['mens-fade', "Men's grooming", 'Fade haircut', 'Precision fade and finish.', 1000, 40, '✂', true],
  ['beard-trim', "Men's grooming", 'Beard trim & shaping', 'Beard grooming and outline.', 500, 20, '✂', true],
  ['mens-facial', "Men's grooming", "Men's facial", 'Cleansing and moisturising facial.', 1800, 45, '☼', true],
  ['kids-style', "Children's services", "Children's hairstyling", 'Age-appropriate styling; parent/guardian present.', 800, 45, '✂', true]
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','admin')),
      reset_token TEXT,
      reset_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users(email)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'Other',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL CHECK(price >= 0),
      duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 600),
      icon TEXT NOT NULL DEFAULT '✧',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS services_active_category_idx ON services(active, category)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service_id TEXT NOT NULL REFERENCES services(id) ON UPDATE CASCADE,
      service_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Requested' CHECK(status IN ('Requested','Confirmed','Completed','Cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Migrate older databases that lack user_id
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(appointment_date, appointment_time)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_status_date_idx ON bookings(status, appointment_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
      from_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('client','admin')),
      body TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_to_user_idx ON messages(to_user_id, read)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gallery (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`);
  await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS media_data BYTEA`);
  // Remove broken disk uploads that no longer exist after Render restarts
  await pool.query(`DELETE FROM gallery WHERE image_url LIKE '/uploads/%' AND media_data IS NULL`);
  await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT NOT NULL DEFAULT ''`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gallery_likes (
      gallery_id TEXT NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
      visitor_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (gallery_id, visitor_key)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gallery_comments (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
      visitor_key TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT 'Guest',
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS gallery_comments_gid ON gallery_comments(gallery_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS reviews_approved_idx ON reviews(approved, created_at DESC)`);

  // staff = users with role admin; allow promoting clients via admin endpoint


  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT ''`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS salon_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  for (const s of defaultServices) {
    await pool.query(
      'INSERT INTO services(id,category,name,description,price,duration,icon,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',
      s
    );
  }

  const settings = [
    ['salon_name', salon.name],
    ['whatsapp', salon.whatsapp],
    ['opening_time', '09:00'],
    ['closing_time', '18:00'],
    ['slot_interval', '30'],
    ['closed_days', '0'],
    ['business_type', 'Beauty Salon'],
    ['tagline', 'Beauty, beautifully done.'],
    ['color_primary', '#391b31'],
    ['color_accent', '#b86e82'],
    ['color_cream', '#fffaf6'],
    ['logo_style', 'gradient'],
    ['theme_mode', 'light']
  ];
  for (const [k, v] of settings) {
    await pool.query('INSERT INTO salon_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [k, v]);
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'owner@example.com').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'local-owner-password-change-me';
  const existing = await pool.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
  if (!existing.rowCount) {
    const hash = await bcrypt.hash(adminPass, 12);
    await pool.query(
      'INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING',
      [makeId('ADM'), adminEmail, hash, 'Salon Owner', 'admin']
    );
    console.log('Default admin user created:', adminEmail);
  }
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Wait 15 minutes.' } });
const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many booking requests. Please wait a little.' } });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-up attempts. Try again later.' } });
app.get('/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'Pinnacle BeautyParlour', database: 'connected', version: '3.0' });
}));

app.get('/api/config', asyncRoute(async (req, res) => {
  const r = await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('salon_name','whatsapp','currency','timeZone','business_type','tagline','opening_time','closing_time','color_primary','color_accent','color_cream','logo_style','theme_mode')");
  const s = Object.fromEntries(r.rows.map(x => [x.key, x.value]));
  res.json({
    name: s.salon_name || salon.name,
    currency: s.currency || salon.currency,
    timeZone: s.timeZone || salon.timeZone,
    whatsapp: s.whatsapp || salon.whatsapp,
    businessType: s.business_type || 'Beauty Salon',
    tagline: s.tagline || 'Beauty, beautifully done.',
    openingTime: s.opening_time || '09:00',
    closingTime: s.closing_time || '18:00',
    colorPrimary: s.color_primary || '#391b31',
    colorAccent: s.color_accent || '#b86e82',
    colorCream: s.color_cream || '#fffaf6',
    logoStyle: s.logo_style || 'gradient',
    themeMode: s.theme_mode || 'light'
  });
}));

app.get('/api/services', asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,category,name,description,price,duration,icon FROM services WHERE active=TRUE ORDER BY category,name');
  res.json(r.rows);
}));

app.get('/api/settings', asyncRoute(async (req, res) => {
  const r = await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('salon_name','whatsapp','opening_time','closing_time','slot_interval','closed_days','business_type','tagline')");
  res.json(Object.fromEntries(r.rows.map(x => [x.key, x.value])));
}));

app.get('/api/me', (req, res) => {
  const u = verifyToken(getCookie(req, 'pinnacle_session'));
  if (!u) return res.json({ authenticated: false });
  res.json({ authenticated: true, id: u.id, email: u.email, role: u.role, fullName: u.fullName || '' });
});

app.post('/api/auth/signup', signupLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const fullName = cleanText(req.body.fullName || req.body.name, 100);
  const phone = cleanText(req.body.phone, 30).replace(/[\s()-]/g, '');
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (exists.rowCount) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  const hash = await bcrypt.hash(password, 12);
  const id = makeId('CLT');
  await pool.query('INSERT INTO users(id,email,password_hash,full_name,phone,role) VALUES($1,$2,$3,$4,$5,$6)', [id, email, hash, fullName, phone, 'client']);
  const token = signToken({ id, email, role: 'client', fullName });
  setAuthCookie(res, token);
  res.status(201).json({ ok: true, id, email, role: 'client', fullName });
}));

app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!validEmail(email) || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const r = await pool.query('SELECT id,email,password_hash,full_name,role,phone FROM users WHERE email=$1', [email]);
  if (!r.rowCount) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const user = r.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = signToken({ id: user.id, email: user.email, role: user.role, fullName: user.full_name });
  setAuthCookie(res, token);
  res.json({ ok: true, id: user.id, email: user.email, role: user.role, fullName: user.full_name, phone: user.phone });
}));

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/forgot-password', loginLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  const r = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (!r.rowCount) return res.json({ ok: true, message: 'If that email exists, a reset link has been prepared.' });
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query('UPDATE users SET reset_token=$1, reset_expires=$2, updated_at=NOW() WHERE id=$3', [token, expires, r.rows[0].id]);
  res.json({ ok: true, message: 'Password reset token generated. In production this would be emailed.', resetToken: isProd ? undefined : token });
}));

app.post('/api/auth/reset-password', loginLimiter, asyncRoute(async (req, res) => {
  const token = cleanText(req.body.token, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!token || password.length < 8) return res.status(400).json({ error: 'Valid token and new password (8+ characters) required.' });
  const r = await pool.query('SELECT id FROM users WHERE reset_token=$1 AND reset_expires > NOW()', [token]);
  if (!r.rowCount) return res.status(400).json({ error: 'Invalid or expired reset token.' });
  const hash = await bcrypt.hash(password, 12);
  await pool.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL, updated_at=NOW() WHERE id=$2', [hash, r.rows[0].id]);
  res.json({ ok: true, message: 'Password updated. You can now sign in.' });
}));

app.get('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,email,full_name,phone,role,avatar_url,created_at FROM users WHERE id=$1', [req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'User not found.' });
  res.json(r.rows[0]);
}));

app.patch('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const fullName = req.body.fullName !== undefined ? cleanText(req.body.fullName, 100) : undefined;
  const phone = req.body.phone !== undefined ? cleanText(req.body.phone, 30).replace(/[\s()-]/g, '') : undefined;
  const email = req.body.email !== undefined ? cleanText(req.body.email, 200).toLowerCase() : undefined;
  const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (email && !validEmail(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (fullName !== undefined && fullName.length < 2) return res.status(400).json({ error: 'Name too short.' });
  if (email) {
    const clash = await pool.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [email, req.user.id]);
    if (clash.rowCount) return res.status(409).json({ error: 'Email already in use.' });
  }
  if (newPassword) {
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const u = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
  }
  const sets = []; const vals = []; let i = 1;
  if (fullName !== undefined) { sets.push(`full_name=$${i++}`); vals.push(fullName); }
  if (phone !== undefined) { sets.push(`phone=$${i++}`); vals.push(phone); }
  if (email !== undefined) { sets.push(`email=$${i++}`); vals.push(email); }
  if (sets.length) {
    sets.push('updated_at=NOW()');
    vals.push(req.user.id);
    await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
  }
  const updated = await pool.query('SELECT id,email,full_name,phone,role FROM users WHERE id=$1', [req.user.id]);
  const token = signToken({ id: updated.rows[0].id, email: updated.rows[0].email, role: updated.rows[0].role, fullName: updated.rows[0].full_name });
  setAuthCookie(res, token);
  res.json(updated.rows[0]);
}));

app.post('/api/bookings', bookingLimiter, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const phone = cleanText(req.body.phone, 30).replace(/[\s()-]/g, '');
  const serviceId = cleanText(req.body.service, 80);
  const date = cleanText(req.body.date, 10);
  const time = cleanText(req.body.time, 5);
  const notes = cleanText(req.body.notes, 500);
  const session = verifyToken(getCookie(req, 'pinnacle_session'));
  const userId = session && session.role === 'client' ? session.id : null;
  if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!/^\+?[0-9]{9,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: salon.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const todayObj = Object.fromEntries(todayParts.map(x => [x.type, x.value]));
  const today = `${todayObj.year}-${todayObj.month}-${todayObj.day}`;
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: salon.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  if (!validDate(date) || date < today) return res.status(400).json({ error: 'Choose a valid future date.' });
  if (!validTime(time)) return res.status(400).json({ error: 'Choose a valid appointment time.' });
  if (date === today && time <= `${nowParts.hour}:${nowParts.minute}`) return res.status(400).json({ error: 'Choose a time later than now.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [date]);
    const sr = await client.query('SELECT id,name,price,duration FROM services WHERE id=$1 AND active=TRUE', [serviceId]);
    if (!sr.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'That service is no longer available.' }); }
    const svc = sr.rows[0];
    const setR = await client.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time','closed_days','slot_interval','whatsapp')");
    const sets = Object.fromEntries(setR.rows.map(x => [x.key, x.value]));
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const closed = (sets.closed_days || '').split(',').map(Number).filter(n => !Number.isNaN(n));
    if (closed.includes(day)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The salon is closed on this day.' }); }
    const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const start = toMins(time);
    const open = toMins(sets.opening_time || '09:00');
    const close = toMins(sets.closing_time || '18:00');
    if (start < open || start + Number(svc.duration) > close) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Choose a time between ${sets.opening_time || '09:00'} and ${sets.closing_time || '18:00'}.` }); }
    if ((start - open) % Math.max(5, Number(sets.slot_interval) || 30) !== 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Choose a listed appointment time.' }); }
    const overlap = await client.query(`SELECT id FROM bookings WHERE appointment_date=$1 AND status IN ('Requested','Confirmed') AND (appointment_time, appointment_time + (duration * INTERVAL '1 minute')) OVERLAPS ($2::time, $2::time + ($3 * INTERVAL '1 minute')) LIMIT 1`, [date, time, svc.duration]);
    if (overlap.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That time has just been taken. Please choose another slot.' }); }
    const id = 'PB-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const inserted = await client.query(`INSERT INTO bookings(id,user_id,customer_name,phone,service_id,service_name,price,duration,appointment_date,appointment_time,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,customer_name,phone,service_name,price,duration,appointment_date,appointment_time,notes,status,created_at`, [id, userId, name, phone, svc.id, svc.name, svc.price, svc.duration, date, time, notes]);
    await client.query('COMMIT');
    const whatsapp = sets.whatsapp || salon.whatsapp;
    res.status(201).json({
      message: 'Appointment request received. The salon will confirm with you.',
      booking: inserted.rows[0],
      whatsapp,
      contactOptions: {
        whatsapp: whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I just requested a booking (${id}) for ${svc.name} on ${date} at ${time}. My name is ${name}.`)}` : null,
        call: whatsapp ? `tel:+${whatsapp.replace(/\D/g, '')}` : null,
        sms: whatsapp ? `sms:+${whatsapp.replace(/\D/g, '')}?body=${encodeURIComponent(`Hi, booking request ${id} for ${svc.name} on ${date} at ${time}.`)}` : null
      }
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

app.get('/api/availability', asyncRoute(async (req, res) => {
  const date = cleanText(req.query.date, 10);
  const serviceId = cleanText(req.query.service, 80);
  if (!validDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: salon.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  if (date < today) return res.json({ slots: [], closed: false });
  const sr = await pool.query('SELECT duration FROM services WHERE id=$1 AND active=TRUE', [serviceId]);
  if (!sr.rowCount) return res.status(400).json({ error: 'Choose a service.' });
  const rr = await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time','slot_interval','closed_days')");
  const s = Object.fromEntries(rr.rows.map(x => [x.key, x.value]));
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const closedDays = (s.closed_days || '').split(',').map(Number).filter(n => !Number.isNaN(n));
  if (closedDays.includes(day)) return res.json({ slots: [], closed: true });
  const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const open = mins(s.opening_time || '09:00');
  const close = mins(s.closing_time || '18:00');
  const step = Math.max(5, Number(s.slot_interval) || 30);
  const duration = Number(sr.rows[0].duration);
  const booked = await pool.query("SELECT appointment_time::text AS time,duration FROM bookings WHERE appointment_date=$1 AND status IN ('Requested','Confirmed')", [date]);
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: salon.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const currentDayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: salon.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const currentDay = `${currentDayParts.year}-${currentDayParts.month}-${currentDayParts.day}`;
  const nowMins = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  const slots = [];
  for (let t = open; t + duration <= close; t += step) {
    if (date === currentDay && t <= nowMins) continue;
    const taken = booked.rows.some(b => {
      const bt = mins(String(b.time).slice(0, 5));
      return t < bt + Number(b.duration) && bt < t + duration;
    });
    if (!taken) slots.push(fmt(t));
  }
  res.json({ slots, openingTime: s.opening_time || '09:00', closingTime: s.closing_time || '18:00' });
}));

app.get('/api/my/bookings', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Clients only.' });
  const r = await pool.query('SELECT id,service_name,price,duration,appointment_date,appointment_time,status,notes,created_at FROM bookings WHERE user_id=$1 ORDER BY appointment_date DESC, appointment_time DESC', [req.user.id]);
  res.json(r.rows);
}));

function touchPresence(userId) {
  if (!userId) return;
  const cur = presenceMap.get(userId) || {};
  presenceMap.set(userId, { ...cur, lastSeen: Date.now() });
}
function isOnline(userId) {
  const p = presenceMap.get(userId);
  return !!(p && Date.now() - p.lastSeen < 45000);
}
function isTypingTo(fromId, toId) {
  const p = presenceMap.get(fromId);
  return !!(p && p.typingTo === toId && p.typingUntil && p.typingUntil > Date.now());
}

app.post('/api/presence/ping', requireAuth, (req, res) => {
  touchPresence(req.user.id);
  res.json({ ok: true });
});

app.post('/api/presence/typing', requireAuth, (req, res) => {
  touchPresence(req.user.id);
  const to = cleanText(req.body.toUserId || '', 30);
  const cur = presenceMap.get(req.user.id) || {};
  presenceMap.set(req.user.id, {
    ...cur,
    lastSeen: Date.now(),
    typingTo: to || null,
    typingUntil: to ? Date.now() + 4000 : 0
  });
  res.json({ ok: true });
});

app.get('/api/presence/:userId', requireAuth, (req, res) => {
  const id = cleanText(req.params.userId, 30);
  touchPresence(req.user.id);
  res.json({ online: isOnline(id), typing: isTypingTo(id, req.user.id) });
});

app.get('/api/messages/conversations', requireAuth, asyncRoute(async (req, res) => {
  touchPresence(req.user.id);
  if (req.user.role !== 'admin') {
    const admin = await pool.query("SELECT id, full_name FROM users WHERE role='admin' LIMIT 1");
    if (!admin.rowCount) return res.json([]);
    const a = admin.rows[0];
    const last = await pool.query(
      `SELECT body, created_at FROM messages
       WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)
       ORDER BY created_at DESC LIMIT 1`, [req.user.id, a.id]
    );
    const unread = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages WHERE to_user_id=$1 AND from_user_id=$2 AND read=FALSE`,
      [req.user.id, a.id]
    );
    return res.json([{
      userId: a.id,
      name: a.full_name || 'Salon',
      lastMessage: last.rows[0]?.body || '',
      lastAt: last.rows[0]?.created_at || null,
      unread: unread.rows[0].c,
      online: isOnline(a.id)
    }]);
  }

  const r = await pool.query(`
    WITH people AS (
      SELECT DISTINCT CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END AS peer_id
      FROM messages
      WHERE from_user_id = $1 OR to_user_id = $1
    )
    SELECT p.peer_id AS user_id,
           u.full_name AS name,
           u.email,
           (SELECT body FROM messages m2
            WHERE (m2.from_user_id=$1 AND m2.to_user_id=p.peer_id)
               OR (m2.from_user_id=p.peer_id AND m2.to_user_id=$1)
            ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
           (SELECT created_at FROM messages m2
            WHERE (m2.from_user_id=$1 AND m2.to_user_id=p.peer_id)
               OR (m2.from_user_id=p.peer_id AND m2.to_user_id=$1)
            ORDER BY m2.created_at DESC LIMIT 1) AS last_at,
           (SELECT COUNT(*)::int FROM messages m2
            WHERE m2.to_user_id=$1 AND m2.from_user_id=p.peer_id AND m2.read=FALSE) AS unread
    FROM people p
    JOIN users u ON u.id = p.peer_id
    WHERE u.role = 'client'
    ORDER BY last_at DESC NULLS LAST
  `, [req.user.id]);

  res.json(r.rows.map(row => ({
    userId: row.user_id,
    name: row.name || 'Client',
    email: row.email,
    lastMessage: row.last_message || '',
    lastAt: row.last_at,
    unread: row.unread || 0,
    online: isOnline(row.user_id)
  })));
}));

app.get('/api/messages/thread/:peerId', requireAuth, asyncRoute(async (req, res) => {
  touchPresence(req.user.id);
  const peerId = cleanText(req.params.peerId, 30);
  const r = await pool.query(`
    SELECT m.*, u.full_name AS from_name
    FROM messages m
    LEFT JOIN users u ON u.id = m.from_user_id
    WHERE (m.from_user_id=$1 AND m.to_user_id=$2)
       OR (m.from_user_id=$2 AND m.to_user_id=$1)
    ORDER BY m.created_at ASC
    LIMIT 200
  `, [req.user.id, peerId]);
  await pool.query(
    `UPDATE messages SET read=TRUE WHERE to_user_id=$1 AND from_user_id=$2 AND read=FALSE`,
    [req.user.id, peerId]
  );
  res.json({
    messages: r.rows,
    peer: { online: isOnline(peerId), typing: isTypingTo(peerId, req.user.id) }
  });
}));

app.get('/api/messages', requireAuth, asyncRoute(async (req, res) => {
  touchPresence(req.user.id);
  const peerId = cleanText(req.query.with || '', 30);
  let r;
  if (peerId) {
    r = await pool.query(`
      SELECT m.*, u.full_name AS from_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.from_user_id
      WHERE (m.from_user_id=$1 AND m.to_user_id=$2)
         OR (m.from_user_id=$2 AND m.to_user_id=$1)
      ORDER BY m.created_at ASC LIMIT 200
    `, [req.user.id, peerId]);
  } else if (req.user.role === 'admin') {
    r = await pool.query(`
      SELECT m.*, u.full_name AS from_name, u.email AS from_email, tu.full_name AS to_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.from_user_id
      LEFT JOIN users tu ON tu.id = m.to_user_id
      ORDER BY m.created_at ASC LIMIT 200`);
  } else {
    r = await pool.query(`
      SELECT m.*, u.full_name AS from_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.from_user_id
      WHERE m.to_user_id=$1 OR m.from_user_id=$1
      ORDER BY m.created_at ASC LIMIT 100`, [req.user.id]);
  }
  res.json(r.rows);
}));

app.get('/api/messages/unread-count', requireAuth, asyncRoute(async (req, res) => {
  touchPresence(req.user.id);
  const r = await pool.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE to_user_id=$1 AND read=FALSE',
    [req.user.id]
  );
  res.json({ count: r.rows[0].count });
}));

app.post('/api/messages', requireAuth, asyncRoute(async (req, res) => {
  touchPresence(req.user.id);
  const body = cleanText(req.body.body, 2000);
  const bookingId = cleanText(req.body.bookingId || '', 30) || null;
  if (body.length < 1) return res.status(400).json({ error: 'Message cannot be empty.' });
  let toUserId = null;
  if (req.user.role === 'client') {
    const admin = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (!admin.rowCount) return res.status(500).json({ error: 'No admin available.' });
    toUserId = admin.rows[0].id;
  } else {
    toUserId = cleanText(req.body.toUserId, 30) || null;
    if (!toUserId) return res.status(400).json({ error: 'Specify the client to reply to.' });
  }
  const id = makeId('MSG');
  const r = await pool.query(
    `INSERT INTO messages(id,booking_id,from_user_id,to_user_id,sender_role,body)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, bookingId, req.user.id, toUserId, req.user.role, body]
  );
  const cur = presenceMap.get(req.user.id) || {};
  presenceMap.set(req.user.id, { ...cur, typingTo: null, typingUntil: 0, lastSeen: Date.now() });
  res.status(201).json(r.rows[0]);
}));

app.patch('/api/messages/:id/read', requireAuth, asyncRoute(async (req, res) => {
  await pool.query('UPDATE messages SET read=TRUE WHERE id=$1 AND to_user_id=$2', [cleanText(req.params.id, 30), req.user.id]);
  res.json({ ok: true });
}));
app.get('/api/admin/me', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,email,full_name,phone,role,created_at FROM users WHERE id=$1', [req.user.id]);
  res.json(r.rows[0] || { authenticated: true, role: 'admin' });
}));

app.get('/api/admin/bookings', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT b.*, u.email AS client_email FROM bookings b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.appointment_date DESC, b.appointment_time DESC LIMIT 200`);
  res.json(r.rows);
}));

app.patch('/api/admin/bookings/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const status = cleanText(req.body.status, 20);
  if (!['Requested', 'Confirmed', 'Completed', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const r = await pool.query('UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [status, id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Booking not found.' });
  const b = r.rows[0];
  // Notify client in-app when confirmed / cancelled / completed
  if (b.user_id && ['Confirmed', 'Cancelled', 'Completed'].includes(status)) {
    const msg = status === 'Confirmed'
      ? `Your booking ${b.id} for ${b.service_name} on ${String(b.appointment_date).slice(0,10)} at ${String(b.appointment_time).slice(0,5)} is CONFIRMED. We look forward to seeing you!`
      : status === 'Cancelled'
      ? `Your booking ${b.id} for ${b.service_name} on ${String(b.appointment_date).slice(0,10)} has been cancelled. Message us if you need to rebook.`
      : `Thanks for visiting! Your booking ${b.id} is marked completed. We'd love a quick review from your account.`;
    await pool.query(
      `INSERT INTO messages(id,booking_id,from_user_id,to_user_id,sender_role,body) VALUES($1,$2,$3,$4,'admin',$5)`,
      [makeId('MSG'), b.id, req.user.id, b.user_id, msg]
    );
  }
  const wa = (await pool.query("SELECT value FROM salon_settings WHERE key='whatsapp'")).rows[0]?.value || salon.whatsapp;
  res.json({
    ...b,
    notify: {
      whatsapp: wa && status === 'Confirmed'
        ? `https://wa.me/${String(wa).replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${b.customer_name}, your booking ${b.id} for ${b.service_name} on ${String(b.appointment_date).slice(0,10)} at ${String(b.appointment_time).slice(0,5)} is confirmed.`)}`
        : null
    }
  });
}));

app.delete('/api/admin/bookings/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const r = await pool.query('DELETE FROM bookings WHERE id=$1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ ok: true });
}));

app.get('/api/admin/services', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT * FROM services ORDER BY category, name');
  res.json(r.rows);
}));

app.post('/api/admin/services', requireAdmin, asyncRoute(async (req, res) => {
  const id = cleanText(req.body.id || '', 50).toLowerCase().replace(/[^a-z0-9-]/g, '-') || crypto.randomBytes(5).toString('hex');
  const category = cleanText(req.body.category, 60) || 'Other';
  const name = cleanText(req.body.name, 100);
  const description = cleanText(req.body.description, 300);
  const price = Number(req.body.price);
  const duration = Number(req.body.duration);
  const icon = cleanText(req.body.icon, 8) || '✧';
  if (name.length < 2 || !Number.isInteger(price) || price < 0 || !Number.isInteger(duration) || duration < 5 || duration > 600) {
    return res.status(400).json({ error: 'Enter a valid name, non-negative price, and duration 5–600 minutes.' });
  }
  const r = await pool.query('INSERT INTO services(id,category,name,description,price,duration,icon,active) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *', [id, category, name, description, price, duration, icon]);
  res.status(201).json(r.rows[0]);
}));

app.patch('/api/admin/services/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { category, name, description, price, duration, icon, active } = req.body;
  if (name !== undefined && cleanText(name, 100).length < 2) return res.status(400).json({ error: 'Service name too short.' });
  if (price !== undefined && (!Number.isInteger(Number(price)) || Number(price) < 0)) return res.status(400).json({ error: 'Invalid price.' });
  if (duration !== undefined && (!Number.isInteger(Number(duration)) || Number(duration) < 5 || Number(duration) > 600)) return res.status(400).json({ error: 'Invalid duration.' });
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: 'Active must be true or false.' });
  const r = await pool.query(`UPDATE services SET category=COALESCE($1,category), name=COALESCE($2,name), description=COALESCE($3,description), price=COALESCE($4,price), duration=COALESCE($5,duration), icon=COALESCE($6,icon), active=COALESCE($7,active), updated_at=NOW() WHERE id=$8 RETURNING *`, [
    category === undefined ? null : cleanText(category, 60),
    name === undefined ? null : cleanText(name, 100),
    description === undefined ? null : cleanText(description, 300),
    price === undefined ? null : Number(price),
    duration === undefined ? null : Number(duration),
    icon === undefined ? null : cleanText(icon, 8),
    active === undefined ? null : active,
    cleanText(req.params.id, 50)
  ]);
  if (!r.rowCount) return res.status(404).json({ error: 'Service not found.' });
  res.json(r.rows[0]);
}));

app.get('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT key,value FROM salon_settings');
  res.json(Object.fromEntries(r.rows.map(x => [x.key, x.value])));
}));

app.patch('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
const allowed = ['salon_name', 'whatsapp', 'opening_time', 'closing_time', 'slot_interval', 'closed_days', 'business_type', 'tagline', 'color_primary', 'color_accent', 'color_cream', 'logo_style', 'theme_mode'];
  const updates = [];
  for (const k of allowed) {
    if (req.body[k] === undefined) continue;
    const v = cleanText(String(req.body[k]), 200);
    if (k === 'whatsapp' && v && !/^\+?[0-9]{9,15}$/.test(v.replace(/[\s()-]/g, ''))) return res.status(400).json({ error: 'WhatsApp must be international digits only.' });
    if (['opening_time', 'closing_time'].includes(k) && !validTime(v)) return res.status(400).json({ error: 'Times must be HH:MM.' });
    if (k === 'slot_interval' && (!Number.isInteger(Number(v)) || Number(v) < 5 || Number(v) > 120)) return res.status(400).json({ error: 'Slot interval must be 5–120 minutes.' });
    if (k === 'closed_days' && !/^(?:[0-6](?:,[0-6])*)?$/.test(v)) return res.status(400).json({ error: 'Closed days must be 0-6 comma-separated.' });
    if (k === 'salon_name' && v.trim().length < 2) return res.status(400).json({ error: 'Salon name too short.' });
    updates.push([k, v]);
  }
  const currentR = await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time')");
  const times = Object.fromEntries(currentR.rows.map(x => [x.key, x.value]));
  const opening = updates.find(x => x[0] === 'opening_time')?.[1] || times.opening_time;
  const closing = updates.find(x => x[0] === 'closing_time')?.[1] || times.closing_time;
  if (opening >= closing) return res.status(400).json({ error: 'Closing time must be after opening time.' });
  for (const [k, v] of updates) {
    await pool.query('INSERT INTO salon_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()', [k, v]);
  }
  const r = await pool.query('SELECT key,value FROM salon_settings');
  res.json(Object.fromEntries(r.rows.map(x => [x.key, x.value])));
}));

app.get('/api/admin/clients', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query("SELECT id,email,full_name,phone,created_at FROM users WHERE role='client' ORDER BY created_at DESC LIMIT 100");
  res.json(r.rows);
}));

// —— Client cancel own booking ——
app.patch('/api/my/bookings/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Clients only.' });
  const id = cleanText(req.params.id, 30);
  const r = await pool.query(
    `UPDATE bookings SET status='Cancelled', updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status IN ('Requested','Confirmed')
     RETURNING *`, [id, req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Booking not found or cannot be cancelled.' });
  res.json(r.rows[0]);
}));

// —— Admin overview stats ——
app.get('/api/admin/stats', requireAdmin, asyncRoute(async (req, res) => {
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: salon.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const [pending, todayRows, unread, clients, completed] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE status='Requested'`),
    pool.query(`SELECT id, customer_name, service_name, appointment_time, status FROM bookings WHERE appointment_date=$1 AND status IN ('Requested','Confirmed') ORDER BY appointment_time`, [today]),
    pool.query(`SELECT COUNT(*)::int AS c FROM messages WHERE to_user_id=$1 AND read=FALSE`, [req.user.id]),
    pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='client'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE status='Completed'`)
  ]);
  res.json({
    pending: pending.rows[0].c,
    today: todayRows.rows,
    unreadMessages: unread.rows[0].c,
    clients: clients.rows[0].c,
    completed: completed.rows[0].c,
    date: today
  });
}));

// —— Export bookings CSV ——
app.get('/api/admin/bookings/export', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT id, customer_name, phone, service_name, price, appointment_date, appointment_time, status, notes, created_at FROM bookings ORDER BY appointment_date DESC, appointment_time DESC LIMIT 2000`);
  const header = 'id,customer_name,phone,service_name,price,appointment_date,appointment_time,status,notes,created_at';
  const lines = r.rows.map(b => [b.id, b.customer_name, b.phone, b.service_name, b.price, b.appointment_date, b.appointment_time, b.status, (b.notes||'').replace(/"/g,'""'), b.created_at].map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
  res.send([header, ...lines].join('\n'));
}));

// —— Gallery public + admin ——
app.get('/api/gallery', asyncRoute(async (req, res) => {
  const r = await pool.query(`
    SELECT g.id, g.title, g.caption, g.image_url, COALESCE(g.media_type,'image') AS media_type, g.created_at,
           (SELECT COUNT(*)::int FROM gallery_likes l WHERE l.gallery_id = g.id) AS likes,
           (SELECT COUNT(*)::int FROM gallery_comments c WHERE c.gallery_id = g.id) AS comments
    FROM gallery g
    WHERE g.active = TRUE
    ORDER BY g.sort_order, g.created_at DESC
    LIMIT 80`);
  res.json(r.rows);
}));

app.get('/api/gallery/:id/comments', asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const r = await pool.query(
    `SELECT id, author_name, body, created_at FROM gallery_comments WHERE gallery_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [id]
  );
  res.json(r.rows);
}));

app.post('/api/gallery/:id/like', asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const key = cleanText(req.body.visitorKey || req.ip || 'anon', 80) || 'anon';
  const exists = await pool.query('SELECT 1 FROM gallery WHERE id=$1 AND active=TRUE', [id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'Not found.' });
  await pool.query(
    `INSERT INTO gallery_likes(gallery_id, visitor_key) VALUES($1,$2) ON CONFLICT DO NOTHING`,
    [id, key]
  );
  const c = await pool.query('SELECT COUNT(*)::int AS n FROM gallery_likes WHERE gallery_id=$1', [id]);
  res.json({ likes: c.rows[0].n });
}));

app.post('/api/gallery/:id/comments', optionalAuth, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const body = cleanText(req.body.body, 500);
  // Prefer signed-in account name so clients never show as Guest
  let author = '';
  if (req.user) {
    author = cleanText(req.user.fullName || req.user.email || '', 60);
    if (!author) {
      const u = await pool.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.id]);
      if (u.rowCount) author = cleanText(u.rows[0].full_name || u.rows[0].email || '', 60);
    }
  }
  if (!author) author = cleanText(req.body.authorName || '', 60);
  if (!author) author = 'Guest';
  const key = cleanText(req.body.visitorKey || (req.user && req.user.id) || '', 80);
  if (body.length < 1) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const exists = await pool.query('SELECT 1 FROM gallery WHERE id=$1 AND active=TRUE', [id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'Not found.' });
  const cid = makeId('GCM');
  const r = await pool.query(
    `INSERT INTO gallery_comments(id,gallery_id,visitor_key,author_name,body) VALUES($1,$2,$3,$4,$5)
     RETURNING id, author_name, body, created_at`,
    [cid, id, key, author, body]
  );
  res.status(201).json(r.rows[0]);
}));

app.get('/api/admin/gallery', requireAdmin, asyncRoute(async (req, res) => {
  // Never select media_data here — it is huge and only needed when streaming /api/media/:id
  const r = await pool.query(`
    SELECT g.id, g.title, g.caption, g.image_url, COALESCE(g.media_type,'image') AS media_type,
           g.mime_type, g.sort_order, g.active, g.created_at,
           (SELECT COUNT(*)::int FROM gallery_likes l WHERE l.gallery_id = g.id) AS likes,
           (SELECT COUNT(*)::int FROM gallery_comments c WHERE c.gallery_id = g.id) AS comments,
           (g.media_data IS NOT NULL) AS has_media
    FROM gallery g
    ORDER BY g.sort_order, g.created_at DESC`);
  res.json(r.rows);
}));

app.get('/api/media/:id', asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const r = await pool.query('SELECT media_data, mime_type, image_url FROM gallery WHERE id=$1 AND active=TRUE', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
  const row = r.rows[0];
  if (row.media_data) {
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');
    return res.send(row.media_data);
  }
  // Legacy disk path (may be gone after redeploy)
  if (row.image_url && row.image_url.startsWith('/uploads/')) {
    return res.status(404).json({ error: 'This file was lost after a server restart. Please upload it again.' });
  }
  return res.status(404).json({ error: 'Media missing. Please re-upload.' });
}));

app.get('/api/avatar/:userId', asyncRoute(async (req, res) => {
  const id = cleanText(req.params.userId, 30);
  const r = await pool.query('SELECT avatar_data, avatar_mime, avatar_url FROM users WHERE id=$1', [id]);
  if (!r.rowCount || !r.rows[0].avatar_data) return res.status(404).end();
  res.setHeader('Content-Type', r.rows[0].avatar_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(r.rows[0].avatar_data);
}));

app.post('/api/admin/gallery/upload', requireAdmin, uploadMiddleware, asyncRoute(async (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Choose a photo or video.' });
  if (req.file.size > 25 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 25MB).' });
  const title = cleanText(req.body.title || '', 100);
  const caption = cleanText(req.body.caption || '', 300);
  const media_type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const id = makeId('GAL');
  const image_url = '/api/media/' + id;
  await pool.query(
    `INSERT INTO gallery(id,title,caption,image_url,media_type,mime_type,media_data,sort_order,active)
     VALUES($1,$2,$3,$4,$5,$6,$7,0,TRUE)`,
    [id, title, caption, image_url, media_type, req.file.mimetype, req.file.buffer]
  );
  const r = await pool.query(
    `SELECT id, title, caption, image_url, media_type, created_at,
            (SELECT COUNT(*)::int FROM gallery_likes l WHERE l.gallery_id = $1) AS likes,
            (SELECT COUNT(*)::int FROM gallery_comments c WHERE c.gallery_id = $1) AS comments
     FROM gallery WHERE id=$1`,
    [id]
  );
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/admin/gallery/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 30);
  const r = await pool.query(`DELETE FROM gallery WHERE id=$1 RETURNING id`, [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

app.post('/api/profile/avatar', requireAuth, uploadMiddleware, asyncRoute(async (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Choose a photo.' });
  if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Profile photo must be an image.' });
  if (req.file.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'Photo max 5MB.' });
  const url = '/api/avatar/' + req.user.id;
  await pool.query(
    'UPDATE users SET avatar_url=$1, avatar_data=$2, avatar_mime=$3, updated_at=NOW() WHERE id=$4',
    [url, req.file.buffer, req.file.mimetype, req.user.id]
  );
  const updated = await pool.query('SELECT id,email,full_name,phone,role,avatar_url FROM users WHERE id=$1', [req.user.id]);
  res.json(updated.rows[0]);
}));

app.get('/api/reviews', asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT id, customer_name, rating, comment, created_at FROM reviews WHERE approved=TRUE ORDER BY created_at DESC LIMIT 40`);
  res.json(r.rows);
}));

app.post('/api/reviews', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Clients only.' });
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment, 500);
  const bookingId = cleanText(req.body.bookingId || '', 30) || null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5.' });
  const u = await pool.query('SELECT full_name FROM users WHERE id=$1', [req.user.id]);
  const id = makeId('REV');
  const r = await pool.query(
    `INSERT INTO reviews(id,booking_id,user_id,customer_name,rating,comment,approved) VALUES($1,$2,$3,$4,$5,$6,FALSE) RETURNING id,rating,comment,created_at`,
    [id, bookingId, req.user.id, u.rows[0]?.full_name || 'Client', rating, comment]
  );
  res.status(201).json({ ...r.rows[0], message: 'Thank you! Your review will appear after approval.' });
}));

app.get('/api/admin/reviews', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT * FROM reviews ORDER BY created_at DESC LIMIT 100`);
  res.json(r.rows);
}));

app.patch('/api/admin/reviews/:id', requireAdmin, asyncRoute(async (req, res) => {
  const approved = !!req.body.approved;
  const r = await pool.query(`UPDATE reviews SET approved=$1 WHERE id=$2 RETURNING *`, [approved, cleanText(req.params.id, 30)]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
  res.json(r.rows[0]);
}));

// —— Staff: list admins + promote client to admin ——
app.get('/api/admin/staff', requireAdmin, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT id, email, full_name, phone, role, created_at FROM users WHERE role='admin' ORDER BY created_at`);
  res.json(r.rows);
}));

app.post('/api/admin/staff/promote', requireAdmin, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Valid email required.' });
  const r = await pool.query(`UPDATE users SET role='admin', updated_at=NOW() WHERE email=$1 RETURNING id,email,full_name,role`, [email]);
  if (!r.rowCount) return res.status(404).json({ error: 'No user with that email. They must sign up first.' });
  res.json(r.rows[0]);
}));

app.post('/api/admin/staff/demote', requireAdmin, asyncRoute(async (req, res) => {
  const id = cleanText(req.body.userId, 30);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot demote yourself.' });
  const admins = await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='admin'`);
  if (admins.rows[0].c <= 1) return res.status(400).json({ error: 'Keep at least one admin.' });
  const r = await pool.query(`UPDATE users SET role='client', updated_at=NOW() WHERE id=$1 AND role='admin' RETURNING id,email,role`, [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Admin not found.' });
  res.json(r.rows[0]);
}));

// Reminder scaffold (logs only unless REMINDER_WEBHOOK set)
app.post('/api/admin/reminders/run', requireAdmin, asyncRoute(async (req, res) => {
  const tomorrowParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: salon.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + 86400000)).map(x => [x.type, x.value]));
  const day = `${tomorrowParts.year}-${tomorrowParts.month}-${tomorrowParts.day}`;
  const r = await pool.query(`SELECT * FROM bookings WHERE appointment_date=$1 AND status='Confirmed'`, [day]);
  const webhook = process.env.REMINDER_WEBHOOK || '';
  let sent = 0;
  for (const b of r.rows) {
    const payload = { type: 'booking_reminder', booking: b };
    if (webhook) {
      try {
        await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        sent++;
      } catch (e) { console.error('Reminder webhook failed', e.message); }
    } else {
      console.log('Reminder (no webhook):', b.id, b.customer_name, b.phone);
    }
  }
  res.json({ ok: true, date: day, found: r.rows.length, sent, note: webhook ? 'Posted to REMINDER_WEBHOOK' : 'Set REMINDER_WEBHOOK env to enable SMS/email provider' });
}));


app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error('Request error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

initDb()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Pinnacle BeautyParlour v3 listening on ${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });