import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import pool from '../db.js';

const router = Router();

const SEL = `
  id,
  contact_type    AS "contactType",
  contact_info    AS "contactInfo",
  person_name     AS "personName",
  office,
  mobile1,
  mobile2,
  office_phone    AS "officePhone",
  email,
  address,
  company_name    AS "companyName",
  company_phone   AS "companyPhone",
  company_email   AS "companyEmail",
  company_address AS "companyAddress",
  work_scope        AS "workScope",
  customer_category AS "customerCategory",
  customer_type     AS "customerType",
  district,
  created_by        AS "createdBy",
  created_at        AS "createdAt",
  updated_at        AS "updatedAt"
`;

/* GET /api/contacts — public + own private */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SEL} FROM staff_contacts
       WHERE contact_type = 'public'
          OR created_by = $1
       ORDER BY id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/contacts */
router.post('/', validateBody({ contactType: { type: 'scalar', max: 20 }, contactInfo: { type: 'scalar', max: 20 }, personName: { max: 300 }, office: { max: 300 }, mobile1: { max: 60 }, mobile2: { max: 60 }, officePhone: { max: 60 }, email: { max: 300 }, address: { max: 1000 }, companyName: { max: 300 }, companyPhone: { max: 60 }, companyEmail: { max: 300 }, companyAddress: { max: 1000 }, workScope: { max: 1000 }, customerCategory: { max: 200 }, customerType: { max: 200 }, district: { max: 200 } }), async (req, res) => {
  const {
    contactType, contactInfo,
    personName, office, mobile1, mobile2, officePhone, email, address,
    companyName, companyPhone, companyEmail, companyAddress,
    workScope, customerCategory, customerType, district,
  } = req.body;

  if (contactInfo === 'personal' && !personName?.trim())
    return res.status(400).json({ error: 'Person Name is required' });
  if (contactInfo === 'company' && !companyName?.trim())
    return res.status(400).json({ error: 'Company Name is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_contacts
         (contact_type, contact_info, person_name, office, mobile1, mobile2,
          office_phone, email, address, company_name, company_phone,
          company_email, company_address, work_scope,
          customer_category, customer_type, district, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${SEL}`,
      [
        contactType || 'public', contactInfo || 'personal',
        personName || null, office || null, mobile1 || null, mobile2 || null,
        officePhone || null, email || null, address || null,
        companyName || null, companyPhone || null,
        companyEmail || null, companyAddress || null,
        workScope || null,
        customerCategory || null, customerType || null, district || null,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    // 23503 on this specific FK only ever means one thing: req.user.id (from
    // the JWT) no longer exists in users — the account was deleted after this
    // token was issued (tokens last 30 days, authGuard never re-checks the
    // user still exists). Not a generic DB error — force the stale session
    // to log out cleanly instead of surfacing a raw SQL error.
    if (e.code === '23503' && e.constraint === 'staff_contacts_created_by_fkey') {
      return res.status(401).json({ authError: true, error: 'Session expired — please log in again' });
    }
    res.status(500).json({ error: e.message });
  }
});

/* PUT /api/contacts/:id */
router.put('/:id', validateBody({ contactType: { type: 'scalar', max: 20 }, contactInfo: { type: 'scalar', max: 20 }, personName: { max: 300 }, office: { max: 300 }, mobile1: { max: 60 }, mobile2: { max: 60 }, officePhone: { max: 60 }, email: { max: 300 }, address: { max: 1000 }, companyName: { max: 300 }, companyPhone: { max: 60 }, companyEmail: { max: 300 }, companyAddress: { max: 1000 }, workScope: { max: 1000 }, customerCategory: { max: 200 }, customerType: { max: 200 }, district: { max: 200 } }), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  // only creator or admin/superAdmin may edit
  const { rows: [c] } = await pool.query('SELECT created_by FROM staff_contacts WHERE id=$1', [id]);
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const isAdmin = ['admin','superAdmin'].includes(req.user.role);
  if (c.created_by !== req.user.id && !isAdmin)
    return res.status(403).json({ error: 'Not allowed' });

  const {
    contactType, contactInfo,
    personName, office, mobile1, mobile2, officePhone, email, address,
    companyName, companyPhone, companyEmail, companyAddress,
    workScope, customerCategory, customerType, district,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE staff_contacts
       SET contact_type=$1, contact_info=$2, person_name=$3, office=$4,
           mobile1=$5, mobile2=$6, office_phone=$7, email=$8, address=$9,
           company_name=$10, company_phone=$11, company_email=$12,
           company_address=$13, work_scope=$14,
           customer_category=$15, customer_type=$16, district=$17, updated_at=NOW()
       WHERE id=$18
       RETURNING ${SEL}`,
      [
        contactType || 'public', contactInfo || 'personal',
        personName || null, office || null, mobile1 || null, mobile2 || null,
        officePhone || null, email || null, address || null,
        companyName || null, companyPhone || null,
        companyEmail || null, companyAddress || null,
        workScope || null,
        customerCategory || null, customerType || null, district || null,
        id,
      ]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/contacts/:id */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { rows: [c] } = await pool.query('SELECT created_by FROM staff_contacts WHERE id=$1', [id]);
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const isAdmin = ['admin','superAdmin'].includes(req.user.role);
  if (c.created_by !== req.user.id && !isAdmin)
    return res.status(403).json({ error: 'Not allowed' });

  try {
    await pool.query('DELETE FROM staff_contacts WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  Persons — sub-contacts per contact entry
// ══════════════════════════════════════════════════════════════════════════════

const PSEL = `
  id, contact_id AS "contactId",
  name, post, department, mobile1, mobile2, email, ext,
  created_at AS "createdAt"
`;

/* Access to a contact's people follows the contact itself: readable when the
   contact is public or yours (or you are admin), editable only by its creator
   or an admin — the same rule PUT /api/contacts/:id already applies. Without
   this, any logged-in user could read a colleague's PRIVATE contact's people
   or add/rename/delete people on anyone's contact by id. */
router.use('/:id/persons', async (req, res, next) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows: [c] } = await pool.query('SELECT created_by, contact_type FROM staff_contacts WHERE id=$1', [id]);
    if (!c) return res.status(404).json({ error: 'Contact not found' });
    const isAdmin = ['admin', 'superAdmin'].includes(req.user.role);
    const isOwner = c.created_by === req.user.id;
    if (req.method === 'GET') {
      if (c.contact_type === 'public' || isOwner || isAdmin) return next();
      return res.status(404).json({ error: 'Contact not found' });
    }
    if (isOwner || isAdmin) return next();
    return res.status(403).json({ error: 'Not allowed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/contacts/:id/persons */
router.get('/:id/persons', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT ${PSEL} FROM staff_contact_persons WHERE contact_id=$1 ORDER BY id ASC`,
      [id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/contacts/:id/persons */
router.post('/:id/persons', validateBody({ name: { max: 300 }, post: { max: 200 }, department: { max: 200 }, mobile1: { max: 60 }, mobile2: { max: 60 }, email: { max: 300 }, ext: { max: 40 } }), async (req, res) => {
  const contactId = parseInt(req.params.id);
  if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid id' });
  const { name, post, department, mobile1, mobile2, email, ext } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    // Same company, same name (case/whitespace-insensitive) — guard against
    // the exact duplicate that kept showing up as two identical-looking
    // tabs on the guest panel (e.g. two "Sunil Maharjan" entries).
    const { rows: dup } = await pool.query(
      `SELECT id FROM staff_contact_persons WHERE contact_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))`,
      [contactId, name]
    );
    if (dup[0]) return res.status(409).json({ error: `${name.trim()} already exists for this company` });
    const { rows } = await pool.query(
      `INSERT INTO staff_contact_persons (contact_id, name, post, department, mobile1, mobile2, email, ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PSEL}`,
      [contactId, name.trim(), post||null, department||null, mobile1||null, mobile2||null, email||null, ext||null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/contacts/:id/persons/:pid */
router.put('/:id/persons/:pid', validateBody({ name: { max: 300 }, post: { max: 200 }, department: { max: 200 }, mobile1: { max: 60 }, mobile2: { max: 60 }, email: { max: 300 }, ext: { max: 40 } }), async (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid id' });
  const { name, post, department, mobile1, mobile2, email, ext } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows: existing } = await pool.query('SELECT contact_id FROM staff_contact_persons WHERE id=$1 AND contact_id=$2', [pid, parseInt(req.params.id)]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const { rows: dup } = await pool.query(
      `SELECT id FROM staff_contact_persons WHERE contact_id=$1 AND id!=$2 AND LOWER(TRIM(name))=LOWER(TRIM($3))`,
      [existing[0].contact_id, pid, name]
    );
    if (dup[0]) return res.status(409).json({ error: `${name.trim()} already exists for this company` });
    const { rows } = await pool.query(
      `UPDATE staff_contact_persons
       SET name=$1, post=$2, department=$3, mobile1=$4, mobile2=$5,
           email=$6, ext=$7, updated_at=NOW()
       WHERE id=$8 RETURNING ${PSEL}`,
      [name.trim(), post||null, department||null, mobile1||null, mobile2||null, email||null, ext||null, pid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/contacts/:id/persons/:pid */
router.delete('/:id/persons/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('DELETE FROM staff_contact_persons WHERE id=$1 AND contact_id=$2', [pid, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
