import { DiagnosticsList } from "../../../components/app/diagnostics-list.js";
import { SectionCard } from "../../../components/app/section-card.js";

type DiagnosticsResponse = Awaited<ReturnType<Window["agentWorkbench"]["listDiagnostics"]>>;
type DiagnosticsView = Extract<DiagnosticsResponse, { ok: true }>["diagnostics"];

interface DiagnosticsGroupsProps {
  groups: DiagnosticsView["groups"];
}

export function DiagnosticsGroups({ groups }: DiagnosticsGroupsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <section aria-label={group.title} key={group.groupId}>
          <SectionCard
            title={<h2>{group.title}</h2>}
            description={`${capitalize(group.sourceArea)} diagnostics`}
            contentClassName="space-y-0"
          >
            <DiagnosticsList
              title="Diagnostics"
              diagnostics={group.diagnostics.map((diagnostic, index) => ({
                id: `${group.groupId}:${diagnostic.code}:${index}`,
                severity: diagnostic.severity,
                message: diagnostic.message,
                detail: (
                  <span className="flex flex-wrap gap-1">
                    <span>{diagnostic.adapterDisplayName}</span>
                    {diagnostic.sessionTitle ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{diagnostic.sessionTitle}</span>
                      </>
                    ) : null}
                    {diagnostic.projectDisplayName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{diagnostic.projectDisplayName}</span>
                      </>
                    ) : null}
                  </span>
                )
              }))}
            />
          </SectionCard>
        </section>
      ))}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
