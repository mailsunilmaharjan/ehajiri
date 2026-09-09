import React from 'react';
import { formatNepalDateTime } from '../../utils/dateUtils.js';
import { summarizeDeviceInfo } from '../../utils/deviceInfo.js';

/**
 * Small audit line — "who last saved this record, when, from what device" —
 * for the footer of Edit Manual Entry, Manual Leave/Office Visit Posting, and
 * Edit Staff. Renders nothing until the record has actually been saved at
 * least once (updatedAt is null for a brand-new, not-yet-saved record).
 * `fd` is the caller's own date formatter (makeDateFormatter(settings)), so
 * the date part respects the company's AD/BS calendar setting like everywhere else.
 */
const LastSavedBy = ({ updatedByName, updatedAt, updatedDevice, fd }) => {
  if (!updatedAt) return null;
  return (
    <div style={{ fontSize:11.5, color:'#9ca3af', lineHeight:1.4 }}>
      Last saved by <strong style={{ color:'#6b7280', fontWeight:600 }}>{updatedByName || '—'}</strong>
      {' · '}{formatNepalDateTime(updatedAt, fd)}
      {updatedDevice && <>{' · '}<span title={updatedDevice}>{summarizeDeviceInfo(updatedDevice)}</span></>}
    </div>
  );
};

export default LastSavedBy;
