import { cn } from '../../lib/utils.js';

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-3/50', className)}
      {...props}
    />
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <Skeleton className="h-4 w-6" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-20 ml-auto" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-2 w-32 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-8 w-32 mb-4" />
      <div className="border-t border-edge pt-3 flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export { Skeleton, SkeletonRow, SkeletonCard };
