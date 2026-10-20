# Pinnacle BeautyParlour — quality and launch review

Review date: 2026-10-19 (updated 2026-10-20)

## Current product scope

This release is a focused salon booking and owner-management MVP. It has a responsive public website, service menu, date/time availability, server-side appointment requests, PostgreSQL persistence, owner sign-in, booking status management, service visibility/addition, salon opening-hours settings, CSV export, PWA assets, and a Render Blueprint.

## Checks performed in this workspace

- `node --check server.js` — passed.
- `node --check public/app.js` — passed.
- `npm run check` — passed.
- Added no-store headers for API responses.
- Added per-IP rate limiting for appointment creation in addition to login rate limiting.
- Past dates return no available slots.
- Slot validation is relative to the salon's opening time, rather than midnight.
- Added validation for closed weekdays, salon name, and opening/closing-time order.
- Added validation for service edits to avoid database constraint errors and accidental truthy strings for booleans.

## Not verified yet

This workspace did not have a reachable PostgreSQL instance or successful dependency installation, so a full live integration test, browser end-to-end test, accessibility audit, production deployment, Android build, and restore-from-backup drill have NOT been completed. Syntax checks do not prove the full app works end to end.

## Comparison with mature salon platforms

Platforms such as Fresha advertise live calendars, team/staff scheduling, customer profiles and history, automated reminders, deposits/payments, checkout/POS, loyalty/marketing, inventory, reviews, and reporting. This project does not yet match that breadth. It is intentionally a smaller direct-booking tool for one salon, not a feature-equivalent replacement for a mature salon management platform.

## Required before relying on it for real business operations

1. Deploy to a staging Render service and run a complete booking/admin test from at least two separate devices.
2. Set a unique strong owner password, correct salon contact details, real prices, business hours, and closed days.
3. Confirm Render database backup/retention settings and test restoring a backup.
4. Add automated integration tests for login, booking validation, overlap prevention, settings, and service management.
5. Add staff roles/audit trail if more than one person will use the dashboard.
6. Add email/SMS/WhatsApp Business notifications only through a configured provider; the current WhatsApp link opens a pre-filled message for a person to send.
7. Add M-Pesa or another payment integration only after provider credentials, callback verification, reconciliation, refunds, and test transactions are implemented.
8. Add privacy notice, data retention/deletion process, and a process for handling customer data requests.
9. Build and test a native Android APK separately if Play Store distribution is required. The current PWA can be installed from the deployed HTTPS website but is not an APK.

## Important behavior

- Customer bookings start as `Requested`; the salon must confirm them.
- Appointment conflicts are checked server-side against Requested and Confirmed bookings.
- The booking API is rate-limited, but this is not a substitute for abuse monitoring or a CAPTCHA if spam becomes a problem.
- Owner login is configured with server environment variables; never commit `.env` or passwords to GitHub.
- The app does not process payments and does not send messages in the background.


## Service menu correction (October 2026)

- Expanded the seeded service catalogue to 100 service entries across 17+ categories.
- Added a `category` column migration and category-aware public/admin service API responses.
- Grouped the booking dropdown using optgroups; each option shows the sample price and estimated duration.
- Added search and category filtering to the public service catalogue and selected-service price/duration information in the booking form.
- Added visible failure messaging and disabled the booking selector when the API cannot load the service menu, rather than leaving a misleading blank/working-looking dropdown.
- JavaScript syntax checks pass. Live database migration, browser UX, booking, concurrency, and end-to-end tests still require execution in a configured staging environment.

## Follow-up review (2026-10-20)

### Strengths confirmed
- Clean, compact Express + PostgreSQL architecture with parameterized queries.
- Proper advisory lock + transaction for booking concurrency.
- Timing-safe password comparison and HttpOnly + SameSite=strict session cookie.
- Rate limiting on login and booking endpoints.
- 100 pre-seeded services with categories, search/filter UI, and server-side availability.
- Render Blueprint ready; health endpoint present.
- Frontend escapes output; PWA shell caching excludes API routes.

### Small improvements applied
- Added composite indexes on `bookings(status, appointment_date)` and `services(active, category)` for faster availability and menu queries.
- Cleaned legacy category migration (categories already correctly set by the seed data).
- Made closed-days parsing more defensive (filter out NaN values).

### Remaining recommendations before real customers
1. Deploy to Render staging and perform a full booking + owner-dashboard test from two devices.
2. Replace sample prices/durations with the salon’s real ones.
3. Set strong unique `ADMIN_PASSWORD` and correct WhatsApp number.
4. Confirm database backup retention on Render.
5. Consider CAPTCHA or stronger bot protection only if booking spam appears.
6. Future: staff accounts, automated WhatsApp/SMS confirmations, and M-Pesa (only after full payment-provider integration).