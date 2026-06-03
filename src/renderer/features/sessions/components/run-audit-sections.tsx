import { MetadataGrid } from "../../../components/app/metadata-grid.js";
import { SectionCard } from "../../../components/app/section-card.js";
import { Button } from "../../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../../../components/ui/dialog.js";
import { ScrollArea } from "../../../components/ui/scroll-area.js";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { RunAuditItem, RunAuditSection } from "../types.js";

interface RunAuditSectionsProps {
  sections: RunAuditSection[];
}

SyntaxHighlighter.registerLanguage("bash", bash);

const commandHighlightTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] ?? {}),
    margin: 0,
    background: "transparent",
    padding: 0
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] ?? {}),
    background: "transparent",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: "0.75rem",
    lineHeight: "1.5"
  }
} as const;

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
              ...(item.tone ? { tone: item.tone } : {}),
              value: renderRunAuditItemValue(item)
            }))}
          />
        </SectionCard>
      ))}
    </div>
  );
}

function renderRunAuditItemValue(item: RunAuditItem) {
  if (item.kind === "command-list") {
    if (item.commands && item.commands.length > 0) {
      return <CommandListValue commands={item.commands} />;
    }

    return <span>{item.value}</span>;
  }

  if (item.hint) {
    return (
      <span className="space-y-1">
        <span className="block">{item.value}</span>
        <span className="block text-xs/relaxed text-muted-foreground">{item.hint}</span>
      </span>
    );
  }

  return item.value;
}

function CommandListValue({
  commands
}: {
  commands: Array<{ command: string; result: string }>;
}) {
  const previewCommands = commands.slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {previewCommands.map((command, index) => (
          <CommandCard
            key={`${command.command}-${command.result}-${index}`}
            command={command}
            index={index}
          />
        ))}
      </div>

      {commands.length > previewCommands.length ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-center">
              View all {commands.length} commands
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl p-0 sm:max-w-3xl">
            <DialogHeader className="border-b border-border/70 px-5 py-4">
              <DialogTitle>All Session Commands</DialogTitle>
              <DialogDescription>
                Review every captured command for this session without leaving Run Audit.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea type="always" className="h-[min(32rem,calc(100vh-10rem))] px-5 py-4">
              <div className="space-y-3 pr-4">
                {commands.map((command, index) => (
                  <CommandCard
                    key={`${command.command}-${command.result}-dialog-${index}`}
                    command={command}
                    index={index}
                  />
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function CommandCard({
  command,
  index
}: {
  command: { command: string; result: string };
  index: number;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background/80">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-background/95 px-3 py-2">
        <span className={getCommandResultBadgeClassName(command.result)}>{command.result}</span>
        <span className="text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
          Command {index + 1}
        </span>
      </div>
      <div className="relative">
        <div className="px-3 py-3">
          <SyntaxHighlighter
            language="bash"
            style={commandHighlightTheme}
            wrapLongLines
            customStyle={{
              margin: 0,
              width: "100%",
              background: "transparent",
              padding: 0
            }}
            codeTagProps={{
              className: "font-mono"
            }}
            PreTag="pre"
          >
            {command.command}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
}

function getCommandResultBadgeClassName(result: string) {
  switch (result) {
    case "Failed":
      return "inline-flex items-center rounded-full border border-red-500/40 bg-red-500/12 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-red-200";
    case "Succeeded":
      return "inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/12 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-emerald-200";
    case "Running":
      return "inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/12 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-sky-200";
    case "Cancelled":
      return "inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-200";
    default:
      return "inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground";
  }
}
