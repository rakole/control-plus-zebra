import { Skeleton } from "../../../components/ui/skeleton.js";
import { MasterDetailLayout } from "../../../components/app/master-detail-layout.js";

export function DataSourcesLoadingState() {
  return (
    <div aria-label="Data Sources loading">
      <MasterDetailLayout
        masterLabel="Loading data sources"
        detailLabel="Loading selected data source"
        master={
          <div className="space-y-2 p-4">
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-24" />
                </div>
              </div>
            ))}
          </div>
        }
        detail={
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-6 w-2/3" />
            </div>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        }
      />
    </div>
  );
}
