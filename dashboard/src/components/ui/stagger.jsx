import { motion, useReducedMotion } from 'motion/react';

/**
 * Staggered fade-in animation for list items.
 * Each child fades up with increasing delay.
 */
export function StaggerList({ children, className, stagger = 0.04, ...props }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} {...props}>{children}</div>;

  return (
    <div className={className} {...props}>
      {Array.isArray(children) ? children.map((child, i) => (
        <motion.div
          key={child?.key ?? i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.25,
            delay: i * stagger,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {child}
        </motion.div>
      )) : children}
    </div>
  );
}

/**
 * Single item fade-in from below.
 */
export function FadeIn({ children, delay = 0, className, ...props }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} {...props}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Smooth expand/collapse with spring physics.
 * Uses grid-template-rows trick for height animation.
 */
export function Collapse({ open, children, className }) {
  return (
    <motion.div
      initial={false}
      animate={{
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
      }}
      transition={{
        height: { type: 'spring', stiffness: 500, damping: 40 },
        opacity: { duration: 0.15 },
      }}
      style={{ overflow: 'hidden' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
