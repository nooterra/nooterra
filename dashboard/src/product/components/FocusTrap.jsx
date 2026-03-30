import { useEffect, useRef } from 'react';

export default function FocusTrap({ children, active = true }) {
  const ref = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement;

    const el = ref.current;
    if (!el) return;

    // Focus first focusable element
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length) focusable[0].focus();

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return;
      const focusableEls = el.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      if (previousFocus.current) previousFocus.current.focus();
    };
  }, [active]);

  return <div ref={ref}>{children}</div>;
}
