import { Toaster as Sonner } from 'sonner';

export function Toaster(props) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast group-[.toaster]:bg-surface-2 group-[.toaster]:text-text-primary group-[.toaster]:border-edge group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
          description: 'group-[.toast]:text-text-tertiary',
          actionButton: 'group-[.toast]:bg-accent group-[.toast]:text-white',
          cancelButton: 'group-[.toast]:bg-surface-3 group-[.toast]:text-text-secondary',
        },
      }}
      {...props}
    />
  );
}
