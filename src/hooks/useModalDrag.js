import { useRef } from 'react';

/**
 * Prevents a modal from closing when the user starts a drag INSIDE the modal
 * and releases the mouse OUTSIDE on the overlay.
 *
 * Usage:
 *   const { overlayProps, modalProps } = useModalDrag(onClose);
 *
 *   <div className="modal-overlay" {...overlayProps}>
 *     <div className="modal modal-md" {...modalProps}>
 *       ...
 *     </div>
 *   </div>
 *
 * Rules:
 *  - Click that starts AND ends on the overlay  → closes
 *  - Click/drag that starts INSIDE the modal    → never closes, even if released outside
 */
export function useModalDrag(onClose) {
  const startedInsideModal = useRef(false);

  const overlayProps = {
    onMouseDown: () => { startedInsideModal.current = false; },
    onClick: (e) => {
      if (!startedInsideModal.current && e.target === e.currentTarget) onClose();
    },
  };

  const modalProps = {
    onMouseDown: (e) => {
      e.stopPropagation();           // keep overlay blind to this mousedown
      startedInsideModal.current = true;
    },
    onClick: (e) => e.stopPropagation(),
  };

  return { overlayProps, modalProps };
}
