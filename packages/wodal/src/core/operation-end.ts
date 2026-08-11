/**
 * How an operation offered to a leased device subsystem ended. A subsystem that
 * holds one operation at a time reports one of these once per operation it was
 * offered, the dropped ones included.
 */
export const OperationEnd = {
  /** The operation held the subsystem for its whole duration and finished. */
  Completed: "completed",
  /** The subsystem would not take the operation, so nothing ran. */
  Dropped: "dropped",
  /** Another operation took the subsystem before this one finished. */
  Preempted: "preempted",
} as const;

/** How an operation offered to a leased device subsystem ended. */
export type OperationEnd = (typeof OperationEnd)[keyof typeof OperationEnd];

/**
 * Called once with how an operation offered to a leased subsystem ended, at the
 * moment it ends.
 */
export type OperationEndListener = (end: OperationEnd) => void;
