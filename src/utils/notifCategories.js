// Notification categories shared by the bell (TopMenu) and the message inbox (StaffMessage).
// `category` comes from internal_messages.category (server: inferCategory in services/internalMessages.js).
// Person-to-person messages have no category and are bucketed as 'message'.
export const NOTIF_CATEGORIES = [
  { key: 'leave',        icon: '🗓️', label: 'Leave' },
  { key: 'office_visit', icon: '🏢', label: 'Office Visit' },
  { key: 'overtime',     icon: '⏱️', label: 'Overtime' },
  { key: 'attendance',   icon: '🕘', label: 'Attendance' },
  { key: 'task',         icon: '✅', label: 'Task' },
  { key: 'field_visit',  icon: '📍', label: 'Field Visit' },
  { key: 'duty',         icon: '🔁', label: 'Duty Roster' },
  { key: 'accounts',     icon: '📒', label: 'Accounts' },
  { key: 'quotation',    icon: '🧾', label: 'Quotation' },
  { key: 'general',      icon: '🔔', label: 'General' },
  { key: 'message',      icon: '✉️', label: 'Messages' },
];

export const categoryMeta = (key) =>
  NOTIF_CATEGORIES.find(c => c.key === key) || { key, icon: '🔔', label: key || 'General' };
