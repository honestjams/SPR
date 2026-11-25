"use client";

import { motion, type HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-text text-bg",
  secondary: "bg-surface text-text border border-border",
  ghost: "bg-transparent text-muted",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: HTMLMotionProps<"button"> & { variant?: Variant }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold
        transition-opacity disabled:opacity-40 disabled:pointer-events-none ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}
