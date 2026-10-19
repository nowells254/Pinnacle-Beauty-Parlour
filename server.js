'use strict';
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? '' : 'local-development-secret-change-this-before-deploying');
if (isProd && (!SESSION_SECRET || SESSION_SECRET.length < 32)) throw new Error('SESSION_SECRET must be at least 32 characters in production.');
if (isProd && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in Render environment variables.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Create a PostgreSQL database and set DATABASE_URL.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProd ? { rejectUnauthorized: false } : undefined, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
const salon = { name: process.env.SALON_NAME || 'Pinnacle BeautyParlour', whatsapp: process.env.SALON_WHATSAPP || '', currency: process.env.SALON_CURRENCY || 'KSh', timeZone: process.env.TIME_ZONE || 'Africa/Nairobi' };

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: isProd ? [] : null } } }));
app.use(compression());
app.use(express.json({ limit: '30kb' }));
// Never let browsers or shared proxies cache customer records or authenticated API data.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1h' : 0, etag: true }));

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
 ['makeup', 'Makeup', 'Everyday makeup', 'Fresh, natural makeup look.', 2500, 60, '◉', true],
 ['soft-glam', 'Makeup', 'Soft glam makeup', 'Polished soft-glam look.', 3500, 75, '◉', true],
 ['full-glam', 'Makeup', 'Full glam makeup', 'Full-coverage event makeup.', 4500, 90, '◉', true],
 ['bridal-makeup', 'Makeup', 'Bridal makeup', 'Wedding makeup with consultation.', 8000, 120, '◉', true],
 ['bridesmaid-makeup', 'Makeup', 'Bridesmaid makeup', 'Event makeup for bridal party members.', 4000, 75, '◉', true],
 ['photoshoot-makeup', 'Makeup', 'Photoshoot makeup', 'Camera-ready makeup for photography.', 4500, 90, '◉', true],
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
 ['mens-haircut', 'Men’s grooming', 'Men’s haircut', 'Classic haircut and finish.', 800, 30, '✂', true],
 ['mens-fade', 'Men’s grooming', 'Fade haircut', 'Precision fade and finish.', 1000, 40, '✂', true],
 ['beard-trim', 'Men’s grooming', 'Beard trim & shaping', 'Beard grooming and outline.', 500, 20, '✂', true],
 ['mens-facial', 'Men’s grooming', 'Men’s facial', 'Cleansing and moisturising facial.', 1800, 45, '☼', true],
 ['kids-style', 'Children’s services', 'Children’s hairstyling', 'Age-appropriate styling; parent/guardian present.', 800, 45, '✂', true],
];

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.'); if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest();
  let supplied; try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try { const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); return data.exp > Date.now() ? data : null; } catch { return null; }
}
function setAuthCookie(res, token) { res.cookie('pinnacle_session', token, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/' }); }
function getCookie(req, name) { const header = req.headers.cookie || ''; for (const p of header.split(';')) { const i = p.indexOf('='); if (i > -1 && p.slice(0,i).trim() === name) return decodeURIComponent(p.slice(i+1).trim()); } return ''; }
function requireAdmin(req,res,next) { const user = verifyToken(getCookie(req,'pinnacle_session')); if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Please sign in as the salon owner.' }); req.admin = user; next(); }
function cleanText(v, max=200) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function validDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d=new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===s; }
function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function asyncRoute(fn) { return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'Other', name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL CHECK(price >= 0), duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 600), icon TEXT NOT NULL DEFAULT '✧', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other'");
  await pool.query(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL, service_id TEXT NOT NULL REFERENCES services(id) ON UPDATE CASCADE, service_name TEXT NOT NULL, price INTEGER NOT NULL, duration INTEGER NOT NULL, appointment_date DATE NOT NULL, appointment_time TIME NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Requested' CHECK(status IN ('Requested','Confirmed','Completed','Cancelled')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(appointment_date, appointment_time)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bookings_created_idx ON bookings(created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS salon_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const s of defaultServices) await pool.query('INSERT INTO services(id,category,name,description,price,duration,icon,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',s);
  await pool.query("UPDATE services SET category=CASE id WHEN 'hair' THEN 'Hair styling' WHEN 'braids' THEN 'Braids & twists' WHEN 'nails' THEN 'Nails' WHEN 'facial' THEN 'Facials & skincare' WHEN 'makeup' THEN 'Makeup' WHEN 'treatment' THEN 'Hair treatments' ELSE category END WHERE id IN ('hair','braids','nails','facial','makeup','treatment')");
  const settings = [['salon_name',salon.name],['whatsapp',salon.whatsapp],['opening_time','09:00'],['closing_time','18:00'],['slot_interval','30'],['closed_days','0']];
  for (const [k,v] of settings) await pool.query('INSERT INTO salon_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[k,v]);
}

const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: {error:'Too many sign-in attempts. Wait 15 minutes and try again.'} });
const bookingLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: {error:'Too many booking requests. Please wait a little and try again.'} });
app.get('/health', asyncRoute(async(req,res)=>{await pool.query('SELECT 1');res.json({ok:true,service:'Pinnacle BeautyParlour',database:'connected'});}));
app.get('/api/config',(req,res)=>res.json({name:salon.name,currency:salon.currency,timeZone:salon.timeZone}));
app.get('/api/services',asyncRoute(async(req,res)=>{const r=await pool.query('SELECT id,category,name,description,price,duration,icon FROM services WHERE active=TRUE ORDER BY category,name');res.json(r.rows);}));
app.get('/api/settings',asyncRoute(async(req,res)=>{const r=await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('salon_name','whatsapp','opening_time','closing_time','slot_interval','closed_days')");res.json(Object.fromEntries(r.rows.map(x=>[x.key,x.value])));}));

app.post('/api/bookings', bookingLimiter, asyncRoute(async(req,res)=>{
  const name=cleanText(req.body.name,100), phone=cleanText(req.body.phone,30).replace(/[\s()-]/g,''), serviceId=cleanText(req.body.service,80), date=cleanText(req.body.date,10), time=cleanText(req.body.time,5), notes=cleanText(req.body.notes,500);
  if(name.length<2) return res.status(400).json({error:'Enter your full name.'});
  if(!/^\+?[0-9]{9,15}$/.test(phone)) return res.status(400).json({error:'Enter a valid phone number including country code if possible.'});
  const todayParts=new Intl.DateTimeFormat('en-CA',{timeZone:salon.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const todayObj=Object.fromEntries(todayParts.map(x=>[x.type,x.value])); const today=`${todayObj.year}-${todayObj.month}-${todayObj.day}`;
  const nowParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:salon.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  if(!validDate(date)||date<today) return res.status(400).json({error:'Choose a valid future date.'});
  if(!validTime(time)) return res.status(400).json({error:'Choose a valid appointment time.'});
  if(date===today && time<=`${nowParts.hour}:${nowParts.minute}`) return res.status(400).json({error:'Choose a time later than now.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[date]);
    const sr=await client.query('SELECT id,name,price,duration FROM services WHERE id=$1 AND active=TRUE',[serviceId]);
    if(!sr.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'That service is no longer available. Refresh and choose another.'});}
    const svc=sr.rows[0];
    const setR=await client.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time','closed_days','slot_interval')"); const sets=Object.fromEntries(setR.rows.map(x=>[x.key,x.value]));
    const day=new Date(`${date}T12:00:00Z`).getUTCDay(); const closed=(sets.closed_days||'').split(',').map(Number);
    if(closed.includes(day)){await client.query('ROLLBACK');return res.status(400).json({error:'The salon is closed on this day. Please choose another date.'});}
    const toMins=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
    const start=toMins(time), open=toMins(sets.opening_time||'09:00'), close=toMins(sets.closing_time||'18:00');
    if(start<open || start+Number(svc.duration)>close){await client.query('ROLLBACK');return res.status(400).json({error:`Choose a time between ${sets.opening_time||'09:00'} and ${sets.closing_time||'18:00'} that allows the full service.`});}
    if((start-open) % Math.max(5,Number(sets.slot_interval)||30)!==0){await client.query('ROLLBACK');return res.status(400).json({error:'Choose a listed appointment time.'});}
    const overlap=await client.query(`SELECT id FROM bookings WHERE appointment_date=$1 AND status IN ('Requested','Confirmed') AND (appointment_time, appointment_time + (duration * INTERVAL '1 minute')) OVERLAPS ($2::time, $2::time + ($3 * INTERVAL '1 minute')) LIMIT 1`,[date,time,svc.duration]);
    if(overlap.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'That time has just been taken. Please choose another slot.'});}
    const id='PB-'+crypto.randomBytes(5).toString('hex').toUpperCase();
    const inserted=await client.query(`INSERT INTO bookings(id,customer_name,phone,service_id,service_name,price,duration,appointment_date,appointment_time,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,customer_name,phone,service_name,price,duration,appointment_date,appointment_time,notes,status,created_at`,[id,name,phone,svc.id,svc.name,svc.price,svc.duration,date,time,notes]);
    await client.query('COMMIT'); res.status(201).json({message:'Appointment request received. The salon will confirm with you.',booking:inserted.rows[0],whatsapp:salon.whatsapp});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;} finally{client.release();}
}));
app.get('/api/availability',asyncRoute(async(req,res)=>{
  const date=cleanText(req.query.date,10), serviceId=cleanText(req.query.service,80); if(!validDate(date)) return res.status(400).json({error:'Choose a valid date.'});
  const todayParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:salon.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));const today=`${todayParts.year}-${todayParts.month}-${todayParts.day}`;if(date<today)return res.json({slots:[],closed:false});
  const sr=await pool.query('SELECT duration FROM services WHERE id=$1 AND active=TRUE',[serviceId]);if(!sr.rowCount)return res.status(400).json({error:'Choose a service.'});
  const rr=await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time','slot_interval','closed_days')");const s=Object.fromEntries(rr.rows.map(x=>[x.key,x.value]));
  const day=new Date(`${date}T12:00:00Z`).getUTCDay();if((s.closed_days||'').split(',').map(Number).includes(day))return res.json({slots:[],closed:true});
  const mins=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;}, fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const open=mins(s.opening_time||'09:00'),close=mins(s.closing_time||'18:00'),step=Math.max(5,Number(s.slot_interval)||30),duration=Number(sr.rows[0].duration);
  const booked=await pool.query("SELECT appointment_time::text AS time,duration FROM bookings WHERE appointment_date=$1 AND status IN ('Requested','Confirmed')",[date]);
  const nowParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:salon.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));const currentDayParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:salon.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));const currentDay=`${currentDayParts.year}-${currentDayParts.month}-${currentDayParts.day}`;const nowMins=Number(nowParts.hour)*60+Number(nowParts.minute);
  const slots=[];for(let t=open;t+duration<=close;t+=step){if(date===currentDay&&t<=nowMins)continue;const taken=booked.rows.some(b=>{const bt=mins(String(b.time).slice(0,5));return t<bt+Number(b.duration)&&bt<t+duration;});if(!taken)slots.push(fmt(t));}
  res.json({slots,openingTime:s.opening_time||'09:00',closingTime:s.closing_time||'18:00'});
}));

