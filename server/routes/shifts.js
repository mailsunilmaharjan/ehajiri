import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const toRow = r => ({
  id                   : r.id,
  name                 : r.name,
  nameEn               : r.name_en,
  code                 : r.code,
  startTime            : r.start_time,
  endTime              : r.end_time,
  workHours            : parseFloat(r.work_hours),
  gracePeriodStart     : r.grace_period_start,
  gracePeriodEnd       : r.grace_period_end,
  makeDefault          : r.make_default,
  isOff                : r.is_off,
  active               : r.active,
  color                : r.color,
  exceptionalDayEnabled: r.exceptional_day_enabled,
  exceptionalDays      : r.exceptional_days || [],
  exceptionalStartTime : r.exceptional_start_time,
  exceptionalEndTime   : r.exceptional_end_time,
  exceptionalWorkHours : parseFloat(r.exceptional_work_hours),
  winterPolicyEnabled  : r.winter_policy_enabled,
  winterPolicy         : r.winter_policy,
});

router.get('/', async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM shifts ORDER BY id')).rows.map(toRow)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const s = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Enforce single default: clear others before inserting a new default
    if (s.makeDefault) {
      await client.query('UPDATE shifts SET make_default = FALSE');
    }
    const { rows } = await client.query(
      `INSERT INTO shifts
       (name,name_en,code,start_time,end_time,work_hours,grace_period_start,grace_period_end,
        make_default,active,color,exceptional_day_enabled,exceptional_days,exceptional_start_time,
        exceptional_end_time,exceptional_work_hours,winter_policy_enabled,winter_policy)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [s.name,s.nameEn,s.code,s.startTime,s.endTime,s.workHours,
       s.gracePeriodStart||5,s.gracePeriodEnd||5,s.makeDefault||false,s.active??true,s.color,
       s.exceptionalDayEnabled||false,JSON.stringify(s.exceptionalDays||[]),
       s.exceptionalStartTime||null,s.exceptionalEndTime||null,s.exceptionalWorkHours||0,
       s.winterPolicyEnabled||false,s.winterPolicy?JSON.stringify(s.winterPolicy):null]
    );
    // Applying "Make Default" assigns this shift to every staff member
    if (s.makeDefault) {
      await client.query(
        `UPDATE users SET shift=$1 WHERE is_system IS NOT TRUE AND role NOT IN ('superAdmin')`,
        [rows[0].code]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(toRow(rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const s = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Enforce single default: clear all other shifts before marking this one as default
    if (s.makeDefault) {
      await client.query('UPDATE shifts SET make_default = FALSE WHERE id != $1', [req.params.id]);
    }
    const { rows } = await client.query(
      `UPDATE shifts SET name=$1,name_en=$2,code=$3,start_time=$4,end_time=$5,work_hours=$6,
       grace_period_start=$7,grace_period_end=$8,make_default=$9,active=$10,color=$11,
       exceptional_day_enabled=$12,exceptional_days=$13,exceptional_start_time=$14,
       exceptional_end_time=$15,exceptional_work_hours=$16,winter_policy_enabled=$17,winter_policy=$18
       WHERE id=$19 RETURNING *`,
      [s.name,s.nameEn,s.code,s.startTime,s.endTime,s.workHours,
       s.gracePeriodStart||5,s.gracePeriodEnd||5,s.makeDefault||false,s.active??true,s.color,
       s.exceptionalDayEnabled||false,JSON.stringify(s.exceptionalDays||[]),
       s.exceptionalStartTime||null,s.exceptionalEndTime||null,s.exceptionalWorkHours||0,
       s.winterPolicyEnabled||false,s.winterPolicy?JSON.stringify(s.winterPolicy):null,req.params.id]
    );
    // Applying "Make Default" assigns this shift to every staff member
    if (s.makeDefault) {
      await client.query(
        `UPDATE users SET shift=$1 WHERE is_system IS NOT TRUE AND role NOT IN ('superAdmin')`,
        [rows[0].code]
      );
    }
    await client.query('COMMIT');
    res.json(toRow(rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    /* Check if shift is assigned to any staff (users.shift stores the shift code) */
    const staffCheck = await pool.query(
      `SELECT COUNT(*) FROM users
       WHERE shift = (SELECT code FROM shifts WHERE id=$1)
         AND is_system IS NOT TRUE AND shift IS NOT NULL`,
      [id]
    );
    if (parseInt(staffCheck.rows[0].count) > 0) {
      return res.status(409).json({ error: 'This shift is being used by staff, Cannot Delete' });
    }

    /* Check if shift is used in any duty roster entry */
    const rosterCheck = await pool.query(
      'SELECT COUNT(*) FROM duty_roster WHERE shift_id=$1', [id]
    );
    if (parseInt(rosterCheck.rows[0].count) > 0) {
      return res.status(409).json({ error: 'This shift is assigned in Duty Roster, Cannot Delete' });
    }

    await pool.query('DELETE FROM shifts WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
