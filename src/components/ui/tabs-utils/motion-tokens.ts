export const motionTokens = {
  spring: {
    morph: { type: "spring", stiffness: 460, damping: 36, mass: 0.85 } as const,
    smooth: { type: "spring", stiffness: 360, damping: 34, mass: 0.9 } as const,
  },
  duration: {
    instant: 0.12,
    fast: 0.16,
    standard: 0.24,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    standard: [0.22, 1, 0.36, 1] as const,
  },
} as const;
