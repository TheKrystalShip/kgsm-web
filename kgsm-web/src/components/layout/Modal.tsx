import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  modalType?: string; // Added to support different modal styles
}

/**
 * Reusable modal component
 */
const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, width, modalType }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle clicking outside the modal to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Handle escape key to close modal
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Prevent scrolling of the body when modal is open
    if (isOpen) {
      // Add modal-open class to body to prevent scrolling
      document.body.classList.add('modal-open');
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      // Remove modal-open class from body
      document.body.classList.remove('modal-open');
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Determine modal size based on modalType
  const getModalSizeClass = () => {
    if (modalType === 'console') return 'modal-dialog-xl';
    return '';
  };

  // Create the modal content
  const modalContent = (
    <div className={`modal ${isOpen ? 'show' : ''}`} data-testid="modal-backdrop">
      <div
        className={`modal-dialog ${getModalSizeClass()}`}
        ref={modalRef}
        data-modal-type={modalType}
        style={width && !modalType ? { width: width, maxWidth: '95%' } : undefined}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );

  // Render the modal using a portal to bypass parent container constraints
  return createPortal(modalContent, document.body);
};

export default Modal;
