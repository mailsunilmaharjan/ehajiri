import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import TopMenu from './TopMenu.jsx';
import GlobalFAB from './GlobalFAB.jsx';
import LeaveApplyModal from '../Leave/LeaveApplyModal.jsx';
import OfficeVisitApplyModal from '../OfficeVisit/OfficeVisitApplyModal.jsx';
import MissingAttendanceApplyModal from '../Attendance/MissingAttendanceApplyModal.jsx';
import ManualPostingApplyModal from '../Attendance/ManualPostingApplyModal.jsx';
import OnlineAttendanceApplyModal from '../Attendance/OnlineAttendanceApplyModal.jsx';
import { LeaveApplyProvider } from '../../context/LeaveApplyContext.jsx';
import { OfficeVisitApplyProvider } from '../../context/OfficeVisitApplyContext.jsx';
import { MissingAttendanceApplyProvider } from '../../context/MissingAttendanceApplyContext.jsx';
import { ManualPostingApplyProvider } from '../../context/ManualPostingApplyContext.jsx';
import { OnlineAttendanceApplyProvider } from '../../context/OnlineAttendanceApplyContext.jsx';
import { AttendanceNotificationProvider } from '../Notifications/AttendanceToasts.jsx';
import { ChatProvider } from '../../context/ChatContext.jsx';
import ChatDock from '../Chat/ChatDock.jsx';
import SupportChat from '../Support/SupportChat.jsx';
import NativeBridge from '../Common/NativeBridge.jsx';
import { isMobileMode } from '../../utils/native.js';

const MobileFrame = React.lazy(() => import('../../mobile/MobileFrame.jsx'));
const MobileCheckIn = React.lazy(() => import('../../mobile/MobileCheckIn.jsx'));
const MobileForms = React.lazy(() => import('../../mobile/MobileForms.jsx'));
import { useModuleFlags } from '../../context/ModuleFlagsContext.jsx';

/**
 * Global modal keyboard behaviour (applies to every modal in the app):
 *  • ESC  → clicks the topmost .modal-close button (closes the modal)
 *  • Enter → acts as Tab (moves focus to the next focusable element inside the modal)
 *  • On open → auto-focuses the first text/select input in the newly added overlay
 */
const Layout = ({ children }) => {
  const { flags: moduleFlags } = useModuleFlags();
  const location = useLocation();

  /* ── 0. Scroll to top on every route change — the window (not a nested
     container) is what actually scrolls in this layout (see .main-layout,
     no overflow set), and React Router doesn't reset that on navigation.
     Without this, clicking a nav link while scrolled down on a long page
     (e.g. the Task grid) landed on the new page still scrolled down,
     showing whatever content happened to be at that old offset instead of
     the top of the page just navigated to. */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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

      /* Enter → Tab (skip buttons, textareas, checkboxes, radios, and any
         contentEditable element — RichTextEditor's description field is a
         contentEditable <div>, and without this exclusion Enter there was
         being hijacked into a focus-jump instead of inserting a newline). */
      if (e.key === 'Enter') {
        const tag   = e.target.tagName;
        const type  = e.target.type;
        if (
          tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' ||
          type === 'submit'  || type === 'checkbox' || type === 'radio' ||
          e.target.isContentEditable
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

  /* ── 2. Auto-focus first input when a modal opens ── */
  useEffect(() => {
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
          <ManualPostingApplyProvider>
            <OnlineAttendanceApplyProvider>
              <AttendanceNotificationProvider>
                <ChatProvider>
                  {isMobileMode() ? (
                    <React.Suspense fallback={null}><MobileFrame>{children}</MobileFrame></React.Suspense>
                  ) : (
                    <>
                      <TopMenu />
                      <main className="main-layout">
                        {children}
                      </main>
                      <GlobalFAB />
                    </>
                  )}
                  {isMobileMode() ? (
                    <React.Suspense fallback={null}><MobileForms /></React.Suspense>
                  ) : (
                    <>
                      <LeaveApplyModal />
                      <OfficeVisitApplyModal />
                      <MissingAttendanceApplyModal />
                      <ManualPostingApplyModal />
                    </>
                  )}
                  {isMobileMode()
                    ? <React.Suspense fallback={null}><MobileCheckIn /></React.Suspense>
                    : <OnlineAttendanceApplyModal />}
                  {moduleFlags.chatEnabled && <ChatDock />}
                  {moduleFlags.supportHelpEnabled !== false && <SupportChat />}
                  <NativeBridge />
                </ChatProvider>
              </AttendanceNotificationProvider>
            </OnlineAttendanceApplyProvider>
          </ManualPostingApplyProvider>
        </MissingAttendanceApplyProvider>
      </OfficeVisitApplyProvider>
    </LeaveApplyProvider>
  );
};

export default Layout;
