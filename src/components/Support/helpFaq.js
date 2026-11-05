// Built-in Help content for the Support widget (no AI, no server call, no cost).
// Each entry: q/a in English + Nepali, and `k` = keywords (English, Nepali and
// Roman-Nepali) matched against whatever the user types. Keep answers to
// screens that really exist; when the app changes, update here.

export const FAQ = [
  {
    id: 'leave-apply',
    q: { en: 'How do I apply for leave?', np: 'बिदा (छुट्टी) कसरी लिने?' },
    a: {
      en: '1. Open Leave > Apply.\n2. Choose the leave type and the from/to dates.\n3. Write the reason and submit.\nIt goes to your approver. You can follow the status under Leave.',
      np: '१. Leave मेनु > Apply खोल्नुहोस्।\n२. बिदाको प्रकार र मिति (देखि/सम्म) छान्नुहोस्।\n३. कारण लेखेर Submit गर्नुहोस्।\nयो तपाईंको स्वीकृतकर्ता (approver) कहाँ जान्छ। Leave पेजमा स्थिति हेर्न सकिन्छ।',
    },
    k: ['apply leave', 'take leave', 'leave request', 'request leave', 'chutti', 'chhutti', 'bida', 'leave line', 'बिदा', 'छुट्टी', 'छुटी', 'leave apply', 'लिने'],
  },
  {
    id: 'leave-balance',
    q: { en: 'Where can I see my leave balance?', np: 'मेरो बिदा बाँकी (balance) कहाँ हेर्ने?' },
    a: {
      en: 'Open Leave > Leave Calculation. It shows opening, taken and remaining days for each leave type.',
      np: 'Leave > Leave Calculation खोल्नुहोस्। यहाँ हरेक बिदा प्रकारको सुरुवाती, लिइसकेको र बाँकी दिन देखिन्छ।',
    },
    k: ['leave balance', 'remaining leave', 'balance', 'leave calculation', 'how many leave', 'बाँकी', 'balance', 'baki', 'bida baki', 'बिदा बाँकी'],
  },
  {
    id: 'leave-approve',
    q: { en: 'How do I approve or reject a leave?', np: 'बिदा कसरी स्वीकृत (approve) वा अस्वीकार गर्ने?' },
    a: {
      en: 'Open Leave > Approval. You will see requests waiting for you. Open one and choose Approve or Reject (add a remark if needed). You only see requests of staff assigned to you.',
      np: 'Leave > Approval खोल्नुहोस्। तपाईंको प्रतीक्षामा रहेका अनुरोध देखिन्छन्। एउटा खोलेर Approve वा Reject छान्नुहोस् (चाहिए remark लेख्नुहोस्)। तपाईंलाई तोकिएका कर्मचारीका अनुरोध मात्र देखिन्छन्।',
    },
    k: ['approve leave', 'reject leave', 'leave approval', 'approval', 'approver', 'स्वीकृत', 'अस्वीकार', 'swikrit', 'approve', 'reject'],
  },
  {
    id: 'missed-punch',
    q: { en: 'I forgot to punch / my attendance is wrong. What now?', np: 'पञ्च गर्न बिर्सें / मेरो हाजिरी गलत छ, के गर्ने?' },
    a: {
      en: 'Employees: open Attendance > Missing Attendance Requests and submit a request for that date; your approver will approve it.\nAdmins can also add a correction under Attendance > Manual Postings.',
      np: 'कर्मचारी: Attendance > Missing Attendance Requests मा गएर सो मितिको अनुरोध पठाउनुहोस्; approver ले स्वीकृत गर्छ।\nएडमिनले Attendance > Manual Postings मा सुधार थप्न सक्छ।',
    },
    k: ['missed punch', 'forgot punch', 'missing attendance', 'wrong attendance', 'correction', 'not punched', 'missing', 'manual posting', 'manual postings', 'बिर्सें', 'बिर्सिएँ', 'पञ्च', 'गलत', 'galat', 'punch garna birsiyo', 'birsiyo'],
  },
  {
    id: 'office-visit',
    q: { en: 'How do I record an office visit (official outside work)?', np: 'अफिस भ्रमण (Office Visit) कसरी दर्ता गर्ने?' },
    a: {
      en: 'Open Office Visit > Apply, choose the dates and purpose, and submit. Approvers use Office Visit > Approval. The report is under Leave > Reports > Office Visit.',
      np: 'Office Visit > Apply खोलेर मिति र उद्देश्य भरी Submit गर्नुहोस्। approver ले Office Visit > Approval बाट स्वीकृत गर्छ। रिपोर्ट Leave > Reports > Office Visit मा छ।',
    },
    k: ['office visit', 'official visit', 'outside work', 'field', 'visit', 'भ्रमण', 'bhraman', 'office bhraman'],
  },
  {
    id: 'daily-report',
    q: { en: 'Where is the daily attendance report?', np: 'दैनिक हाजिरी रिपोर्ट कहाँ छ?' },
    a: {
      en: 'Open Attendance > Reports > Daily. Pick the date, then use Print or Excel to output it.',
      np: 'Attendance > Reports > Daily खोल्नुहोस्। मिति छानेर Print वा Excel प्रयोग गर्नुहोस्।',
    },
    k: ['daily report', 'daily attendance', 'today attendance', 'who is present', 'present today', 'दैनिक', 'dainik', 'आजको', 'aajko'],
  },
  {
    id: 'monthly-report',
    q: { en: 'How do I get the monthly report and print or export it?', np: 'मासिक रिपोर्ट कसरी निकाल्ने र प्रिन्ट/Excel गर्ने?' },
    a: {
      en: 'Open Attendance > Reports > Monthly and choose a view: Summary, Present/Absent, Absent, IN & OUT, Late/Early, Ledger or Overtime. Select the month, then click Print or Excel. Half-monthly and Yearly reports are in the same menu.',
      np: 'Attendance > Reports > Monthly खोलेर Summary, Present/Absent, Absent, IN & OUT, Late/Early, Ledger वा Overtime मध्ये एक छान्नुहोस्। महिना छानेर Print वा Excel थिच्नुहोस्। पाक्षिक (Half-monthly) र वार्षिक (Yearly) रिपोर्ट पनि सोही मेनुमा छन्।',
    },
    k: ['monthly report', 'report', 'print', 'excel', 'export', 'download', 'summary', 'ledger', 'in out', 'in & out', 'yearly', 'half monthly', 'मासिक', 'रिपोर्ट', 'masik', 'report', 'प्रिन्ट'],
  },
  {
    id: 'late-early',
    q: { en: 'How do I see who came late or left early?', np: 'को ढिला आयो / चाँडै गयो कसरी हेर्ने?' },
    a: {
      en: 'Open Attendance > Reports > Monthly > Late/Early (also available for half-monthly and yearly). Late and early minutes are calculated against the staff member\'s shift.',
      np: 'Attendance > Reports > Monthly > Late/Early खोल्नुहोस् (पाक्षिक र वार्षिकमा पनि छ)। ढिला/चाँडो मिनेट कर्मचारीको शिफ्ट अनुसार गणना हुन्छ।',
    },
    k: ['late', 'early', 'late early', 'came late', 'left early', 'delay', 'ढिला', 'चाँडो', 'dhila', 'late aayo'],
  },
  {
    id: 'overtime',
    q: { en: 'How does overtime work?', np: 'ओभरटाइम (Overtime) कसरी काम गर्छ?' },
    a: {
      en: 'Open Attendance > Overtime to record and approve overtime. Overtime reports are under Attendance > Reports (Monthly > Overtime). If you cannot see it, the module may be off for your role; ask your administrator.',
      np: 'Attendance > Overtime मा ओभरटाइम दर्ता र स्वीकृत गरिन्छ। रिपोर्ट Attendance > Reports (Monthly > Overtime) मा छ। देखिएन भने तपाईंको भूमिकाको लागि बन्द हुन सक्छ; एडमिनलाई सोध्नुहोस्।',
    },
    k: ['overtime', 'ot', 'extra hours', 'ओभरटाइम', 'अतिरिक्त', 'overtime'],
  },
  {
    id: 'roster',
    q: { en: 'Where is the duty roster?', np: 'ड्युटी रोस्टर कहाँ छ?' },
    a: {
      en: 'Open Attendance > Duty Roster (department-wise view is also there), plus Roster Report and Roster Dashboard. This module can be switched off for an organisation; if the menu is missing, ask your administrator.',
      np: 'Attendance > Duty Roster खोल्नुहोस् (विभागगत हेराइ पनि छ), साथै Roster Report र Roster Dashboard। यो मोड्युल संस्था अनुसार बन्द हुन सक्छ; मेनु नदेखिए एडमिनलाई सोध्नुहोस्।',
    },
    k: ['roster', 'duty roster', 'duty', 'ड्युटी', 'रोस्टर', 'roster report'],
  },
  {
    id: 'shift',
    q: { en: 'How do I set up or change shifts?', np: 'शिफ्ट कसरी बनाउने/परिवर्तन गर्ने?' },
    a: {
      en: 'Open Shift from the main menu to create shifts and assign them to staff. Only administrators and managers can change shifts. Late/early calculation follows the assigned shift.',
      np: 'मुख्य मेनुको Shift खोलेर शिफ्ट बनाउने र कर्मचारीलाई तोक्ने। शिफ्ट एडमिन र म्यानेजरले मात्र परिवर्तन गर्न सक्छन्। ढिला/चाँडो हिसाब तोकिएको शिफ्टमा आधारित हुन्छ।',
    },
    k: ['shift', 'shifts', 'timing', 'duty time', 'शिफ्ट', 'shift milaune', 'office time'],
  },
  {
    id: 'add-employee',
    q: { en: 'How do I add a new employee?', np: 'नयाँ कर्मचारी कसरी थप्ने?' },
    a: {
      en: 'Admins: open Users, click Add, fill in the details (name, branch, department, designation, shift) and save. To link a fingerprint/face device, set the employee\'s Device ID equal to their PIN on the device.',
      np: 'एडमिन: Users खोलेर Add थिच्नुहोस्, विवरण (नाम, शाखा, विभाग, पद, शिफ्ट) भरी Save गर्नुहोस्। फिङ्गरप्रिन्ट/फेस मेसिन जोड्न कर्मचारीको Device ID लाई मेसिनको PIN सँग एउटै राख्नुहोस्।',
    },
    k: ['add employee', 'new employee', 'add user', 'create user', 'new staff', 'register employee', 'कर्मचारी थप', 'नयाँ कर्मचारी', 'user thapne', 'staff thapne'],
  },
  {
    id: 'bulk-import',
    q: { en: 'Can I import many employees at once?', np: 'धेरै कर्मचारी एकैपटक आयात (import) गर्न सकिन्छ?' },
    a: {
      en: 'Yes. In Users there is a Bulk Import option: download the template, fill it in Excel, and upload it. Check the preview for errors before confirming.',
      np: 'सकिन्छ। Users मा Bulk Import विकल्प छ: टेम्प्लेट डाउनलोड गरी Excel मा भरेर अपलोड गर्नुहोस्। पुष्टि गर्नुअघि त्रुटि preview मा जाँच्नुहोस्।',
    },
    k: ['bulk', 'import', 'bulk import', 'many employees', 'upload excel', 'excel import', 'आयात', 'एकैपटक'],
  },
  {
    id: 'device-punches',
    q: { en: 'Punches from the device are not showing for an employee.', np: 'मेसिनको पञ्च कर्मचारीको हाजिरीमा देखिँदैन।' },
    a: {
      en: 'Check these in order:\n1. The employee\'s Device ID (Users) must exactly equal their PIN on the device.\n2. The device must be registered and online under Settings > Attendance Device (or StandAlone Device for legacy models).\n3. Check the device date/time and network.\nStill stuck? Use "Send to support" below.',
      np: 'क्रमैसँग जाँच्नुहोस्:\n१. Users मा कर्मचारीको Device ID मेसिनको PIN सँग हुबहु मिल्नुपर्छ।\n२. Settings > Attendance Device (पुराना मोडेलका लागि StandAlone Device) मा मेसिन दर्ता र online हुनुपर्छ।\n३. मेसिनको मिति/समय र नेटवर्क जाँच्नुहोस्।\nसमाधान नभए तल "सहायतामा पठाउनुहोस्" थिच्नुहोस्।',
    },
    k: ['device', 'punch not', 'not showing', 'zkteco', 'fingerprint', 'face', 'biometric', 'machine', 'device id', 'pin', 'मेसिन', 'फिङ्गर', 'machine', 'punch aaudaina', 'देखिँदैन'],
  },
  {
    id: 'add-device',
    q: { en: 'How do I connect an attendance device?', np: 'हाजिरी मेसिन कसरी जोड्ने?' },
    a: {
      en: 'Admins: go to Settings > Attendance Device and register the device\'s serial number (it appears after the device connects to the server). For older standalone models, use Settings > StandAlone Device; if the device is on a different network from the server, use its "Remote Sync" tab.',
      np: 'एडमिन: Settings > Attendance Device मा मेसिनको सिरियल नम्बर दर्ता गर्नुहोस् (मेसिन सर्भरसँग जोडिएपछि देखिन्छ)। पुराना standalone मोडेलका लागि Settings > StandAlone Device; मेसिन सर्भरभन्दा फरक नेटवर्कमा भए "Remote Sync" ट्याब प्रयोग गर्नुहोस्।',
    },
    k: ['connect device', 'add device', 'register device', 'serial number', 'standalone', 'remote sync', 'मेसिन जोड', 'machine jodne', 'device jodne'],
  },
  {
    id: 'forgot-password',
    q: { en: 'I forgot my password.', np: 'मैले पासवर्ड बिर्सें।' },
    a: {
      en: 'Use "Forgot password" on the login page to get a reset link, or ask your administrator to reset it for you.',
      np: 'लगइन पेजको "Forgot password" प्रयोग गरेर रिसेट लिङ्क लिनुहोस्, वा एडमिनलाई रिसेट गरिदिन भन्नुहोस्।',
    },
    k: ['forgot password', 'reset password', 'cannot login', "can't login", 'login problem', 'password', 'पासवर्ड', 'बिर्सें', 'बिर्सिएँ', 'password birsiyo', 'login hudaina'],
  },
  {
    id: 'change-password',
    q: { en: 'How do I change my password or profile?', np: 'पासवर्ड वा प्रोफाइल कसरी परिवर्तन गर्ने?' },
    a: {
      en: 'Open Profile (from your name at the top). You can update your details and change your password there (minimum 8 characters).',
      np: 'माथिको आफ्नो नाम मार्फत Profile खोल्नुहोस्। यहाँ विवरण अद्यावधिक र पासवर्ड परिवर्तन गर्न सकिन्छ (कम्तीमा ८ अक्षर)।',
    },
    k: ['change password', 'profile', 'my profile', 'update profile', 'photo', 'प्रोफाइल', 'पासवर्ड परिवर्तन', 'password change', 'password badalne'],
  },
  {
    id: 'language',
    q: { en: 'How do I switch between English and Nepali?', np: 'अंग्रेजी र नेपाली भाषा कसरी बदल्ने?' },
    a: {
      en: 'Use the language switch in the top menu bar to change between English and नेपाली. Admins can adjust translations in Settings > Language.',
      np: 'माथिको मेनु बारमा भएको भाषा स्विच प्रयोग गरी English र नेपाली बदल्नुहोस्। एडमिनले Settings > Language मा अनुवाद मिलाउन सक्छ।',
    },
    k: ['language', 'nepali', 'english', 'translate', 'भाषा', 'नेपाली', 'अंग्रेजी', 'bhasha', 'nepali ma'],
  },
  {
    id: 'settings-setup',
    q: { en: 'Where do I set up branches, departments, holidays and leave types?', np: 'शाखा, विभाग, बिदा-दिन र बिदाका प्रकार कहाँ मिलाउने?' },
    a: {
      en: 'Admins: open Settings. The setup tables (branches, departments, designations, holidays, leave types and so on) are there. New organisations may start with empty lists; add entries before using other screens.',
      np: 'एडमिन: Settings खोल्नुहोस्। शाखा, विभाग, पद, सार्वजनिक बिदा, बिदाका प्रकार आदि सेटअप तालिका यहीँ छन्। नयाँ संस्थामा सूची खाली हुन सक्छ; अन्य पेज चलाउनुअघि यहाँ थप्नुहोस्।',
    },
    k: ['settings', 'setup', 'branch', 'department', 'designation', 'holiday', 'leave type', 'शाखा', 'विभाग', 'पद', 'सार्वजनिक बिदा', 'holiday thapne', 'configure'],
  },
  {
    id: 'roles',
    q: { en: 'How do I control what each role can see or do?', np: 'हरेक भूमिकाले के हेर्न/गर्न सक्ने कसरी तोक्ने?' },
    a: {
      en: 'Admins: open Settings > Roles to set view/edit access per page for each role (employee, department head, branch manager, admin).',
      np: 'एडमिन: Settings > Roles खोलेर हरेक भूमिका (कर्मचारी, विभागप्रमुख, शाखा म्यानेजर, एडमिन) का लागि पेज अनुसार हेर्ने/सम्पादन अनुमति तोक्नुहोस्।',
    },
    k: ['role', 'roles', 'permission', 'permissions', 'access', 'rights', 'भूमिका', 'अनुमति', 'permission dine', 'access dine'],
  },
  {
    id: 'menu-missing',
    q: { en: 'A menu or page is missing for me.', np: 'मलाई कुनै मेनु वा पेज देखिँदैन।' },
    a: {
      en: 'Pages are switched on per organisation and per role. If a menu is missing, it is probably off for your role or your organisation\'s plan. Ask your administrator to check Settings > Roles.',
      np: 'पेजहरू संस्था र भूमिका अनुसार खुल्ला/बन्द हुन्छन्। मेनु नदेखिए सम्भवतः तपाईंको भूमिका वा संस्थाको प्लानमा बन्द छ। एडमिनलाई Settings > Roles जाँच्न भन्नुहोस्।',
    },
    k: ['menu missing', 'page missing', 'cannot see', "can't see", 'not visible', 'no access', 'access denied', 'देखिँदैन', 'menu', 'dekhina', 'dekhdaina'],
  },
  {
    id: 'online-attendance',
    q: { en: 'How does online (phone/web) attendance work?', np: 'अनलाइन (फोन/वेब) हाजिरी कसरी हुन्छ?' },
    a: {
      en: 'If the Online Attendance module is enabled for your organisation, staff mark attendance from the web/phone and approvers review it under Attendance > Online Attendance Approval.',
      np: 'तपाईंको संस्थामा Online Attendance मोड्युल खुला छ भने कर्मचारीले वेब/फोनबाट हाजिरी जनाउँछन् र approver ले Attendance > Online Attendance Approval मा हेरी स्वीकृत गर्छ।',
    },
    k: ['online attendance', 'mobile attendance', 'phone attendance', 'web attendance', 'gps', 'अनलाइन', 'online', 'mobile bata'],
  },
  {
    id: 'tasks',
    q: { en: 'How do I use Tasks?', np: 'Task (कार्य) कसरी प्रयोग गर्ने?' },
    a: {
      en: 'Open Staff > Task to create tasks, assign them, add follow-ups and replies, and track status. Staff > Task > Dashboard gives an overview; categories and priorities are managed in the Task settings.',
      np: 'Staff > Task खोलेर कार्य बनाउने, तोक्ने, follow-up/reply थप्ने र स्थिति हेर्ने। Staff > Task > Dashboard मा सारांश छ; category र priority Task settings मा मिलाइन्छ।',
    },
    k: ['task', 'tasks', 'assign task', 'todo', 'follow up', 'कार्य', 'टास्क', 'task banaune'],
  },
  {
    id: 'messages-chat',
    q: { en: 'How do I message a colleague?', np: 'सहकर्मीलाई सन्देश कसरी पठाउने?' },
    a: {
      en: 'Use Staff > Message for messages, or the chat window at the bottom-right if Chat is enabled for your organisation.',
      np: 'सन्देशका लागि Staff > Message प्रयोग गर्नुहोस्, वा तपाईंको संस्थामा Chat खुला छ भने तल-दायाँको च्याट विन्डो।',
    },
    k: ['message', 'chat', 'send message', 'colleague', 'सन्देश', 'च्याट', 'message pathaune', 'sandesh'],
  },
  {
    id: 'backup',
    q: { en: 'How do I back up the data?', np: 'डाटा ब्याकअप कसरी लिने?' },
    a: {
      en: 'Admins: open Settings > Database Backup. You can export a backup file and later restore it from the same screen. Re-enter your password when asked.',
      np: 'एडमिन: Settings > Database Backup खोल्नुहोस्। ब्याकअप फाइल निकाल्न र सोही स्क्रिनबाट पुनर्स्थापना (restore) गर्न सकिन्छ। सोधेमा पासवर्ड फेरि हाल्नुहोस्।',
    },
    k: ['backup', 'restore', 'export database', 'database', 'ब्याकअप', 'डाटा', 'backup line', 'data backup'],
  },
  {
    id: 'payroll',
    q: { en: 'Where is payroll?', np: 'पेरोल कहाँ छ?' },
    a: {
      en: 'Open Payroll: Dashboard, Items, Tax Slab and Reports. This module may be switched off for some organisations.',
      np: 'Payroll खोल्नुहोस्: Dashboard, Items, Tax Slab र Reports। यो मोड्युल केही संस्थामा बन्द हुन सक्छ।',
    },
    k: ['payroll', 'salary', 'tax', 'tax slab', 'payslip', 'तलब', 'पेरोल', 'talab', 'kar'],
  },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s&]/gu, ' ').replace(/\s+/g, ' ').trim();
