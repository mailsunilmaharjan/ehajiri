import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { getCompanyName } from '../utils/appSettings.js';
import { checkInGuest, insertCheckedInGuest } from '../utils/luckyDraw.js';

const router = Router();

// Must match events.js's own JWT_SECRET exactly — that's where these tokens
// are minted (GET /api/events/:id/checkin-token, staff-only).
const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';

// This whole router is intentionally NOT behind authGuard (see server/index.js)
// — it's the landing page for a QR a guest scans on their own phone with no
// eHajiri login at all. Every request must carry a valid signed token, and
// every DB read/write is scoped to exactly the (eventId, contactId) baked
// into that token — never trusts an eventId/contactId/guestId from the
// request body/query directly.
function verifyToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (payload.purpose !== 'guest-checkin') throw new Error('Invalid token');
  return payload;
}

// Re-checked server-side on every write (not just trusted from /verify's
// response) since a guest may leave the page open across midnight.
async function isEventToday(eventId) {
  const { rows } = await pool.query(`SELECT (event_date = CURRENT_DATE) AS "isEventDay" FROM events WHERE id=$1`, [eventId]);
  return !!rows[0]?.isEventDay;
}

/* GET /api/guest-checkin/verify?token=  — landing page data: event info +
   this company's guest list (name/attended/checkedInAt only). */
router.get('/verify', async (req, res) => {
  try {
    const { eventId, contactId } = verifyToken(req.query.token || '');

    const { rows: eventRows } = await pool.query(
      `SELECT id, name, event_date AS "eventDate", venue, invitation_image AS "invitationImage",
              (event_date = CURRENT_DATE) AS "isEventDay", (event_date > CURRENT_DATE) AS "isUpcoming"
       FROM events WHERE id=$1`, [eventId]
    );
    if (!eventRows[0]) return res.status(404).json({ error: 'Event not found' });

    const { rows: contactRows } = await pool.query(
      `SELECT id, company_name AS "companyName" FROM staff_contacts WHERE id=$1`, [contactId]
    );
    if (!contactRows[0]) return res.status(404).json({ error: 'Company not found' });

    const { rows: guests } = await pool.query(
      `SELECT g.id, g.name, g.attended, g.checked_in_at AS "checkedInAt",
              g.contact_person_id AS "contactPersonId",
              scp.post, scp.department, scp.mobile1, scp.mobile2, scp.email
       FROM event_guests g
       LEFT JOIN staff_contact_persons scp ON scp.id = g.contact_person_id
       WHERE g.event_id=$1 AND g.contact_id=$2 ORDER BY g.name ASC`,
      [eventId, contactId]
    );

    const organizerName = await getCompanyName();

    res.json({ event: eventRows[0], company: contactRows[0], guests, organizerName });
  } catch (e) { res.status(401).json({ error: 'Invalid or expired link' }); }
});

async function confirmationPayload(eventId, guest) {
  const { rows: eventRows } = await pool.query(
    `SELECT name, invitation_image AS "invitationImage" FROM events WHERE id=$1`, [eventId]
  );
  const organizerName = await getCompanyName();
  return {
    guest,
    event: eventRows[0],
    organizerName,
    message: `Thank you for visiting ${eventRows[0]?.name || 'the event'}, organized by ${organizerName}.`,
  };
}

/* POST /api/guest-checkin/checkin  — body { token, guestId } */
router.post('/checkin', async (req, res) => {
  try {
    const { eventId, contactId } = verifyToken(req.body.token || '');
    const guestId = parseInt(req.body.guestId);
    if (isNaN(guestId)) return res.status(400).json({ error: 'Invalid guest' });

    if (!(await isEventToday(eventId))) return res.status(403).json({ error: 'Check-in is only available on the event date.' });

    // Guarded update — guestId must actually belong to this exact
    // (eventId, contactId) pair, so a valid token for one company can never
    // be used to check in a guest that belongs to a different company/event.
    const guest = await checkInGuest(guestId, eventId, 'AND contact_id=$3', [contactId]);
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    res.json(await confirmationPayload(eventId, guest));
  } catch (e) { res.status(401).json({ error: 'Invalid or expired link' }); }
});

/* PUT /api/guest-checkin/guest — body { token, guestId, name, post, department,
   mobile1, mobile2, email }
   Self-service correction — a guest fixing a typo in their own name/contact
   info (the same fields /register collects), scanned from their own phone,
   no eHajiri login. Scoped to (eventId, contactId) baked into the token,
   exactly like /checkin, so this token can never touch another company's
   guest. Updates the real staff_contact_persons record when this guest is
   linked to one (true for anyone shown on this page — see /verify's join)
   so the fix is visible everywhere that person appears, not just here;
   falls back to just the event_guests snapshot for the rare unlinked row. */
