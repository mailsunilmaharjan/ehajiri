import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext.jsx';

/* Shared pieces for the phone screens: icons, bottom sheet, labels in English / नेपाली. */

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Icon = ({ name, size = 24 }) => {
  const d = {
    home:   <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></>,
    cal:    <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
    leave:  <><path d="M5 20c0-8 5-14 15-15-1 10-7 15-15 15Z" /><path d="M5 20 13 12" /></>,
    inbox:  <><path d="M4 13.5 6.5 5h11L20 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z" /><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20" /></>,
    more:   <><circle cx="5.5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18.5" cy="12" r="1.4" /></>,
    bell:   <><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    back:   <><path d="m14.5 5-7 7 7 7" /></>,
    check:  <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
    finger: <><path d="M12 4a7 7 0 0 0-7 7v1.5" /><path d="M19 12.5V11a7 7 0 0 0-3.2-5.9" /><path d="M8.5 20.5c.6-1.6 1-3.4 1-5.3V11a2.5 2.5 0 0 1 5 0v4.2c0 2 .5 3.8 1.5 5.3" /><path d="M5 15.5c0 2-.3 3.4-.9 4.5M19 15.5c0 1.6.2 3 .6 4.2M12 11v4.5c0 1.9.4 3.5 1 4.8" /></>,
    task:   <><rect x="4.5" y="4" width="15" height="17" rx="2.5" /><path d="m8.5 12 2.2 2.2L15.5 9.5M9 3v2M15 3v2" /></>,
    pin:    <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" /></>,
    clock:  <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    money:  <><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /></>,
    globe:  <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.4 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.4-3.6-8.5s1-6.1 3.6-8.5Z" /></>,
    help:   <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.7M12 16.8v.1" /></>,
    out:    <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10" /></>,
    user:   <><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20c.8-3.6 3.7-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
    chev:   <><path d="m9.5 5 7 7-7 7" /></>,
    plus:   <><path d="M12 5v14M5 12h14" /></>,
    x:      <><path d="M6 6l12 12M18 6 6 18" /></>,
    msg:    <><path d="M4 5h16v11H9l-5 4V5Z" /></>,
  }[name];
  if (name === 'leave') return <span className="m-leave-emo" style={{ fontSize: Math.round(size * 0.95) }} aria-hidden="true">🏖️</span>;
  return <svg viewBox="0 0 24 24" width={size} height={size} {...P}>{d}</svg>;
};

