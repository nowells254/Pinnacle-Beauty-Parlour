# Pinnacle BeautyParlour — Full-stack app

## Quick visual test on a phone (offline preview)
1. Download and extract the ZIP.
2. Open `pinnacle-beautyparlour/preview.html` in Chrome. Keep `preview.html`, `preview.js`, `preview-services.json`, and the `public` folder together.
3. The preview includes the full seeded service catalogue and a local-only demo booking form. It does not contact the salon or the database.

## Deploy the full application
The production app is served by Node.js and requires PostgreSQL. Do not open `public/index.html` directly as a file: its API calls need the running server. Use the Render setup instructions below.

# Pinnacle BeautyParlour — full-stack booking application

A mobile-first beauty salon website and installable PWA backed by PostgreSQL. Includes customer appointment requests, server-checked time slots, owner authentication, appointment management, service management, salon settings, CSV export, and Render deployment configuration.

## What's included

- Responsive customer-facing salon website.
- Public service menu pre-seeded with 100 services across hair styling, colouring, treatments, braids, natural hair, locs, wigs/extensions, nails, pedicures, skincare, makeup, brows/lashes, waxing/body care, spa, occasion packages, consultations, men’s grooming, and children’s styling. Services are grouped by category in the booking dropdown, searchable/filterable on the menu, and show sample prices and estimated durations.
- Appointment request form validated on the server.
- Live availability checks against active bookings, with a database lock to reduce double-booking races.
- PostgreSQL persistence shared across devices; bookings are **not** stored only in browser local storage.
- Owner sign-in using credentials set privately in environment variables; signed, HttpOnly, SameSite cookies; login rate limiting.
- Owner dashboard: search/filter bookings, confirm/complete/cancel, delete, export CSV.
- Service management: add services and hide/show them.
- Salon settings: business name, WhatsApp, opening/closing times, slot interval, and closed weekdays.
- Basic security headers, request size limit, parameterized SQL, and a health endpoint.
- PWA manifest, icons, and static shell caching. API responses are not cached.
- Render Blueprint (`render.yaml`) for web service + PostgreSQL database.

## Service catalogue and pricing

The database seeds 100 catalogue entries on first startup. Prices and durations are **sample starting values in Kenyan shillings**, not verified salon quotations. Review every service, price, duration, staff qualification and availability before accepting customer bookings. Some services may be hidden in the owner dashboard if the salon does not offer them. Existing databases are migrated to add service categories; the default catalogue is inserted without overwriting existing services or their prices.

## Quality review

See [QUALITY-REVIEW.md](./QUALITY-REVIEW.md) for the checks performed, feature gaps compared with mature salon platforms, and the production-readiness checklist. JavaScript syntax checks pass, but live PostgreSQL integration and end-to-end testing have not yet been completed.

## Before real customers use it

This project is complete as an initial deployable business application, but it has not been deployed or tested against your actual Render database yet. Set real business details, review all prices, test bookings end-to-end, and set a strong unique owner password before sharing the link. A production security review and backups are strongly recommended for a serious business.

## Deploy to Render (recommended)

1. Upload this folder to a **private GitHub repository**. Do not upload a real `.env` file or passwords.
2. In Render, choose **New + → Blueprint**, connect the repository, and let Render read `render.yaml`. It defines a Node web service and a PostgreSQL database.
3. When prompted for `ADMIN_EMAIL`, set the owner email. Set `ADMIN_PASSWORD` to a unique password at least 12 characters long. Set `SALON_WHATSAPP` to the salon's WhatsApp number in international digits (for Kenya, usually `2547...`, without `+` or spaces). Do not share these values with customers.
4. Confirm the database and web service are created, then wait for the deploy to finish. Render provides an HTTPS `onrender.com` URL.
5. Visit `https://YOUR-SERVICE.onrender.com/health`. It should return `{"ok":true,"service":"Pinnacle BeautyParlour","database":"connected"}`.
6. Open the site, go to **Owner login**, sign in, set the salon name/WhatsApp/hours, review services and prices, then submit a test booking and manage it from the owner dashboard.
7. Install on Android: open the HTTPS site in Chrome → browser menu → **Install app** or **Add to Home screen**. It behaves like an app without needing an APK. A native APK is a separate optional build.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Render PostgreSQL internal connection string. |
| `SESSION_SECRET` | Yes in production | Random secret, at least 32 characters; Render Blueprint can generate it. |
| `ADMIN_EMAIL` | Yes in production | Owner login email. |
| `ADMIN_PASSWORD` | Yes in production | Unique owner password, 12+ characters. |
| `SALON_NAME` | No | Public salon name. |
| `SALON_WHATSAPP` | No | WhatsApp phone in international format. |
| `SALON_CURRENCY` | No | Defaults to `KSh`. |
| `TIME_ZONE` | No | Defaults to `Africa/Nairobi`. |
| `PORT` | No | Render supplies this automatically. |

## Run locally

Requires Node.js 20+ and PostgreSQL. Create a database, copy `.env.example` to `.env`, and edit `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. Then:

```bash
npm install
npm start
```

Open `http://localhost:3000`. Do not expose a local development instance to the public internet. Production mode requires strong credentials and a session secret.

## Important operational notes

- Appointment requests are stored in PostgreSQL and can be seen from the owner dashboard on another device.
- The customer submits an appointment **request**, not a guaranteed reservation. The salon must confirm it.
- WhatsApp is opened as a pre-filled message for the customer/owner to send manually; the app does not send messages in the background.
- No online payment or M-Pesa integration is enabled. Do not advertise payments as supported until an actual payment provider is integrated and tested.
- The app does not email or SMS customers yet.
- Owner login uses the deployment environment credentials. Change the password by updating `ADMIN_PASSWORD` in Render and redeploying; existing signed sessions may remain valid until their 8-hour expiry, so also restart the service after a credential change.
- PostgreSQL storage is persistent; check the database's backup and retention options in Render. Do not rely on an ephemeral web-service filesystem for business records.
- The current default service names and prices are examples; verify them with the salon owner before launch.


## Important: test the offline preview on Android

Extract the ZIP and open `pinnacle-beautyparlour/preview.html` (NOT `public/index.html`) in your browser. The preview's 100 services are embedded directly in `preview.js`, so it does not need to fetch a separate JSON file, which browsers may block when opening a local `file://` page. Search and category filters should populate immediately. Preview bookings remain local to that browser/device and are not sent to the salon.

`public/index.html` is the full application frontend and expects the Node server/API to be running; opening that file directly will leave its service dropdown loading because `/api/services` is not available from a local file.