router.put('/guest', async (req, res) => {
  try {
    const { eventId, contactId } = verifyToken(req.body.token || '');
    const guestId = parseInt(req.body.guestId);
    if (isNaN(guestId)) return res.status(400).json({ error: 'Invalid guest' });
    const name = (req.body.name || '').trim();
    const post = (req.body.post || '').trim();
    const department = (req.body.department || '').trim();
    const mobile1 = (req.body.mobile1 || '').trim();
    const mobile2 = (req.body.mobile2 || '').trim();
    const email = (req.body.email || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { rows: guestRows } = await pool.query(
      `SELECT id, contact_person_id AS "contactPersonId" FROM event_guests
       WHERE id=$1 AND event_id=$2 AND contact_id=$3`,
      [guestId, eventId, contactId]
    );
    if (!guestRows[0]) return res.status(404).json({ error: 'Guest not found' });
    const { contactPersonId } = guestRows[0];

    if (contactPersonId) {
      await pool.query(
        `UPDATE staff_contact_persons SET name=$1, post=$2, department=$3, mobile1=$4, mobile2=$5, email=$6
         WHERE id=$7`,
        [name, post || null, department || null, mobile1 || null, mobile2 || null, email || null, contactPersonId]
      );
    }
    const { rows } = await pool.query(
      `UPDATE event_guests SET name=$1, contact=$2 WHERE id=$3
       RETURNING id, name, attended, checked_in_at AS "checkedInAt"`,
      [name, mobile1 || null, guestId]
    );
    res.json({ guest: { ...rows[0], contactPersonId, post, department, mobile1, mobile2, email } });
  } catch (e) { res.status(401).json({ error: 'Invalid or expired link' }); }
});

/* POST /api/guest-checkin/register — body { token, name, post, department,
   mobile1, mobile2, email }
   Self-registration — used both when nobody from this company has been
   pre-added yet, and any time via the always-available "+ Add New Guest"
   button. Creates a genuine Contact Person under this company (same
   staff_contact_persons table Staff → Contact manages — shows up there
   too, not just as a one-off event record), then a guest row linked to it,
   scoped to the token's (event, company) exactly like /checkin's update is,
   marked invited:false (walk-in/uncalled) and already checked in. */
router.post('/register', async (req, res) => {
  try {
    const { eventId, contactId } = verifyToken(req.body.token || '');
    const name = (req.body.name || '').trim();
    const post = (req.body.post || '').trim();
    const department = (req.body.department || '').trim();
    const mobile1 = (req.body.mobile1 || '').trim();
    const mobile2 = (req.body.mobile2 || '').trim();
    const email = (req.body.email || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    if (!(await isEventToday(eventId))) return res.status(403).json({ error: 'Check-in is only available on the event date.' });

    const { rows: contactRows } = await pool.query(
      `SELECT company_name AS "companyName" FROM staff_contacts WHERE id=$1`, [contactId]
    );
    if (!contactRows[0]) return res.status(404).json({ error: 'Company not found' });
    const companyName = contactRows[0].companyName;

    const guest = await insertCheckedInGuest(eventId, async (client) => {
      // Reuse an existing Contact Person with the same name (case/whitespace-
      // insensitive) under this company instead of creating a duplicate —
      // a guest re-registering (e.g. a second device, a typo'd earlier entry)
      // shouldn't spawn a second "Sunil Maharjan" record.
      const { rows: existingPerson } = await client.query(
        `SELECT id FROM staff_contact_persons WHERE contact_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))`,
        [contactId, name]
      );
      let personId = existingPerson[0]?.id;
      if (!personId) {
        const { rows: personRows } = await client.query(
          `INSERT INTO staff_contact_persons (contact_id, name, post, department, mobile1, mobile2, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [contactId, name, post || null, department || null, mobile1 || null, mobile2 || null, email || null]
        );
        personId = personRows[0].id;
      }

      const { rows } = await client.query(
        `INSERT INTO event_guests
           (event_id, contact_id, contact_person_id, name, contact, organization, invited, attended, checked_in_at, lucky_draw_no)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE,TRUE,NOW(),
           (SELECT COALESCE(MAX(lucky_draw_no), 0) + 1 FROM event_guests WHERE event_id=$1))
         RETURNING id, name, attended, checked_in_at AS "checkedInAt", lucky_draw_no AS "luckyDrawNo"`,
        [eventId, contactId, personId, name, mobile1 || null, companyName]
      );
      return rows[0];
    });

    res.status(201).json(await confirmationPayload(eventId, guest));
  } catch (e) { res.status(401).json({ error: 'Invalid or expired link' }); }
});

export default router;
