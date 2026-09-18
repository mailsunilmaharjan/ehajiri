/**
 * Staff Analysis Report — read-only HR analytics computed from real data:
 *   - Joining (onboarding) trend, yearly + monthly
 *   - Offboarding/attrition trend, yearly + monthly, with attrition rate
 *   - Gender diversity, broken down by Grade (used as an org-tier proxy —
 *     this system has no separate Executive/Middle/Operational field)
 *   - Internal mobility: branch & department transfers, last 12 months
 *   - Workload Indicator: a transparent, rule-based (NOT AI/ML) score per
 *     department from real overtime + leave-utilization data, meant to
 *     surface departments worth a closer look — not a prediction.
 *
 * Every query is scoped via resolveOrgEmployeeIds so a branchManager/
 * departmentHead granted this page only ever sees their own people, same
 * as every other report in the app.
 *
 * GET /api/staff-analytics
 */
import { Router } from 'express';
import pool from '../db.js';
import { resolveOrgEmployeeIds, resolveOrgScope } from './orgScope.js';

const router = Router();

const REAL_STAFF = `is_system IS NOT TRUE AND role NOT IN ('superAdmin')`;

router.get('/', async (req, res) => {
  try {
    const empIds = await resolveOrgEmployeeIds(req); // null = unrestricted (admin/superAdmin)
    const scope  = resolveOrgScope(req);
    const idArr  = empIds ? [empIds] : [];
    const idAnd  = (col) => empIds ? ` AND ${col} = ANY($1::int[])` : '';

    /* ── 0. Fiscal years (Settings → Fiscal Year) — the "Yearly" trend
       charts below bucket by these instead of the calendar year: an inner
       JOIN against this table both labels each bar with the company's own
       FY name (e.g. "FY 2082/083") and drops any join/exit date that falls
       outside every configured FY range — typically bad/placeholder data
       (e.g. bulk-import rows defaulted to an arbitrary date) rather than a
       real hire, so excluding it is the fix, not a display nicety. */
    const fiscalYearsQ = pool.query(
      `SELECT id, name, start_date, end_date FROM fiscal_years ORDER BY start_date`);

    /* ── 1. Onboarding (joining) trend ───────────────────────────────── */
    const onboardYearlyQ = pool.query(
      `SELECT fy.id AS fy_id, COUNT(*)::int AS count
       FROM users u
       JOIN fiscal_years fy ON u.join_date BETWEEN fy.start_date AND fy.end_date
       WHERE u.join_date IS NOT NULL AND u.${REAL_STAFF}${idAnd('u.id')}
       GROUP BY fy.id`, idArr);

    const onboardMonthlyQ = pool.query(
      `SELECT EXTRACT(YEAR FROM join_date)::int AS year,
              EXTRACT(MONTH FROM join_date)::int AS month,
              COUNT(*)::int AS count
       FROM users
       WHERE join_date IS NOT NULL AND ${REAL_STAFF}${idAnd('id')}
       GROUP BY 1,2 ORDER BY 1,2`, idArr);

    /* ── 2. Offboarding / attrition trend ────────────────────────────── */
    const offboardYearlyRawQ = pool.query(
      `SELECT fy.id AS fy_id, COUNT(*)::int AS offboarded
       FROM staff_official_changes soc
       JOIN employee_statuses es ON es.name = soc.to_value
       JOIN fiscal_years fy ON soc.effective_date BETWEEN fy.start_date AND fy.end_date
       WHERE soc.field = 'status' AND es.status_type = 'Not Working'${idAnd('soc.user_id')}
       GROUP BY fy.id`, idArr);

    const offboardMonthlyQ = pool.query(
      `SELECT EXTRACT(YEAR FROM soc.effective_date)::int AS year,
              EXTRACT(MONTH FROM soc.effective_date)::int AS month,
              COUNT(*)::int AS count
       FROM staff_official_changes soc
       JOIN employee_statuses es ON es.name = soc.to_value
       WHERE soc.field = 'status' AND es.status_type = 'Not Working'${idAnd('soc.user_id')}
       GROUP BY 1,2 ORDER BY 1,2`, idArr);

    // Per-employee join date + first "not working" transition date (if any) —
    // used in JS to reconstruct headcount-at-start-of-year for attrition rate.
    const empLifecycleQ = pool.query(
      `SELECT u.id, u.join_date,
              (SELECT MIN(soc.effective_date) FROM staff_official_changes soc
                 JOIN employee_statuses es ON es.name = soc.to_value
                WHERE soc.field = 'status' AND soc.user_id = u.id
                  AND es.status_type = 'Not Working') AS exit_date
       FROM users u
       WHERE u.join_date IS NOT NULL AND u.${REAL_STAFF}${idAnd('u.id')}`, idArr);

    /* ── 3. Gender diversity by Grade (tier proxy) ───────────────────── */
    const diversityQ = pool.query(
      `SELECT COALESCE(NULLIF(TRIM(u.grade), ''), 'Unspecified') AS grade,
              MIN(g.ranking_order) AS ranking_order,
              COUNT(*) FILTER (WHERE LOWER(u.gender) = 'male')   AS male,
              COUNT(*) FILTER (WHERE LOWER(u.gender) = 'female') AS female,
              COUNT(*) FILTER (WHERE u.gender IS NOT NULL AND TRIM(u.gender) <> ''
                                 AND LOWER(u.gender) NOT IN ('male','female')) AS other,
              COUNT(*) FILTER (WHERE u.gender IS NULL OR TRIM(u.gender) = '') AS unspecified,
              COUNT(*)::int AS total
       FROM users u
       LEFT JOIN grades g ON LOWER(TRIM(g.name)) = LOWER(TRIM(u.grade))
       WHERE u.active = TRUE AND u.${REAL_STAFF}${idAnd('u.id')}
       GROUP BY 1
       ORDER BY ranking_order NULLS LAST, grade`, idArr);

    /* ── 4. Internal mobility — branch & department transfers, 12mo ─── */
    const mobilityAggQ = pool.query(
      `SELECT soc.field, soc.from_value, soc.to_value, COUNT(*)::int AS count
       FROM staff_official_changes soc
       WHERE soc.field IN ('branch','department') AND soc.applied = TRUE
         AND soc.effective_date >= (CURRENT_DATE - INTERVAL '12 months')${idAnd('soc.user_id')}
       GROUP BY 1,2,3
       ORDER BY soc.field, count DESC`, idArr);

    const mobilityRecentQ = pool.query(
      `SELECT soc.field, soc.from_value, soc.to_value,
              to_char(soc.effective_date,'YYYY-MM-DD') AS effective_date,
              u.full_name AS "fullName", u.employee_id AS "employeeId"
       FROM staff_official_changes soc
       JOIN users u ON u.id = soc.user_id
       WHERE soc.field IN ('branch','department') AND soc.applied = TRUE
         AND soc.effective_date >= (CURRENT_DATE - INTERVAL '12 months')${idAnd('soc.user_id')}
       ORDER BY soc.effective_date DESC
       LIMIT 25`, idArr);

    /* ── 5. Workload Indicator — real OT + leave data, per department ── */
    const otByDeptQ = pool.query(
      `SELECT u.department,
              COUNT(DISTINCT u.id)::int AS employee_count,
              COALESCE(SUM(oa.ot_minutes), 0)::numeric AS total_ot_minutes
       FROM users u
       LEFT JOIN overtime_approvals oa
         ON oa.employee_id = u.id AND oa.status = 'approved'
        AND oa.date >= (CURRENT_DATE - INTERVAL '3 months')
       WHERE u.active = TRUE AND u.${REAL_STAFF}
         AND u.department IS NOT NULL AND TRIM(u.department) <> ''${idAnd('u.id')}
       GROUP BY u.department`, idArr);

    const leaveByDeptQ = pool.query(
      `SELECT u.department,
              COALESCE(SUM(l.days), 0)::numeric AS total_leave_days
       FROM users u
       LEFT JOIN leaves l
         ON l.employee_id = u.id AND l.status = 'approved'
        AND EXTRACT(YEAR FROM l.from_date) = EXTRACT(YEAR FROM CURRENT_DATE)
       WHERE u.active = TRUE AND u.${REAL_STAFF}
         AND u.department IS NOT NULL AND TRIM(u.department) <> ''${idAnd('u.id')}
       GROUP BY u.department`, idArr);

    const [
      fiscalYears,
      onboardYearly, onboardMonthly,
      offboardYearlyRaw, offboardMonthly, empLifecycle,
      diversity,
      mobilityAgg, mobilityRecent,
      otByDept, leaveByDept,
    ] = await Promise.all([
      fiscalYearsQ,
      onboardYearlyQ, onboardMonthlyQ,
      offboardYearlyRawQ, offboardMonthlyQ, empLifecycleQ,
      diversityQ,
      mobilityAggQ, mobilityRecentQ,
      otByDeptQ, leaveByDeptQ,
    ]);

    /* ── Assemble onboarding — one bar per configured Fiscal Year, in FY
       order (not calendar-year order, which won't generally match since a
       Nepali FY spans two calendar years). Any join_date outside every FY
       range was already dropped by the JOIN above. ── */
    const onboardByFy = new Map(onboardYearly.rows.map(r => [r.fy_id, r.count]));
    const offboardByFy = new Map(offboardYearlyRaw.rows.map(r => [r.fy_id, r.offboarded]));

    const onboarding = {
      yearly: fiscalYears.rows.map(fy => ({ year: fy.name, count: onboardByFy.get(fy.id) || 0 })),
      monthlyByYear: groupByYear(onboardMonthly.rows),
      seasonality: seasonality(onboardMonthly.rows),
    };

    /* ── Assemble offboarding + attrition rate, per Fiscal Year ── */
    const headcountAt = (date) => empLifecycle.rows.filter(e => {
      const joined = e.join_date && new Date(e.join_date) < date;
      const stillIn = !e.exit_date || new Date(e.exit_date) >= date;
      return joined && stillIn;
    }).length;

    const offboardYearly = fiscalYears.rows.map(fy => {
      const offboarded = offboardByFy.get(fy.id) || 0;
      const headcountStart = headcountAt(new Date(fy.start_date));
      const attritionRate = headcountStart > 0
        ? Math.round((offboarded / headcountStart) * 1000) / 10
        : null;
      return { year: fy.name, offboarded, headcountStart, attritionRate };
    });

    const offboarding = {
      yearly: offboardYearly,
      monthlyByYear: groupByYear(offboardMonthly.rows),
      seasonality: seasonality(offboardMonthly.rows),
    };

    /* ── Diversity with percentages + overall total ── */
    const diversityRows = diversity.rows.map(r => {
      const total = Number(r.total) || 0;
      const pct = (n) => total > 0 ? Math.round((Number(n) / total) * 1000) / 10 : 0;
      return {
        grade: r.grade,
        male: Number(r.male), female: Number(r.female),
        other: Number(r.other), unspecified: Number(r.unspecified),
        total,
        malePct: pct(r.male), femalePct: pct(r.female),
        otherPct: pct(r.other), unspecifiedPct: pct(r.unspecified),
      };
    });
    const overall = diversityRows.reduce((acc, r) => ({
      male: acc.male + r.male, female: acc.female + r.female,
      other: acc.other + r.other, unspecified: acc.unspecified + r.unspecified,
      total: acc.total + r.total,
    }), { male: 0, female: 0, other: 0, unspecified: 0, total: 0 });
    const overallPct = (n) => overall.total > 0 ? Math.round((n / overall.total) * 1000) / 10 : 0;

    const diversityOut = {
      byGrade: diversityRows,
      overall: {
        ...overall,
        malePct: overallPct(overall.male), femalePct: overallPct(overall.female),
        otherPct: overallPct(overall.other), unspecifiedPct: overallPct(overall.unspecified),
      },
    };

    /* ── Mobility ── */
    const branchPairs = mobilityAgg.rows.filter(r => r.field === 'branch')
      .map(r => ({ from: r.from_value, to: r.to_value, count: r.count }));
    const deptPairs = mobilityAgg.rows.filter(r => r.field === 'department')
      .map(r => ({ from: r.from_value, to: r.to_value, count: r.count }));
    const mobility = {
      branchTransfers: { total: branchPairs.reduce((s, r) => s + r.count, 0), pairs: branchPairs },
      departmentTransfers: { total: deptPairs.reduce((s, r) => s + r.count, 0), pairs: deptPairs },
      recent: mobilityRecent.rows,
    };

    /* ── Workload Indicator (rule-based, transparent — not AI) ──
       otComponent: how far above a 20hr/3mo reference point the department's
       average overtime sits (capped at 1.0).
       leaveComponent: how far below the COMPANY's average leave-days-taken
       the department sits (capped at 1.0) — under-using leave alongside high
       OT is the actual signal, not either number alone. */
    const OT_REFERENCE_HOURS = 20;
    const deptMap = {};
    otByDept.rows.forEach(r => {
      deptMap[r.department] = {
        department: r.department,
        employeeCount: r.employee_count,
        avgOtHoursPerEmp: r.employee_count > 0 ? Number(r.total_ot_minutes) / 60 / r.employee_count : 0,
        avgLeaveDaysPerEmp: 0,
      };
    });
    leaveByDept.rows.forEach(r => {
      const entry = deptMap[r.department];
      if (entry) entry.avgLeaveDaysPerEmp = entry.employeeCount > 0
        ? Number(r.total_leave_days) / entry.employeeCount : 0;
    });
    const deptList = Object.values(deptMap);
    const totalEmp = deptList.reduce((s, d) => s + d.employeeCount, 0);
    const companyAvgLeaveDaysPerEmp = totalEmp > 0
      ? deptList.reduce((s, d) => s + d.avgLeaveDaysPerEmp * d.employeeCount, 0) / totalEmp
      : 0;

    const workload = {
      companyAvgLeaveDaysPerEmp: Math.round(companyAvgLeaveDaysPerEmp * 10) / 10,
      referenceOtHours: OT_REFERENCE_HOURS,
      departments: deptList.map(d => {
        const otComponent = Math.min(1, d.avgOtHoursPerEmp / OT_REFERENCE_HOURS);
        const leaveComponent = companyAvgLeaveDaysPerEmp > 0
          ? Math.max(0, Math.min(1, 1 - (d.avgLeaveDaysPerEmp / companyAvgLeaveDaysPerEmp)))
          : 0;
        const score = Math.round((otComponent * 0.6 + leaveComponent * 0.4) * 100);
        const band = score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low';
        return {
          department: d.department,
          employeeCount: d.employeeCount,
          avgOtHoursPerEmp: Math.round(d.avgOtHoursPerEmp * 10) / 10,
          avgLeaveDaysPerEmp: Math.round(d.avgLeaveDaysPerEmp * 10) / 10,
          score, band,
        };
      }).sort((a, b) => b.score - a.score),
    };

    res.json({
      scope: scope.level,
      generatedAt: new Date().toISOString(),
      onboarding, offboarding, diversity: diversityOut, mobility, workload,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* [{year,month,count}] → [{year, months:[{month,count} x present months]}] */
function groupByYear(rows) {
  const byYear = {};
  rows.forEach(r => { (byYear[r.year] ||= []).push({ month: r.month, count: r.count }); });
  return Object.entries(byYear)
    .map(([year, months]) => ({ year: Number(year), months: months.sort((a, b) => a.month - b.month) }))
    .sort((a, b) => a.year - b.year);
}

/* [{year,month,count}] → [{month, count, pct}] aggregated across all years —
   "which calendar months tend to see more activity" regardless of year. */
function seasonality(rows) {
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
  rows.forEach(r => { byMonth[r.month - 1].count += r.count; });
  const total = byMonth.reduce((s, m) => s + m.count, 0);
  return byMonth.map(m => ({ ...m, pct: total > 0 ? Math.round((m.count / total) * 1000) / 10 : 0 }));
}

export default router;
