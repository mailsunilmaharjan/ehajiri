/** Small coloured toolbar icons (inline SVG, no downloads). */
const S = ({ children, vb = '0 0 24 24' }) => (
  <svg className="tico" viewBox={vb} width="17" height="17" aria-hidden="true">{children}</svg>
);

export const IcoMail = () => (
  <S>
    <rect x="2.5" y="5" width="19" height="14" rx="2.2" fill="#fff" stroke="#EA4335" strokeWidth="1.7" />
    <path d="M3.5 6.5 12 13l8.5-6.5" fill="none" stroke="#EA4335" strokeWidth="1.9" strokeLinejoin="round" />
    <path d="M2.5 17.5 9 12M21.5 17.5 15 12" stroke="#FBBC04" strokeWidth="1.4" />
  </S>
);

export const IcoWhatsApp = () => (
  <S vb="0 0 32 32">
    <path fill="#25D366" d="M16 3C8.9 3 3.2 8.6 3.2 15.6c0 2.5.7 4.8 2 6.8L3 29l6.8-2.1c1.9 1 4 1.6 6.2 1.6 7.1 0 12.8-5.6 12.8-12.6S23.1 3 16 3z" />
    <path fill="#fff" d="M11.6 9.6c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.8 4.5 7 6.1 3.5 1.4 4.2 1.1 4.9 1 .8-.1 2.4-1 2.8-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5s-2.4-1.2-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.6-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.2-1.2-3z" />
  </S>
);

export const IcoSms = () => (
  <S>
    <path fill="#3B82F6" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <circle cx="8" cy="10.5" r="1.3" fill="#fff" /><circle cx="12" cy="10.5" r="1.3" fill="#fff" /><circle cx="16" cy="10.5" r="1.3" fill="#fff" />
  </S>
);

export const IcoPrint = () => (
  <S>
    <rect x="6.5" y="3" width="11" height="5" rx="1" fill="#93C5FD" />
    <rect x="3" y="8" width="18" height="9" rx="2" fill="#475569" />
    <rect x="6.5" y="13" width="11" height="8" rx="1" fill="#fff" stroke="#475569" strokeWidth="1.4" />
    <circle cx="17.5" cy="11" r="1" fill="#4ADE80" />
  </S>
);

export const IcoExport = () => (
  <S>
    <path d="M12 3v11" stroke="#16A34A" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M7.5 10 12 14.5 16.5 10" fill="none" stroke="#16A34A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" />
  </S>
);

export const IcoEdit = () => (
  <S>
    <path fill="#2563EB" d="M15.2 4.3a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L9 19.5 4 20l.5-5z" />
    <path fill="#BFDBFE" d="M4.5 15 9 19.5 4 20z" />
  </S>
);

export const IcoCancel = () => (
  <S>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="#D97706" strokeWidth="2.2" />
    <path d="M6 6l12 12" stroke="#D97706" strokeWidth="2.2" />
  </S>
);

export const IcoDelete = () => (
  <S>
    <path fill="#DC2626" d="M9 3h6l1 2h4v2H4V5h4z" />
    <path fill="#F87171" d="M6 8h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 20z" />
    <path d="M10 11v7M14 11v7" stroke="#fff" strokeWidth="1.6" />
  </S>
);

export const IcoReturn = () => (
  <S>
    <path d="M9 7 4 12l5 5" fill="none" stroke="#7C3AED" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 12h10a6 6 0 0 1 0 12" fill="none" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round" transform="translate(0 -5)" />
  </S>
);

export const IcoNext = () => (
  <S>
    <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="#0891B2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

export const IcoClose = () => (
  <S>
    <circle cx="12" cy="12" r="9" fill="#F1F5F9" />
    <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
  </S>
);