/** Bottom sheet. Tap the dim area or ✕ to close. */
export function Sheet({ title, onClose, children, footer }) {
  // When the on-screen keyboard opens, the visible area shrinks: keep the sheet (and its Next / Save buttons) inside it.
  const [vv, setVv] = useState(null);
  useEffect(() => {
    const v = window.visualViewport; if (!v) return undefined;
    const upd = () => setVv(v.height < window.innerHeight - 80 ? { top: Math.round(v.offsetTop), height: Math.round(v.height) } : null);
    upd(); v.addEventListener('resize', upd); v.addEventListener('scroll', upd);
    return () => { v.removeEventListener('resize', upd); v.removeEventListener('scroll', upd); };
  }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="m-sheet-back" onClick={onClose} style={vv ? { top: vv.top, bottom: 'auto', height: vv.height } : undefined}>
      <div className="m-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title} style={vv ? { maxHeight: vv.height - 6 } : undefined}>
        <div className="m-sheet-grab" />
        <div className="m-sheet-head m-row"><span className="m-grow">{title}</span>
          <button className="m-icon-btn" style={{ background: '#f3f4f6', color: '#374151' }} onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button></div>
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Empty = ({ icon = '📭', text }) => <div className="m-empty"><div className="m-empty-ico">{icon}</div>{text}</div>;
export const Spinner = ({ dark }) => <span className={`m-spin${dark ? ' dark' : ''}`} />;

export const STATUS_CHIP = { pending: ['warn', 'Pending'], recommended: ['info', 'Recommended'], approved: ['ok', 'Approved'], rejected: ['bad', 'Rejected'], cancelled: ['gray', 'Cancelled'] };
export const StatusChip = ({ status }) => { const [c, l] = STATUS_CHIP[status] || ['gray', status]; return <span className={`m-chip ${c}`}>{l}</span>; };

const NP = {
  'Open site form': 'साइट फारम खोल्नुहोस्', 'Site form': 'साइट फारम', 'Check out to Office': 'कार्यालयमा चेक आउट', 'Another field visit?': 'अर्को फिल्ड भिजिट?', 'Yes, another field visit': 'हो, अर्को फिल्ड भिजिट', 'No, check out to Office': 'होइन, कार्यालय फर्कने', 'No other field visit is due today': 'आज अर्को फिल्ड भिजिट छैन',
  'Notices': 'सूचनाहरू', 'Reports': 'रिपोर्टहरू', 'Monthly Ledger': 'मासिक खाता', 'Summary': 'सारांश', 'Present / Absent': 'उपस्थित / अनुपस्थित', 'IN & OUT': 'आगमन र प्रस्थान', 'Late In / Early Out': 'ढिलो आगमन / चाँडो प्रस्थान', 'Absent Days': 'अनुपस्थित दिन', 'Overtime': 'ओभरटाइम', 'Reports menu': 'रिपोर्ट मेनु', 'Working days': 'कार्य दिन', 'Office Visit': 'कार्यालय भ्रमण', 'Worked': 'काम गरेको', 'Weekend': 'साप्ताहिक बिदा', 'Holiday': 'सार्वजनिक बिदा', 'Late in': 'ढिलो आगमन', 'Early out': 'चाँडो प्रस्थान', 'Day by day record': 'दिनको विवरण', 'Totals and attendance rate': 'जम्मा र उपस्थिति दर', 'Calendar colours': 'क्यालेन्डर रङ', 'Check in and out times': 'आगमन र प्रस्थान समय', 'Days you were late or left early': 'ढिलो आएका वा चाँडै गएका दिन', 'Days marked absent': 'अनुपस्थित भएका दिन', 'Approved and worked extra hours': 'थप घण्टाको काम', 'No records this month': 'यो महिना कुनै विवरण छैन', 
  'Check in Time': 'चेक इन समय', 'Check out Time': 'चेक आउट समय', 'Task Category': 'कामको प्रकार', 'Location verified': 'स्थान प्रमाणित भयो', 'Recorded — cannot be changed': 'दर्ता भयो — परिवर्तन गर्न मिल्दैन', 'Current time — cannot be edited': 'हालको समय — सम्पादन गर्न मिल्दैन', 'Current time — recorded when you check out': 'हालको समय — चेक आउट गर्दा दर्ता हुन्छ', 'Available after check in': 'चेक इन पछि उपलब्ध', 'Field visit update': 'फिल्ड भिजिट अपडेट',
  'View Reports': 'रिपोर्ट हेर्नुहोस्', 'Show more': 'थप हेर्नुहोस्', 'Call': 'फोन', 'Contact Persons': 'सम्पर्क व्यक्ति', 'Login details are hidden on the phone — open this note on the website to view them.': 'लगइन विवरण फोनमा लुकाइएको छ — वेबसाइटमा यो नोट खोलेर हेर्नुहोस्।', 'Staff': 'कर्मचारी', 'Contacts': 'सम्पर्क', 'Notes': 'नोट', 'Employee ID': 'कर्मचारी आईडी', 'Public': 'सार्वजनिक', 'Private': 'निजी', 'Type': 'प्रकार', 'Office Phone': 'कार्यालय फोन', 'District': 'जिल्ला', 'Mobile': 'मोबाइल',
  'Add Staff': 'कर्मचारी थप्नुहोस्', 'Device Enrollment': 'डिभाइस इनरोलमेन्ट', 'Device Management': 'डिभाइस व्यवस्थापन', 'Attendance devices, status and actions': 'हाजिरी डिभाइस, अवस्था र कार्यहरू', 'Send person to device': 'डिभाइसमा पठाउनुहोस्', 'Enrol fingerprint': 'औंठाछाप इनरोल', 'Enrol face': 'अनुहार इनरोल', 'Enrol card': 'कार्ड इनरोल', 'Online': 'अनलाइन', 'Offline': 'अफलाइन', 'Devices': 'डिभाइस', 'Reboot': 'रिबुट', 'Set time': 'समय मिलाउने', 'Sync attendance': 'हाजिरी सिंक', 'Refresh info': 'जानकारी ताजा', 'Get users': 'प्रयोगकर्ता लिने', 'Actions': 'कार्यहरू', 'Full Name': 'पूरा नाम', 'Join Date': 'सामेल मिति', 'Device ID / PIN': 'डिभाइस आईडी / पिन', 'User Role': 'प्रयोगकर्ता भूमिका', 'Gender': 'लिङ्ग', 'Male': 'पुरुष', 'Female': 'महिला', 'Other': 'अन्य', 'Post': 'पद', 'Mode': 'मोड', 'Grade': 'तह', 'Save': 'सुरक्षित गर्नुहोस्',
  'Select staff': 'कर्मचारी छान्नुहोस्', 'Clear filters': 'फिल्टर हटाउनुहोस्', 'Me': 'म', 'All staff': 'सबै कर्मचारी', 'Everyone I can see': 'मैले देख्न सक्ने सबै', 'With the filters above': 'माथिका फिल्टरसहित', 'Change': 'परिवर्तन', 'All': 'सबै', 'Pending': 'पेन्डिङ', 'Approved': 'स्वीकृत', 'Rejected': 'अस्वीकृत', 'No punch': 'पन्च छैन', 'Today': 'आज', 'Branch': 'शाखा', 'Department': 'विभाग',
  'Personal': 'व्यक्तिगत', 'Job': 'कामको विवरण', 'Contact': 'सम्पर्क', 'Access & device': 'पहुँच र डिभाइस', 'Save staff': 'कर्मचारी सुरक्षित गर्नुहोस्', 'New staff member': 'नयाँ कर्मचारी', 'Fill in the details below': 'तलका विवरण भर्नुहोस्', 'Online attendance': 'अनलाइन हाजिरी', 'Lets this person check in from the phone': 'फोनबाट चेक इन गर्न दिन्छ',
  'Basic': 'आधारभूत', 'Access': 'पहुँच', 'Next': 'अर्को', 'Back': 'पछाडि', 'Name': 'नाम', 'Login': 'लगइन',
  'Sign in to continue': 'जारी राख्न साइन इन गर्नुहोस्', 'or': 'वा', 'Enter username or email': 'युजरनेम वा इमेल लेख्नुहोस्', 'Enter password': 'पासवर्ड लेख्नुहोस्',
  'Fingerprint / Face': 'फिंगरप्रिन्ट / अनुहार',
  'Seen by': 'हेर्नुभयो', 'React': 'प्रतिक्रिया', 'Nobody yet': 'अहिलेसम्म कसैले छैन', 'Journey': 'यात्रा', 'You are at the office': 'तपाईं कार्यालयमा हुनुहुन्छ', 'Check out from Office': 'कार्यालयबाट चेक आउट', 'Heading here': 'यहाँ जाँदै', 'Left office at': 'कार्यालय छोडेको', 'ago': 'अघि', 'Make Check out': 'चेक आउट गर्नुहोस्', 'Time here': 'यहाँ बसेको समय', 'Visit finished': 'भ्रमण सकियो', 'Next field visit': 'अर्को फिल्ड भिजिट', 'Move to Office': 'कार्यालय फर्कनुहोस्', 'Move to Office instead': 'बरु कार्यालय फर्कनुहोस्', 'Head here next': 'अर्को यही जाऊँ', 'You just finished a visit': 'तपाईंले भ्रमण सक्नुभयो', 'You are on another field visit': 'तपाईं अर्को फिल्ड भिजिटमा हुनुहुन्छ', 'Open that visit': 'त्यो भ्रमण खोल्नुहोस्', 'Back at office': 'कार्यालयमा फर्कियो', 'Travel back': 'फर्कने यात्रा', 'Total trip': 'कुल यात्रा', 'Travel': 'यात्रा', 'est.': 'अनुमान', 'Office Out': 'कार्यालयबाट बाहिर', 'Check out': 'चेक आउट', 'Client Office Name': 'ग्राहक कार्यालयको नाम', 'Location Name': 'स्थानको नाम', 'Status': 'स्थिति', 'Work Done': 'काम सकियो', 'Pending for Next Day': 'भोलिका लागि बाँकी', 'Getting your location…': 'तपाईंको स्थान खोज्दै…', 'Location ready': 'स्थान तयार', 'Retry': 'फेरि प्रयास', 'Your office location and the time are recorded now.': 'तपाईंको कार्यालयको स्थान र समय अहिले रेकर्ड हुन्छ।',
  'Duty Roster': 'ड्युटी रोस्टर', 'No duty roster assigned': 'कुनै ड्युटी रोस्टर तोकिएको छैन', 'Current': 'हालको', 'Off days': 'बिदा दिन',
  'Approvals': 'स्वीकृतिहरू', 'Recommend, approve or reject requests': 'सिफारिस, स्वीकृत वा अस्वीकृत गर्नुहोस्', 'For recommendation': 'सिफारिसका लागि', 'For approval': 'स्वीकृतिका लागि',
  'Overtime': 'ओभरटाइम', 'Remarks': 'टिप्पणी', 'optional': 'ऐच्छिक', 'Recommended': 'सिफारिस गरियो', 'Approved': 'स्वीकृत भयो', 'Rejected': 'अस्वीकृत भयो', 'Reject': 'अस्वीकृत',
  'Please write the reason for rejecting': 'अस्वीकृत गर्ने कारण लेख्नुहोस्', 'Why is it being rejected?': 'किन अस्वीकृत गर्दै हुनुहुन्छ?', 'Add a remark for the applicant': 'आवेदकका लागि टिप्पणी थप्नुहोस्',
  'All caught up — nothing waiting for you': 'सबै सकियो — तपाईंलाई कुनै बाँकी छैन', 'Nothing waiting here': 'यहाँ केही बाँकी छैन', 'Confirm': 'पुष्टि', 'Action failed': 'काम सफल भएन',
  'Task': 'कार्य', 'Field Visit': 'फिल्ड भ्रमण', 'Open': 'खुला', 'Done': 'सकियो', 'All': 'सबै', 'Overdue': 'म्याद नाघेको', 'Pending': 'विचाराधीन', 'In Progress': 'चलिरहेको', 'Completed': 'सम्पन्न', 'Cancelled': 'रद्द',
  'New Task': 'नयाँ कार्य', 'New Field Visit': 'नयाँ फिल्ड भ्रमण', 'Edit Task': 'कार्य सच्याउनुहोस्', 'Task Title': 'कार्यको शीर्षक', 'Customer': 'ग्राहक', 'Contact Person': 'सम्पर्क व्यक्ति',
  'Category': 'वर्ग', 'Priority': 'प्राथमिकता', 'Due Date': 'म्याद', 'Assign To': 'जिम्मा दिनुहोस्', 'Status': 'स्थिति', 'Description': 'विवरण', 'Add': 'थप्नुहोस्', 'Select': 'छान्नुहोस्', 'None': 'कुनै पनि छैन',
  'Remarks': 'टिप्पणी', 'Add remark': 'टिप्पणी थप्नुहोस्', 'Edit remark': 'टिप्पणी सच्याउनुहोस्', 'No remarks yet': 'अझै टिप्पणी छैन', 'How did you follow up?': 'कसरी फलोअप गर्नुभयो?', 'Remark': 'टिप्पणी', 'Write the remark': 'टिप्पणी लेख्नुहोस्',
  'Hand over to': 'हस्तान्तरण', 'Nobody': 'कोही होइन', 'Handed over to': 'हस्तान्तरण गरियो', 'Start': 'सुरु', 'Complete': 'सम्पन्न', 'Reopen': 'फेरि खोल्नुहोस्', 'Edit': 'सच्याउनुहोस्', 'Created by': 'सिर्जनाकर्ता', 'Assigned': 'जिम्मा',
  'Phone': 'फोन', 'No open field visits': 'खुला फिल्ड भ्रमण छैन', 'Save': 'सुरक्षित', 'Search': 'खोज्नुहोस्', 'Task title is required': 'कार्यको शीर्षक आवश्यक छ',
  'Select Leave Type': 'बिदाको प्रकार छान्नुहोस्', 'days remaining': 'दिन बाँकी', 'Half Day': 'आधा दिन', 'Date': 'मिति', 'From Date': 'देखिको मिति', 'To Date': 'सम्मको मिति', 'No. of Days': 'दिन संख्या', 'Balance After': 'पछिको बाँकी',
  'Recommendator': 'सिफारिसकर्ता', 'Approval Authority': 'स्वीकृतिकर्ता', '— Not configured —': '— तोकिएको छैन —', 'Please choose one': 'कृपया एक जना छान्नुहोस्', 'Required field': 'आवश्यक', 'Cancel': 'रद्द',
  'Enter reason for leave...': 'बिदाको कारण लेख्नुहोस्', 'Minimum 5 characters required': 'कम्तीमा ५ अक्षर चाहिन्छ', 'Leave application submitted': 'बिदा आवेदन पेश भयो', 'Office visit application submitted': 'कार्यालय भ्रमण आवेदन पेश भयो',
  'Official Visit': 'आधिकारिक भ्रमण', 'Select Official Visit Type': 'भ्रमणको प्रकार छान्नुहोस्', 'Visit Type': 'भ्रमणको किसिम', 'National': 'राष्ट्रिय', 'International': 'अन्तर्राष्ट्रिय', 'Country': 'देश', 'Address': 'ठेगाना',
  'Late In time': 'ढिलो आउने समय', 'Early Out time': 'चाँडो जाने समय', 'Type the time like 1030 → 10:30 (24 hour)': 'समय यसरी लेख्नुहोस्: 1030 → 10:30 (२४ घण्टे)', 'Remark / Reason': 'कारण',
  'Request submitted — pending approval': 'अनुरोध पेश भयो — स्वीकृति बाँकी', 'Request submitted': 'अनुरोध पेश भयो', 'Missing punch': 'छुटेको पञ्च', 'Recorded': 'रेकर्ड भएको', 'now': 'अहिले', 'Remove': 'हटाउनुहोस्', 'Reason': 'कारण',
  'Check for app update': 'एप अपडेट जाँच्नुहोस्', 'Installed version': 'जडान भएको संस्करण', 'Close': 'बन्द', 'My requests': 'मेरा अनुरोध', 'Recommend': 'सिफारिस', 'Approve': 'स्वीकृत', 'Today': 'आज',
  'Late / Early': 'ढिलो / चाँडो', 'Online': 'अनलाइन', 'Late In / Early Out': 'ढिलो आगमन / चाँडो प्रस्थान', 'Check In / Check Out': 'चेक इन / चेक आउट',
  'Open map': 'नक्सा खोल्नुहोस्', 'Online Attendance': 'अनलाइन हाजिरी', 'Finding your location…': 'तपाईंको स्थान खोज्दै…', 'Location is off': 'स्थान बन्द छ',
  'Your current location': 'तपाईंको हालको स्थान', 'Finding the place name…': 'ठाउँको नाम खोज्दै…', 'Your location and phone are recorded': 'तपाईंको स्थान र फोन रेकर्ड हुन्छ',
  'Waiting for location': 'स्थानको प्रतिक्षा', 'Your approver has been notified': 'स्वीकृतिकर्तालाई जानकारी गरियो', "You've completed today's online attendance": 'आजको अनलाइन हाजिरी पूरा भयो',
  'Choose': 'छान्नुहोस्', 'Search': 'खोज्नुहोस्', 'Checked out': 'चेक आउट भयो',
  'Yesterday': 'हिजो', 'History': 'इतिहास', 'In': 'भित्र', 'Out': 'बाहिर', 'Late in': 'ढिलो आगमन', 'Early out': 'चाँडो प्रस्थान',
  'Late in & Early out': 'ढिलो आगमन र चाँडो प्रस्थान', 'this month': 'यो महिना', 'No punch recorded': 'पञ्च भेटिएन',
  'Tasks': 'कार्यहरू', 'No open tasks': 'खुला कार्य छैन', 'View all': 'सबै हेर्नुहोस्', 'Notices': 'सूचनाहरू', 'No notices yet': 'अझै सूचना छैन',
  'My Attendance': 'मेरो हाजिरी', 'Not confirmed — please try again': 'पुष्टि भएन — फेरि प्रयास गर्नुहोस्',
  'Sign in with fingerprint / face': 'फिङ्गरप्रिन्ट / अनुहारले साइन इन', 'Quick and secure': 'छिटो र सुरक्षित', 'Change': 'परिवर्तन',
  'Sign in faster next time?': 'अर्को पटक छिटो साइन इन गर्ने?', 'Not now': 'अहिले होइन', 'Enable': 'सक्रिय गर्नुहोस्',
  'Use your fingerprint or face instead of typing the password. Your password stays encrypted on this phone only.': 'पासवर्ड टाइप गर्नुको सट्टा फिङ्गरप्रिन्ट वा अनुहार प्रयोग गर्नुहोस्। पासवर्ड यही फोनमा इन्क्रिप्ट गरेर मात्र राखिन्छ।',
  'Fingerprint / face sign-in': 'फिङ्गरप्रिन्ट / अनुहार साइन इन', 'Off': 'बन्द', 'On — tap to turn off': 'खुला — बन्द गर्न थिच्नुहोस्',
  'Your password has changed — please sign in with your password': 'पासवर्ड परिवर्तन भयो — पासवर्डले साइन इन गर्नुहोस्',
  'Home': 'गृह', 'Attendance': 'हाजिरी', 'Leave': 'बिदा', 'Inbox': 'सन्देश', 'More': 'थप',
  'Good morning': 'शुभ प्रभात', 'Good afternoon': 'शुभ दिन', 'Good evening': 'शुभ साँझ',
  'Today': 'आज', 'Present': 'उपस्थित', 'Absent': 'अनुपस्थित', 'Late': 'ढिला', 'On leave': 'बिदामा',
  'Check In': 'चेक इन', 'Check Out': 'चेक आउट', 'Checked in': 'चेक इन भयो', 'Done for today': 'आजको काम सकियो',
  'Quick actions': 'छिटो काम', 'Apply Leave': 'बिदा माग्नुहोस्', 'Office Visit': 'कार्यालय भ्रमण',
  'Late / Early': 'ढिला / चाँडो', 'Missing punch': 'छुटेको पञ्च', 'Leave balance': 'बिदा बाँकी',
  'Pending approvals': 'स्वीकृति बाँकी', 'My requests': 'मेरा अनुरोध', 'To approve': 'स्वीकृतिका लागि',
  'Approve': 'स्वीकृत', 'Reject': 'अस्वीकार', 'Recommend': 'सिफारिस', 'Pending': 'पर्खाइमा', 'Approved': 'स्वीकृत',
  'Rejected': 'अस्वीकृत', 'Recommended': 'सिफारिस गरिएको', 'Sign in': 'साइन इन', 'Sign out': 'साइन आउट',
  'Username or email': 'प्रयोगकर्ता वा इमेल', 'Password': 'पासवर्ड', 'Show': 'देखाउनुहोस्', 'Hide': 'लुकाउनुहोस्',
  'Language': 'भाषा', 'My Payslips': 'मेरो पेस्लिप', 'Help & Support': 'सहायता', 'Profile': 'प्रोफाइल',
  'Nothing here yet': 'अहिले केही छैन', 'Comment (optional)': 'टिप्पणी (ऐच्छिक)', 'Cancel': 'रद्द', 'Confirm': 'पुष्टि',
  'Present days': 'उपस्थित', 'Absent days': 'अनुपस्थित', 'Leave days': 'बिदा', 'Late days': 'ढिला',
  'Weekend': 'बिदा (शनिबार)', 'Holiday': 'सार्वजनिक बिदा', 'days': 'दिन', 'day': 'दिन', 'Days': 'दिन',
  'Unread': 'नपढिएको', 'Messages': 'सन्देशहरू', 'No connection': 'इन्टरनेट छैन', 'Try again': 'फेरि प्रयास',
  'Welcome': 'स्वागत छ', 'Your office, in your pocket': 'तपाईंको कार्यालय, तपाईंको हातमा',
};
/* Wording supplied by the client — overrides any earlier entry above. */
Object.assign(NP, {
  'Check In': 'आएको समय', 'Check Out': 'गएको समय', 'Check in Time': 'आएको समय', 'Check out Time': 'गएको समय',
  'Check In / Check Out': 'आएको समय / गएको समय',
  'Leave Application': 'बिदाको निवेदन', 'Apply Leave': 'बिदाको निवेदन',
  'Office Visit Application': 'काज तथा भ्रमणको निवेदन', 'Office Visit': 'काज भ्रमण निवेदन',
  'Pending': 'प्रक्रियारत', 'My requests': 'मेरो निवेदन', 'My Request': 'मेरो निवेदन',
  'Late In / Early Out': 'ढिला आउने / चाडो जाने निवेदन', 'Late / Early': 'ढिला आउने / चाडो जाने निवेदन',
  'Late in and Early out': 'ढिलो आएको / चाडो गएको', 'Late in': 'ढिलो आएको', 'Early out': 'चाडो गएको',
  'IN & OUT': 'आएको - गएको', 'Staff': 'कर्मचारी विवरण',
});
/** t(en) → नेपाली when the app language is Nepali and a translation exists; otherwise the English text. */
export function useMT() {
  const { language } = useLanguage();
  return (s) => (language === 'np' && NP[s]) || s;
}
