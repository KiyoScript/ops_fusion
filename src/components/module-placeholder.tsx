import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export function ModulePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} badge={phase} />
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          This module is scheduled for {phase}. Nothing here yet.
        </CardContent>
      </Card>
    </>
  );
}
