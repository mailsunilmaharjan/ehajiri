import React, { useEffect } from 'react';
import TopMenu from './TopMenu.jsx';
import GlobalFAB from './GlobalFAB.jsx';
import LeaveApplyModal from '../Leave/LeaveApplyModal.jsx';
import OfficeVisitApplyModal from '../OfficeVisit/OfficeVisitApplyModal.jsx';
import MissingAttendanceApplyModal from '../Attendance/MissingAttendanceApplyModal.jsx';
import { LeaveApplyProvider } from '../../context/LeaveApplyContext.jsx';
import { OfficeVisitApplyProvider } from '../../context/OfficeVisitApplyContext.jsx';
import { MissingAttendanceApplyProvider } from '../../context/MissingAttendanceApplyContext.jsx';
import { AttendanceNotificationProvider } from '../Notifications/AttendanceToasts.jsx';
import { ChatProvider } from '../../context/ChatContext.jsx';
import ChatDock from '../Chat/ChatDock.jsx';

/**
 * Global modal keyboard behaviour (applies to every modal in the app):
 *  • ESC  → clicks the topmost .modal-close button (closes the modal)
 *  • Enter → acts as Tab (moves focus to the next focusable element inside the modal)
 *  • On open → auto-focuses the first text/select input in the newly added overlay
 */
const Layout = ({ children }) => {

  /* ── 1. ESC + Enter-as-Tab ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Find the topmost open modal overlay
      const overlays = document.querySelectorAll('.modal-overlay');
      if (!overlays.length) return;
      const overlay = overlays[overlays.length - 1]; // last = topmost

      /* ESC → close */
      if (e.key === 'Escape') {
        const closeBtn = overlay.querySelector('.modal-close');
        if (closeBtn) closeBtn.click();
        return;
      }

      /* Enter → Tab (skip buttons, textareas, checkboxes, radios) */
      if (e.key === 'Enter') {
        const tag   = e.target.tagName;
        const type  = e.target.type;
        if (
          tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' ||
          type === 'submit'  || type === 'checkbox' || type === 'radio'
        ) return;

        e.preventDefault();
        const focusable = Array.from(overlay.querySelectorAll(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
        ));
        const idx = focusable.indexOf(document.activeElement);
        if (idx > -1 && idx < focusable.length - 1) {
          focusable[idx + 1].focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ── 2. Auto-focus first input + inject bubbles when a modal opens ── */
  useEffect(() => {
    const injectBubbles = (header) => {
      if (header.querySelector('.modal-header-bubble')) return; // already injected
      for (let i = 0; i < 10; i++) {
        const b = document.createElement('span');
        b.className = 'modal-header-bubble';
        header.appendChild(b);
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          // Find the modal-overlay that was just added
          let overlay = null;
          if (node.classList?.contains('modal-overlay')) {
            overlay = node;
          } else {
            overlay = node.querySelector?.('.modal-overlay');
          }
          if (!overlay) continue;

          // Inject bubbles into the modal header
          setTimeout(() => {
            const header = overlay.querySelector('.modal-header');
            if (header) injectBubbles(header);
          }, 10);

          // Defer focus so React finishes rendering all inputs inside
          setTimeout(() => {
            const firstInput = overlay.querySelector(
              'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select:not([disabled])'
            );
            if (firstInput) firstInput.focus();
          }, 30);

          break; // only process the first new overlay per mutation batch
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <LeaveApplyProvider>
      <OfficeVisitApplyProvider>
        <MissingAttendanceApplyProvider>
          <AttendanceNotificationProvider>
            <ChatProvider>
              <TopMenu />
              <main className="main-layout">
                {children}
              </main>
              <GlobalFAB />
              <LeaveApplyModal />
              <OfficeVisitApplyModal />
              <MissingAttendanceApplyModal />
              <ChatDock />
            </ChatProvider>
          </AttendanceNotificationProvider>
        </MissingAttendanceApplyProvider>
      </OfficeVisitApplyProvider>
    </LeaveApplyProvider>
  );
};

export default Layout;