export const hasDevanagari = (s) => /[ऀ-ॿ]/.test(s || '');

/** Returns FAQ entries ranked by relevance (best first); empty if nothing matches. */
export function searchFaq(query, limit = 3) {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = new Set(q.split(' ').filter(w => w.length > 2));
  const scored = FAQ.map(e => {
    let score = 0;
    for (const kw of e.k) {
      const n = norm(kw);
      if (n.length < 2) continue;
      if (n.includes(' ')) { if (q.includes(n) || n.split(' ').every(w => w.length > 1 && q.includes(w))) score += 4; }
      else if (n.length > 3) { if (q.includes(n)) score += 3; }
      else if (words.has(n) || q.split(' ').includes(n)) score += 3;
    }
    for (const lang of ['en', 'np']) {
      for (const w of norm(e.q[lang]).split(' ')) if (w.length > 3 && words.has(w)) score += 1;
    }
    return { e, score };
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.e);
}

export const POPULAR = ['leave-apply', 'missed-punch', 'monthly-report', 'device-punches', 'forgot-password', 'language'];

/** Admin-approved answers saved from live chats (served by /support-live/kb). Shaped like FAQ entries. */
export function kbToFaq(rows) {
  return (rows || []).map(r => ({
    id: 'kb-' + r.id,
    q: { en: r.question, np: r.question },
    a: { en: r.answer_en || r.answer_np || '', np: r.answer_np || r.answer_en || '' },
    kw: (r.keywords || []).map(norm).filter(Boolean),
  })).filter(e => e.a.en);
}

/** Saved answers whose keywords are well covered by the query (>=2 hits and >=50%). Best first. */
export function searchKb(query, entries, limit = 3) {
  const words = new Set(norm(query).split(' ').filter(Boolean));
  if (!words.size) return [];
  return (entries || []).map(e => {
    const hit = e.kw.filter(k => words.has(k)).length;
    const ratio = e.kw.length ? hit / e.kw.length : 0;
    return { e, score: hit >= Math.min(2, e.kw.length) && ratio >= 0.5 ? hit + ratio : 0 };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.e);
}
