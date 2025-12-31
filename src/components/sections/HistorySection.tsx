import { Clock, Timer } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";

export function HistorySection() {
  return (
    <SectionLayout
      title="History"
      description="Past transcriptions and statistics"
    >
      {/* Time Saved Stats - Placeholder */}
      <Card className="py-6 flex flex-col items-center justify-center text-center opacity-50">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500/20 via-violet-500/20 to-blue-500/20 flex items-center justify-center mb-3">
          <Timer size={ICON_SIZES.lg} className="text-primary" />
        </div>
        <h3 className="text-[13px] font-medium text-foreground mb-1">
          Time Saved
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Track how much time you've saved using voice transcription
        </p>
      </Card>

      {/* History List - Placeholder */}
      <Card className="py-12 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-4">
          <Clock size={ICON_SIZES.lg} className="text-muted-foreground" />
        </div>
        <h3 className="text-[13px] font-medium text-foreground mb-1">
          Coming Soon
        </h3>
        <p className="text-[11px] text-muted-foreground max-w-[280px]">
          View your transcription history, see costs, compare raw vs processed text,
          and retry transcriptions with different settings.
        </p>
      </Card>
    </SectionLayout>
  );
}
