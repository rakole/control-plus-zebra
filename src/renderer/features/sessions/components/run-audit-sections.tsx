import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import type { RunAuditSection } from "../types.js";

interface RunAuditSectionsProps {
  sections: RunAuditSection[];
}

export function RunAuditSections({ sections }: RunAuditSectionsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {sections.map((section) => (
        <SectionCard
          key={section.id}
          title={<span id={section.id}>{section.title}</span>}
          description={section.summary}
          aria-labelledby={section.id}
        >
          <MetadataGrid
            items={section.items.map((item) => ({
              label: item.label,
              value: item.hint ? (
                <span className="space-y-1">
                  <span className="block">{item.value}</span>
                  <span className="block text-xs/relaxed text-muted-foreground">
                    {item.hint}
                  </span>
                </span>
              ) : (
                item.value
              )
            }))}
          />
        </SectionCard>
      ))}
    </div>
  );
}