app.get('/api/admin/me',(req,res)=>{const u=verifyToken(getCookie(req,'pinnacle_session'));res.json({authenticated:!!u&&u.role==='admin',email:u?.email||null});});
app.post('/api/admin/login',loginLimiter,asyncRoute(async(req,res)=>{const email=cleanText(req.body.email,200).toLowerCase(),password=typeof req.body.password==='string'?req.body.password:'';const expectedEmail=(process.env.ADMIN_EMAIL||'owner@example.com').toLowerCase();const expectedPassword=process.env.ADMIN_PASSWORD||'local-owner-password-change-me';const ok= email===expectedEmail && password.length<=200 && crypto.timingSafeEqual(Buffer.from(password.padEnd(200,'\0').slice(0,200)),Buffer.from(expectedPassword.padEnd(200,'\0').slice(0,200)));
  if(!ok)return res.status(401).json({error:'Email or password is incorrect.'});setAuthCookie(res,signToken({role:'admin',email}));res.json({ok:true,email});}));
app.post('/api/admin/logout',(req,res)=>{res.clearCookie('pinnacle_session',{httpOnly:true,secure:isProd,sameSite:'strict',path:'/'});res.json({ok:true});});
app.get('/api/admin/bookings',requireAdmin,asyncRoute(async(req,res)=>{const q=cleanText(req.query.q,100),status=cleanText(req.query.status,20);const r=await pool.query(`SELECT id,customer_name,phone,service_id,service_name,price,duration,appointment_date,appointment_time::text AS appointment_time,notes,status,created_at,updated_at FROM bookings WHERE ($1='' OR customer_name ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%' OR id ILIKE '%'||$1||'%' OR service_name ILIKE '%'||$1||'%') AND ($2='' OR status=$2) ORDER BY appointment_date DESC,appointment_time DESC LIMIT 500`,[q,status]);res.json(r.rows);}));
app.patch('/api/admin/bookings/:id',requireAdmin,asyncRoute(async(req,res)=>{const status=cleanText(req.body.status,20);if(!['Requested','Confirmed','Completed','Cancelled'].includes(status))return res.status(400).json({error:'Invalid booking status.'});const r=await pool.query('UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status',[status,cleanText(req.params.id,30)]);if(!r.rowCount)return res.status(404).json({error:'Booking not found.'});res.json(r.rows[0]);}));
app.delete('/api/admin/bookings/:id',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM bookings WHERE id=$1 RETURNING id',[cleanText(req.params.id,30)]);if(!r.rowCount)return res.status(404).json({error:'Booking not found.'});res.json({ok:true});}));
app.get('/api/admin/services',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT id,category,name,description,price,duration,icon,active FROM services ORDER BY category,name');res.json(r.rows);}));
app.post('/api/admin/services',requireAdmin,asyncRoute(async(req,res)=>{const id=cleanText(req.body.id,50).toLowerCase().replace(/[^a-z0-9-]/g,'-')||crypto.randomBytes(5).toString('hex'),category=cleanText(req.body.category,60)||'Other',name=cleanText(req.body.name,100),description=cleanText(req.body.description,300),price=Number(req.body.price),duration=Number(req.body.duration),icon=cleanText(req.body.icon,8)||'✧';if(name.length<2||!Number.isInteger(price)||price<0||!Number.isInteger(duration)||duration<5||duration>600)return res.status(400).json({error:'Enter a service name, a non-negative whole-number price, and duration from 5 to 600 minutes.'});const r=await pool.query('INSERT INTO services(id,category,name,description,price,duration,icon,active) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *',[id,category,name,description,price,duration,icon]);res.status(201).json(r.rows[0]);}));
app.patch('/api/admin/services/:id',requireAdmin,asyncRoute(async(req,res)=>{const {category,name,description,price,duration,icon,active}=req.body;if(name!==undefined&&cleanText(name,100).length<2)return res.status(400).json({error:'Service name must contain at least 2 characters.'});if(price!==undefined&&(!Number.isInteger(Number(price))||Number(price)<0))return res.status(400).json({error:'Price must be a non-negative whole number.'});if(duration!==undefined&&(!Number.isInteger(Number(duration))||Number(duration)<5||Number(duration)>600))return res.status(400).json({error:'Duration must be from 5 to 600 minutes.'});if(active!==undefined&&typeof active!=='boolean')return res.status(400).json({error:'Active must be true or false.'});const r=await pool.query(`UPDATE services SET category=COALESCE($1,category),name=COALESCE($2,name),description=COALESCE($3,description),price=COALESCE($4,price),duration=COALESCE($5,duration),icon=COALESCE($6,icon),active=COALESCE($7,active),updated_at=NOW() WHERE id=$8 RETURNING *`,[category===undefined?null:cleanText(category,60),name===undefined?null:cleanText(name,100),description===undefined?null:cleanText(description,300),price===undefined?null:Number(price),duration===undefined?null:Number(duration),icon===undefined?null:cleanText(icon,8),active===undefined?null:active,cleanText(req.params.id,50)]);if(!r.rowCount)return res.status(404).json({error:'Service not found.'});res.json(r.rows[0]);}));
app.get('/api/admin/settings',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT key,value FROM salon_settings');res.json(Object.fromEntries(r.rows.map(x=>[x.key,x.value])));}));
app.patch('/api/admin/settings',requireAdmin,asyncRoute(async(req,res)=>{
  const allowed=['salon_name','whatsapp','opening_time','closing_time','slot_interval','closed_days'];
  const updates=[];
  for(const k of allowed){
    if(req.body[k]===undefined) continue;
    const v=cleanText(String(req.body[k]),100);
    if(k==='whatsapp'&&v&&!/^\+?[0-9]{9,15}$/.test(v.replace(/[\s()-]/g,''))) return res.status(400).json({error:'Enter WhatsApp in international format, digits only.'});
    if(['opening_time','closing_time'].includes(k)&&!validTime(v)) return res.status(400).json({error:'Opening and closing times must use HH:MM.'});
    if(k==='slot_interval'&&(!Number.isInteger(Number(v))||Number(v)<5||Number(v)>120)) return res.status(400).json({error:'Slot interval must be 5–120 minutes.'});
    if(k==='closed_days'&&!/^(?:[0-6](?:,[0-6])*)?$/.test(v)) return res.status(400).json({error:'Closed weekdays must be comma-separated numbers from 0 (Sunday) to 6 (Saturday), without spaces.'});
    if(k==='salon_name'&&v.trim().length<2) return res.status(400).json({error:'Salon name must contain at least 2 characters.'});
    updates.push([k,v]);
  }
  const currentR=await pool.query("SELECT key,value FROM salon_settings WHERE key IN ('opening_time','closing_time')");
  const times=Object.fromEntries(currentR.rows.map(x=>[x.key,x.value]));
  const opening=updates.find(x=>x[0]==='opening_time')?.[1]||times.opening_time;
  const closing=updates.find(x=>x[0]==='closing_time')?.[1]||times.closing_time;
  if(opening>=closing) return res.status(400).json({error:'Closing time must be later than opening time.'});
  for(const [k,v] of updates) await pool.query('INSERT INTO salon_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[k,v]);
  const r=await pool.query('SELECT key,value FROM salon_settings');
  res.json(Object.fromEntries(r.rows.map(x=>[x.key,x.value])));
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error('Request error:',err.message);if(res.headersSent)return next(err);res.status(500).json({error:'Something went wrong. Please try again. If this continues, contact the salon owner.'});});

initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Pinnacle BeautyParlour listening on ${PORT}`))).catch(err=>{console.error('Startup failed:',err);process.exit(1);});
