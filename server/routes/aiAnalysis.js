import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';

const router = Router();

router.get('/analysis', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY is not configured. Add it to server/.env to enable AI Analysis.',
    });
  }

  const anthropic = new Anthropic({ apiKey });
  const today = new Date().toISOString().split('T')[0];

  try {
    // Total active employees
    const { rows: empRows } = await pool.query(
      `SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE gender = 'male')   AS male,
         COUNT(*) FILTER (WHERE gender = 'female') AS female
       FROM users
       WHERE active = TRUE AND is_system IS NOT TRUE AND role != 'superAdmin'`
    );
    const emp = empRows[0] || {};

    // Today: who punched in
    const { rows: todayPunch } = await pool.query(
      `SELECT COUNT(DISTINCT employee_id) AS present
       FROM zkteco_attendance_logs
       WHERE check_time::date = $1::date AND employee_id IS NOT NULL`,
      [today]
    );
    const presentToday = Number(todayPunch[0]?.present || 0);

    // Today: approved leaves that cover today
    const { rows: leaveToday } = await pool.query(
      `SELECT COUNT(*) AS on_leave
       FROM leaves
       WHERE status = 'approved' AND $1::date BETWEEN from_date AND to_date`,
      [today]
    );
    const onLeaveToday = Number(leaveToday[0]?.on_leave || 0);

    const totalEmp = Number(emp.total || 1);
    const absentToday = Math.max(0, totalEmp - presentToday - onLeaveToday);
    const presentRate = Math.round((presentToday / totalEmp) * 100);

    // Last 7 days attendance rates
    const { rows: weekly } = await pool.query(
      `SELECT d::date AS date,
         COUNT(DISTINCT al.employee_id) AS present
       FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::interval) AS d
       LEFT JOIN zkteco_attendance_logs al
         ON al.check_time::date = d::date AND al.employee_id IS NOT NULL
       GROUP BY d ORDER BY d`
    );

    // Leave status summary
    const { rows: leaveStatus } = await pool.query(
      `SELECT status, COUNT(*) AS cnt FROM leaves GROUP BY status`
    );
    const leaves = {};
    leaveStatus.forEach(r => { leaves[r.status] = Number(r.cnt); });

    // This month late arrivals (employees with no punch before 10:00 Nepal time but present)
    // Simple approach: employees who punched in after 10:00 UTC+5:45 (i.e., after 04:15 UTC)
    const { rows: lateRows } = await pool.query(
      `SELECT u.full_name, COUNT(*) AS late_count
       FROM zkteco_attendance_logs al
       JOIN users u ON u.id = al.employee_id
       WHERE al.check_time::date >= DATE_TRUNC('month', CURRENT_DATE)::date
         AND al.employee_id IS NOT NULL
         AND al.check_time::time > '04:30:00'
       GROUP BY u.full_name
       ORDER BY late_count DESC
       LIMIT 5`
    );

    const weeklyData = weekly.map(r => ({
      date: String(r.date).split('T')[0],
      present: Number(r.present),
      rate: Math.round((Number(r.present) / totalEmp) * 100),
    }));

    const prompt = `You are an HR analytics AI for eHajiri TMS (an attendance management system). Analyze this attendance data and provide 5-6 concise, actionable insights for the HR manager.

TODAY (${today}):
- Total workforce: ${totalEmp} employees (${emp.male || 0} male, ${emp.female || 0} female)
- Present: ${presentToday} (${presentRate}%)
- On approved leave: ${onLeaveToday}
- Absent (unaccounted): ${absentToday}

LAST 7 DAYS ATTENDANCE:
${weeklyData.map(d => `- ${d.date}: ${d.present} present (${d.rate}%)`).join('\n') || '- No data'}

LEAVE REQUESTS:
- Pending approval: ${leaves.pending || 0}
- Approved: ${leaves.approved || 0}
- Rejected: ${leaves.rejected || 0}

TOP LATE ARRIVALS THIS MONTH:
${lateRows.length > 0 ? lateRows.map(r => `- ${r.full_name}: ${r.late_count} times`).join('\n') : '- No late arrival data'}

Provide exactly 5-6 numbered insights. Each insight should be 1-2 sentences. Be direct and practical — mention specific numbers where relevant. Focus on: attendance health, trends, leave management, and any actions needed.`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 700,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const analysis = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || 'Unable to generate analysis.';

    res.json({
      analysis,
      stats: {
        today: { present: presentToday, absent: absentToday, onLeave: onLeaveToday, total: totalEmp, rate: presentRate },
        weeklyRates: weeklyData,
        leaveStatus: leaves,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
