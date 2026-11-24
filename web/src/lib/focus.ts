/**
 * The app's keyboard focus ring (doc 6 §5): a 2px --primary outline with a 2px offset. Added after a ui/*
 * component's own classes, it also switches off shadcn's 3px translucent ring (tailwind-merge keeps the last one).
 */
export const FOCUS_RING = 'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary';
