import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';

const router = Router();

// Same secret family as authGuard.js's own session JWTs — a distinct
// `purpose` claim keeps a guest-checkin token from being usable as (or
// confused with) a real login/SSO token even though the signing key
// is shared. Long-lived (30d) since a printed/displayed QR is meant to
// stay valid for the whole run-up to and duration of the event.
const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';

/* GET /api/events/:id/checkin-token?contactId=  — staff-only, mints the
   token a "Scan to Check In" QR encodes for one (event, company) pair. */
router.get('/:id/checkin-token', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const contactId = parseInt(req.query.contactId);
  if (isNaN(eventId) || isNaN(contactId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query('SELECT id FROM staff_contacts WHERE id=$1', [contactId]);
    if (!rows[0]) return res.status(404).json({ error: 'Company not found' });
    const token = jwt.sign({ purpose: 'guest-checkin', eventId, contactId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const EVENT_SEL = `
  id, name, event_date AS "eventDate", venue, description,
  invitation_image AS "invitationImage",
  appreciation_theme_image AS "appreciationThemeImage",
  photo_gallery_facebook     AS "photoGalleryFacebook",
  photo_gallery_google_drive AS "photoGalleryGoogleDrive",
  photo_gallery_instagram    AS "photoGalleryInstagram",
  photo_gallery_tiktok       AS "photoGalleryTiktok",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
`;

/* GET /api/events — list, with summary guest counts */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.id, e.name, e.event_date AS "eventDate", e.venue, e.description,
             e.invitation_image AS "invitationImage",
             e.appreciation_theme_image AS "appreciationThemeImage",
             e.photo_gallery_facebook     AS "photoGalleryFacebook",
             e.photo_gallery_google_drive AS "photoGalleryGoogleDrive",
             e.photo_gallery_instagram    AS "photoGalleryInstagram",
             e.photo_gallery_tiktok       AS "photoGalleryTiktok",
             e.created_by AS "createdBy", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
             COUNT(g.id) FILTER (WHERE g.invited)                    AS "invitedCount",
             COUNT(g.id) FILTER (WHERE g.confirmed)                  AS "confirmedCount",
             COUNT(g.id) FILTER (WHERE g.attended)                   AS "attendedCount",
             COUNT(g.id) FILTER (WHERE g.attended AND NOT g.invited) AS "uncalledCount"
      FROM events e
      LEFT JOIN event_guests g ON g.event_id = e.id
      GROUP BY e.id
      ORDER BY e.event_date DESC NULLS LAST, e.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/events */
router.post('/', async (req, res) => {
  const { name, eventDate, venue, description, invitationImage,
          photoGalleryFacebook, photoGalleryGoogleDrive, photoGalleryInstagram, photoGalleryTiktok } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Event Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO events
         (name, event_date, venue, description, invitation_image,
          photo_gallery_facebook, photo_gallery_google_drive, photo_gallery_instagram, photo_gallery_tiktok,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${EVENT_SEL}`,
      [name.trim(), eventDate || null, venue || null, description || null, invitationImage || null,
       photoGalleryFacebook || null, photoGalleryGoogleDrive || null, photoGalleryInstagram || null, photoGalleryTiktok || null,
       req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/events/:id */
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, eventDate, venue, description, invitationImage,
          photoGalleryFacebook, photoGalleryGoogleDrive, photoGalleryInstagram, photoGalleryTiktok } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Event Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE events
       SET name=$1, event_date=$2, venue=$3, description=$4, invitation_image=$5,
           photo_gallery_facebook=$6, photo_gallery_google_drive=$7, photo_gallery_instagram=$8, photo_gallery_tiktok=$9,
           updated_at=NOW()
       WHERE id=$10 RETURNING ${EVENT_SEL}`,
      [name.trim(), eventDate || null, venue || null, description || null, invitationImage || null,
       photoGalleryFacebook || null, photoGalleryGoogleDrive || null, photoGalleryInstagram || null, photoGalleryTiktok || null,
       id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /api/events/:id/appreciation-theme — body { image } (base64 data URL,
   or null to clear). Deliberately its own tiny endpoint rather than routed
   through PUT /:id — the Appreciation Ceremony screen only ever has the
   theme image to change, and reusing the full PUT (which requires every
   other field too) would risk overwriting the rest of the event from a
   stale local copy. */
router.patch('/:id/appreciation-theme', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { image } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE events SET appreciation_theme_image=$1, updated_at=NOW() WHERE id=$2 RETURNING ${EVENT_SEL}`,
      [image || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/events/:id — cascades guests/products/gifts/awards */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query('DELETE FROM events WHERE id=$1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Guests — invitation / confirmation / visitor registration / uncalled
// ══════════════════════════════════════════════════════════════════════════
const GUEST_SEL = `
  id, event_id AS "eventId", contact_id AS "contactId", contact_person_id AS "contactPersonId",
  name, contact, organization,
  invited, confirmed, attended, checked_in_at AS "checkedInAt", lucky_draw_no AS "luckyDrawNo",
  invitation_sent AS "invitationSent", invitation_sent_at AS "invitationSentAt",
  invitation_photo AS "invitationPhoto", remark, created_at AS "createdAt",
  expected_guests AS "expectedGuests", participant_count AS "participantCount",
  companions
`;

router.get('/:id/guests', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.event_id AS "eventId", g.contact_id AS "contactId", g.contact_person_id AS "contactPersonId",
              -- Linked guests treat Contact as the single source of truth — always
              -- resolve live from staff_contacts/staff_contact_persons instead of
              -- trusting event_guests' own name/contact/organization columns, which
              -- only ever hold a point-in-time snapshot from whenever this guest was
              -- last saved. Unlinked (manually-typed) guests fall back to that
              -- snapshot since there's nothing to resolve. Mirrors the exact
              -- contactDisplayName/Phone/Org precedence already used client-side.
              MAX(COALESCE(
                CASE
                  WHEN scp.id IS NOT NULL THEN scp.name
                  WHEN sc.contact_info = 'company'  THEN sc.company_name
                  WHEN sc.contact_info = 'personal' THEN sc.person_name
                END,
                g.name
              )) AS name,
              MAX(COALESCE(
                CASE
                  WHEN scp.id IS NOT NULL THEN COALESCE(scp.mobile1, scp.mobile2, sc.company_phone)
                  WHEN sc.contact_info = 'company'  THEN sc.company_phone
                  WHEN sc.contact_info = 'personal' THEN COALESCE(sc.mobile1, sc.mobile2)
                END,
                g.contact
              )) AS contact,
              MAX(COALESCE(
                CASE
                  WHEN scp.id IS NOT NULL THEN sc.company_name
                  WHEN sc.contact_info = 'company'  THEN sc.company_name
                  WHEN sc.contact_info = 'personal' THEN sc.office
                END,
                g.organization
              )) AS organization,
              MAX(scp.post) AS post,
              MAX(COALESCE(
                CASE
                  WHEN scp.id IS NOT NULL THEN scp.mobile2
                  WHEN sc.contact_info = 'personal' THEN sc.mobile2
                END
              )) AS "mobile2",
              MAX(COALESCE(
                CASE
                  WHEN scp.id IS NOT NULL THEN scp.email
                  WHEN sc.contact_info = 'company'  THEN sc.company_email
                  WHEN sc.contact_info = 'personal' THEN sc.email
                END
              )) AS email,
              g.invited, g.confirmed, g.attended, g.checked_in_at AS "checkedInAt", g.lucky_draw_no AS "luckyDrawNo",
              g.invitation_sent AS "invitationSent", g.invitation_sent_at AS "invitationSentAt",
              g.invitation_photo AS "invitationPhoto", g.remark, g.created_at AS "createdAt",
              g.expected_guests AS "expectedGuests", g.participant_count AS "participantCount",
              g.companions,
              COUNT(DISTINCT f.id)::int AS "followupCount",
              COUNT(DISTINCT w.id)::int AS "whatsappSentCount"
       FROM event_guests g
       LEFT JOIN staff_contacts sc ON sc.id = g.contact_id
       LEFT JOIN staff_contact_persons scp ON scp.id = g.contact_person_id
       LEFT JOIN event_guest_followups f ON f.guest_id = g.id
       LEFT JOIN event_guest_whatsapp_sends w ON w.guest_id = g.id
       WHERE g.event_id=$1
       GROUP BY g.id
       ORDER BY g.id DESC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/guests', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { contactId, contactPersonId, name, contact, organization, invited, confirmed, attended,
          invitationSent, invitationPhoto, remark, expectedGuests, participantCount, companions } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const cleanCompanions = Array.isArray(companions)
      ? companions.filter(c => (c?.name || '').trim()).map(c => ({
          name: c.name.trim(), post: (c.post||'').trim()||null, mobile1: (c.mobile1||'').trim()||null,
          mobile2: (c.mobile2||'').trim()||null, email: (c.email||'').trim()||null,
        })) : [];
    const { rows } = await pool.query(
      `INSERT INTO event_guests
         (event_id, contact_id, contact_person_id, name, contact, organization, invited, confirmed, attended, checked_in_at,
          invitation_sent, invitation_sent_at, invitation_photo, remark, expected_guests, participant_count, companions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING ${GUEST_SEL}`,
      [eventId, contactId || null, contactPersonId || null, name.trim(), contact || null, organization || null,
       invited !== false, !!confirmed, !!attended, attended ? new Date() : null,
       !!invitationSent, invitationSent ? new Date() : null, invitationPhoto || null, remark || null,
       expectedGuests !== '' && expectedGuests != null ? Number(expectedGuests) : null,
       participantCount !== '' && participantCount != null ? Number(participantCount) : null,
       cleanCompanions.length ? JSON.stringify(cleanCompanions) : null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/guests/:gid', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  const { contactId, contactPersonId, name, contact, organization, invited, confirmed, attended,
          invitationSent, invitationPhoto, remark, expectedGuests, participantCount, companions } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    // checked_in_at / invitation_sent_at are only stamped the moment their
    // flag flips false→true — an already-set guest being edited for other
    // fields keeps its original timestamp instead of jumping to "now" on
    // every save. lucky_draw_no follows the same one-time rule (assigned
    // the first time attended flips true, same numbering as the public
    // QR check-in/self-registration paths — see utils/luckyDraw.js).
    const { rows: existing } = await pool.query(
      'SELECT event_id, attended, checked_in_at, lucky_draw_no, invitation_sent, invitation_sent_at FROM event_guests WHERE id=$1', [gid]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Guest not found' });
    const nextAttended = !!attended;
    const checkedInAt = nextAttended
      ? (existing[0].attended ? existing[0].checked_in_at : new Date())
      : null;
    let luckyDrawNo = existing[0].lucky_draw_no;
    if (nextAttended && luckyDrawNo == null) {
      const { rows: nextNo } = await pool.query(
        'SELECT COALESCE(MAX(lucky_draw_no), 0) + 1 AS next FROM event_guests WHERE event_id=$1',
        [existing[0].event_id]
      );
      luckyDrawNo = nextNo[0].next;
    }
    const nextInvitationSent = !!invitationSent;
    const invitationSentAt = nextInvitationSent
      ? (existing[0].invitation_sent ? existing[0].invitation_sent_at : new Date())
      : null;
    const cleanCompanions = Array.isArray(companions)
      ? companions.filter(c => (c?.name || '').trim()).map(c => ({
          name: c.name.trim(), post: (c.post||'').trim()||null, mobile1: (c.mobile1||'').trim()||null,
          mobile2: (c.mobile2||'').trim()||null, email: (c.email||'').trim()||null,
        })) : [];
    const { rows } = await pool.query(
      `UPDATE event_guests
       SET contact_id=$1, contact_person_id=$2, name=$3, contact=$4, organization=$5, invited=$6, confirmed=$7,
           attended=$8, checked_in_at=$9, lucky_draw_no=$10, invitation_sent=$11, invitation_sent_at=$12,
           invitation_photo=$13, remark=$14, expected_guests=$15, participant_count=$16, companions=$17, updated_at=NOW()
       WHERE id=$18 RETURNING ${GUEST_SEL}`,
      [contactId || null, contactPersonId || null, name.trim(), contact || null, organization || null,
       invited !== false, !!confirmed, nextAttended, checkedInAt, luckyDrawNo,
       nextInvitationSent, invitationSentAt, invitationPhoto || null, remark || null,
       expectedGuests !== '' && expectedGuests != null ? Number(expectedGuests) : null,
       participantCount !== '' && participantCount != null ? Number(participantCount) : null,
       cleanCompanions.length ? JSON.stringify(cleanCompanions) : null, gid]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/guests/:gid', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_guests WHERE id=$1', [gid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/events/:id/guests/reset-coupons — Admin/Super Admin only. Wipes
   every guest's lucky_draw_no for this event (including anyone who was
   un-registered later and would otherwise be left holding a stale number —
   see toggleAttendedInForm in EventVisitorRegistration.jsx) and any saved
   Coupon Lucky Draw winners, which would otherwise reference numbers that no
   longer belong to anyone, then hands out fresh sequential numbers (#001,
   #002, ...) to everyone currently checked in, ordered by check-in time.
   Locked the same way as live QR check-ins (utils/luckyDraw.js) so a scan
   arriving mid-reset can't race the renumbering. */
router.post('/:id/guests/reset-coupons', requireRole('admin', 'superAdmin'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [eventId]);
    await client.query('DELETE FROM event_lucky_draw_winners WHERE event_id=$1 AND draw_type=$2', [eventId, 'coupon']);
    await client.query('UPDATE event_guests SET lucky_draw_no=NULL WHERE event_id=$1', [eventId]);
    await client.query(
      `UPDATE event_guests g SET lucky_draw_no = renum.rn
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY checked_in_at ASC NULLS LAST, id ASC) AS rn
         FROM event_guests WHERE event_id=$1 AND attended=TRUE
       ) renum
       WHERE g.id = renum.id`,
      [eventId]
    );
    const { rows } = await client.query(`SELECT ${GUEST_SEL} FROM event_guests WHERE event_id=$1 ORDER BY id`, [eventId]);
    await client.query('COMMIT');
    res.json(rows);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Followup History — per guest ──
const FOLLOWUP_SEL = `
  f.id, f.guest_id AS "guestId", f.note, f.created_at AS "createdAt",
  f.created_by AS "createdBy", u.full_name AS "createdByName",
  f.follow_up_via AS "followUpVia", f.status
`;

router.get('/:id/guests/:gid/followups', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${FOLLOWUP_SEL} FROM event_guest_followups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.guest_id=$1 ORDER BY f.created_at DESC`,
      [gid]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/guests/:gid/followups', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  const { note, followUpVia, status } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_guest_followups (guest_id, note, created_by, follow_up_via, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [gid, note.trim(), req.user.id, followUpVia || null, status || null]
    );
    const { rows: full } = await pool.query(
      `SELECT ${FOLLOWUP_SEL} FROM event_guest_followups f LEFT JOIN users u ON u.id = f.created_by WHERE f.id=$1`,
      [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/guests/:gid/followups/:fid', async (req, res) => {
  const fid = parseInt(req.params.fid);
  if (isNaN(fid)) return res.status(400).json({ error: 'Invalid id' });
  const { note, followUpVia, status } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });
  try {
    await pool.query(
      `UPDATE event_guest_followups SET note=$1, follow_up_via=$2, status=$3 WHERE id=$4`,
      [note.trim(), followUpVia || null, status || null, fid]
    );
    const { rows: full } = await pool.query(
      `SELECT ${FOLLOWUP_SEL} FROM event_guest_followups f LEFT JOIN users u ON u.id = f.created_by WHERE f.id=$1`,
      [fid]
    );
    res.json(full[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/guests/:gid/followups/:fid', async (req, res) => {
  const fid = parseInt(req.params.fid);
  if (isNaN(fid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_guest_followups WHERE id=$1', [fid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Logs one click of the thank-you WhatsApp button (click-to-chat only — this
// records that the compose window was opened, not that the guest's WhatsApp
// actually delivered it, same caveat as every other WhatsApp button in the
// app) so the Guests grid can show how many times it's been sent per guest.
router.post('/:id/guests/:gid/whatsapp-sent', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('INSERT INTO event_guest_whatsapp_sends (guest_id) VALUES ($1)', [gid]);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM event_guest_whatsapp_sends WHERE guest_id=$1', [gid]);
    res.status(201).json({ whatsappSentCount: rows[0].count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Products — display items sent to the venue, in/out checklist
// ══════════════════════════════════════════════════════════════════════════
const PRODUCT_SEL = `
  id, event_id AS "eventId", product_name AS "productName", quantity,
  sent_out AS "sentOut", sent_out_at AS "sentOutAt",
  returned, returned_at AS "returnedAt", remark, created_at AS "createdAt"
`;

router.get('/:id/products', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${PRODUCT_SEL} FROM event_products WHERE event_id=$1 ORDER BY id DESC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/products', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { productName, quantity, sentOut, returned, remark } = req.body;
  if (!productName?.trim()) return res.status(400).json({ error: 'Product Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_products
         (event_id, product_name, quantity, sent_out, sent_out_at, returned, returned_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PRODUCT_SEL}`,
      [eventId, productName.trim(), quantity || 1,
       !!sentOut, sentOut ? new Date() : null,
       !!returned, returned ? new Date() : null, remark || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/products/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid id' });
  const { productName, quantity, sentOut, returned, remark } = req.body;
  if (!productName?.trim()) return res.status(400).json({ error: 'Product Name is required' });
  try {
    const { rows: existing } = await pool.query('SELECT sent_out, sent_out_at, returned, returned_at FROM event_products WHERE id=$1', [pid]);
    if (!existing[0]) return res.status(404).json({ error: 'Product not found' });
    const e0 = existing[0];
    const nextSentOut  = !!sentOut;
    const nextReturned = !!returned;
    const sentOutAt  = nextSentOut  ? (e0.sent_out  ? e0.sent_out_at  : new Date()) : null;
    const returnedAt = nextReturned ? (e0.returned  ? e0.returned_at : new Date()) : null;
    const { rows } = await pool.query(
      `UPDATE event_products
       SET product_name=$1, quantity=$2, sent_out=$3, sent_out_at=$4,
           returned=$5, returned_at=$6, remark=$7, updated_at=NOW()
       WHERE id=$8 RETURNING ${PRODUCT_SEL}`,
      [productName.trim(), quantity || 1, nextSentOut, sentOutAt, nextReturned, returnedAt, remark || null, pid]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/products/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_products WHERE id=$1', [pid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Gift Hampers
// ══════════════════════════════════════════════════════════════════════════
const GIFT_SEL = `
  id, event_id AS "eventId", gift_name AS "giftName", recipient_name AS "recipientName",
  quantity, given_at AS "givenAt", remark, created_at AS "createdAt"
`;

router.get('/:id/gifts', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${GIFT_SEL} FROM event_gifts WHERE event_id=$1 ORDER BY id DESC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/gifts', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { giftName, recipientName, quantity, remark } = req.body;
  if (!giftName?.trim()) return res.status(400).json({ error: 'Gift Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_gifts (event_id, gift_name, recipient_name, quantity, given_at, remark)
       VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING ${GIFT_SEL}`,
      [eventId, giftName.trim(), recipientName || null, quantity || 1, remark || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/gifts/:gid', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  const { giftName, recipientName, quantity, remark } = req.body;
  if (!giftName?.trim()) return res.status(400).json({ error: 'Gift Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE event_gifts SET gift_name=$1, recipient_name=$2, quantity=$3, remark=$4
       WHERE id=$5 RETURNING ${GIFT_SEL}`,
      [giftName.trim(), recipientName || null, quantity || 1, remark || null, gid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Gift not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/gifts/:gid', async (req, res) => {
  const gid = parseInt(req.params.gid);
  if (isNaN(gid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_gifts WHERE id=$1', [gid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Awards
// ══════════════════════════════════════════════════════════════════════════
const AWARD_SEL = `
  id, event_id AS "eventId", award_name AS "awardName", recipient_name AS "recipientName",
  given_at AS "givenAt", remark, created_at AS "createdAt"
`;

router.get('/:id/awards', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${AWARD_SEL} FROM event_awards WHERE event_id=$1 ORDER BY id DESC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/awards', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { awardName, recipientName, remark } = req.body;
  if (!awardName?.trim()) return res.status(400).json({ error: 'Award Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_awards (event_id, award_name, recipient_name, given_at, remark)
       VALUES ($1,$2,$3,NOW(),$4) RETURNING ${AWARD_SEL}`,
      [eventId, awardName.trim(), recipientName || null, remark || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/awards/:aid', async (req, res) => {
  const aid = parseInt(req.params.aid);
  if (isNaN(aid)) return res.status(400).json({ error: 'Invalid id' });
  const { awardName, recipientName, remark } = req.body;
  if (!awardName?.trim()) return res.status(400).json({ error: 'Award Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE event_awards SET award_name=$1, recipient_name=$2, remark=$3
       WHERE id=$4 RETURNING ${AWARD_SEL}`,
      [awardName.trim(), recipientName || null, remark || null, aid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Award not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/awards/:aid', async (req, res) => {
  const aid = parseInt(req.params.aid);
  if (isNaN(aid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_awards WHERE id=$1', [aid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Question Answer Lucky Draw — a question + 4 options "sent" (displayed
//  full-screen) for the room, a manually-recorded winner once someone
//  answers correctly, then marked completed. Multiple rounds per event.
// ══════════════════════════════════════════════════════════════════════════
const QA_SEL = `
  id, event_id AS "eventId", question,
  option1, option2, option3, option4, correct_option AS "correctOption",
  winner_name AS "winnerName", winner_company AS "winnerCompany", completed, created_at AS "createdAt"
`;

router.get('/:id/qa-draws', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${QA_SEL} FROM event_qa_draws WHERE event_id=$1 ORDER BY id DESC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Creating a question round is admin/superAdmin only — anyone else with
// Visitor Registration access can still run a round (set the winner, mark
// complete) once one exists, but only admins author/edit the quiz content.
router.post('/:id/qa-draws', requireRole('admin', 'superAdmin'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { question, option1, option2, option3, option4, correctOption } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Question is required' });
  if (![option1, option2, option3, option4].every(o => o?.trim())) {
    return res.status(400).json({ error: 'All four options are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_qa_draws (event_id, question, option1, option2, option3, option4, correct_option)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${QA_SEL}`,
      [eventId, question.trim(), option1.trim(), option2.trim(), option3.trim(), option4.trim(), correctOption || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The whole Question Lucky Draw "Manage" screen — content edits, winner,
// and completion — is admin/superAdmin only; everyone else only ever sees
// the read-only Present-to-Room view on the frontend, so this covers both.
router.put('/:id/qa-draws/:qid', requireRole('admin', 'superAdmin'), async (req, res) => {
  const qid = parseInt(req.params.qid);
  if (isNaN(qid)) return res.status(400).json({ error: 'Invalid id' });
  const { question, option1, option2, option3, option4, winnerName, winnerCompany, completed, correctOption } = req.body;
  const editingContent = question !== undefined;
  if (editingContent) {
    if (!question?.trim()) return res.status(400).json({ error: 'Question is required' });
    if (![option1, option2, option3, option4].every(o => o?.trim())) {
      return res.status(400).json({ error: 'All four options are required' });
    }
  }
  try {
    const { rows: existing } = await pool.query('SELECT * FROM event_qa_draws WHERE id=$1', [qid]);
    if (!existing[0]) return res.status(404).json({ error: 'Question not found' });
    const e = existing[0];
    const { rows } = await pool.query(
      `UPDATE event_qa_draws
       SET question=$1, option1=$2, option2=$3, option3=$4, option4=$5, correct_option=$6,
           winner_name=$7, winner_company=$8, completed=$9, updated_at=NOW()
       WHERE id=$10 RETURNING ${QA_SEL}`,
      [
        editingContent ? question.trim() : e.question,
        editingContent ? option1.trim() : e.option1,
        editingContent ? option2.trim() : e.option2,
        editingContent ? option3.trim() : e.option3,
        editingContent ? option4.trim() : e.option4,
        correctOption !== undefined ? (correctOption || null) : e.correct_option,
        winnerName !== undefined ? (winnerName || null) : e.winner_name,
        winnerCompany !== undefined ? (winnerCompany || null) : e.winner_company,
        completed !== undefined ? !!completed : e.completed,
        qid,
      ]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/qa-draws/:qid', requireRole('admin', 'superAdmin'), async (req, res) => {
  const qid = parseInt(req.params.qid);
  if (isNaN(qid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM event_qa_draws WHERE id=$1', [qid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Coupon / Spin Lucky Draw winners — one saved row per revealed winner.
//  item_key uniquely identifies the winning entry within its draw_type's pool
//  (the coupon number, or the company name) so the wheel can exclude it on
//  every later spin.
// ══════════════════════════════════════════════════════════════════════════
const LDW_SEL = `
  id, event_id AS "eventId", draw_type AS "drawType", item_key AS "itemKey",
  label, subtitle1, subtitle2, won_at AS "wonAt"
`;

router.get('/:id/lucky-draw-winners', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${LDW_SEL} FROM event_lucky_draw_winners WHERE event_id=$1 ORDER BY id ASC`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/lucky-draw-winners', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { drawType, itemKey, label, subtitle1, subtitle2 } = req.body;
  if (!drawType?.trim() || !String(itemKey ?? '').trim() || !label?.trim()) {
    return res.status(400).json({ error: 'drawType, itemKey and label are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_lucky_draw_winners (event_id, draw_type, item_key, label, subtitle1, subtitle2)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${LDW_SEL}`,
      [eventId, drawType.trim(), String(itemKey).trim(), label.trim(), subtitle1 || null, subtitle2 || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/events/:id/lucky-draw-winners?drawType=coupon — "Reset" on the
   draw screen: clears every saved winner for ONE draw type on this event
   (coupon vs. company are reset independently), returning that draw's pool
   to fully open on the next spin. */
router.delete('/:id/lucky-draw-winners', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const drawType = req.query.drawType;
  if (!drawType?.trim()) return res.status(400).json({ error: 'drawType is required' });
  try {
    await pool.query('DELETE FROM event_lucky_draw_winners WHERE event_id=$1 AND draw_type=$2', [eventId, drawType.trim()]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  Appreciation Ceremony — per-company "done" (appreciated) and "removed"
//  (admin-excluded from the ceremony) status. "removed" is a soft flag only
//  scoped to this ceremony screen — it never touches the underlying guest
//  check-in/company data, it just excludes that company from the caller list.
// ══════════════════════════════════════════════════════════════════════════
const APPR_SEL = `id, event_id AS "eventId", company, done, removed, updated_at AS "updatedAt"`;

router.get('/:id/appreciation-status', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${APPR_SEL} FROM event_appreciation_status WHERE event_id=$1`, [eventId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /api/events/:id/appreciation-status — body { company, done } —
   toggles the "appreciated" checkmark for one company. Open to any staff
   running the ceremony, not admin-gated (unlike the delete below). */
router.patch('/:id/appreciation-status', async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { company, done } = req.body;
  if (!company?.trim()) return res.status(400).json({ error: 'company is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_appreciation_status (event_id, company, done)
       VALUES ($1,$2,$3)
       ON CONFLICT (event_id, company) DO UPDATE SET done=$3, updated_at=NOW()
       RETURNING ${APPR_SEL}`,
      [eventId, company.trim(), !!done]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/events/:id/appreciation-status?company=... — Admin/Super Admin
   only: removes one company from the ceremony's caller list. */
router.delete('/:id/appreciation-status', requireRole('admin', 'superAdmin'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const company = req.query.company;
  if (!company?.trim()) return res.status(400).json({ error: 'company is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO event_appreciation_status (event_id, company, removed)
       VALUES ($1,$2,TRUE)
       ON CONFLICT (event_id, company) DO UPDATE SET removed=TRUE, updated_at=NOW()
       RETURNING ${APPR_SEL}`,
      [eventId, company.trim()]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /api/events/:id/appreciation-status/restore — body { company } —
   Admin/Super Admin only: undoes a previous removal, putting the company
   back in the ceremony's calling list. */
router.patch('/:id/appreciation-status/restore', requireRole('admin', 'superAdmin'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid id' });
  const { company } = req.body;
  if (!company?.trim()) return res.status(400).json({ error: 'company is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE event_appreciation_status SET removed=FALSE, updated_at=NOW()
       WHERE event_id=$1 AND company=$2 RETURNING ${APPR_SEL}`,
      [eventId, company.trim()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
