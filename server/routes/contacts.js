import { Router } from 'express';
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
router.post('/', async (req, res) => {
  const {
    contactType, contactInfo,
    personName, office, mobile1, mobile2, officePhone, email, address,
    companyName, companyPhone, companyEmail, companyAddress,
    workScope, customerCategory, customerType,
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
          customer_category, customer_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${SEL}`,
      [
        contactType || 'public', contactInfo || 'personal',
        personName || null, office || null, mobile1 || null, mobile2 || null,
        officePhone || null, email || null, address || null,
        companyName || null, companyPhone || null,
        companyEmail || null, companyAddress || null,
        workScope || null,
        customerCategory || null, customerType || null,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/contacts/:id */
router.put('/:id', async (req, res) => {
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
    workScope, customerCategory, customerType,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE staff_contacts
       SET contact_type=$1, contact_info=$2, person_name=$3, office=$4,
           mobile1=$5, mobile2=$6, office_phone=$7, email=$8, address=$9,
           company_name=$10, company_phone=$11, company_email=$12,
           company_address=$13, work_scope=$14,
           customer_category=$15, customer_type=$16, updated_at=NOW()
       WHERE id=$17
       RETURNING ${SEL}`,
      [
        contactType || 'public', contactInfo || 'personal',
        personName || null, office || null, mobile1 || null, mobile2 || null,
        officePhone || null, email || null, address || null,
        companyName || null, companyPhone || null,
        companyEmail || null, companyAddress || null,
        workScope || null,
        customerCategory || null, customerType || null,
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
router.post('/:id/persons', async (req, res) => {
  const contactId = parseInt(req.params.id);
  if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid id' });
  const { name, post, department, mobile1, mobile2, email, ext } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_contact_persons (contact_id, name, post, department, mobile1, mobile2, email, ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PSEL}`,
      [contactId, name.trim(), post||null, department||null, mobile1||null, mobile2||null, email||null, ext||null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/contacts/:id/persons/:pid */
router.put('/:id/persons/:pid', async (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid id' });
  const { name, post, department, mobile1, mobile2, email, ext } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
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
    await pool.query('DELETE FROM staff_contact_persons WHERE id=$1', [pid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
