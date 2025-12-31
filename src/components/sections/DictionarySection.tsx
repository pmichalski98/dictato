import { BookText } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";

export function DictionarySection() {
  return (
    <SectionLayout
      title="Dictionary"
      description="Custom words and terminology"
    >
      <Card className="py-12 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-4">
          <BookText size={ICON_SIZES.lg} className="text-muted-foreground" />
        </div>
        <h3 className="text-[13px] font-medium text-foreground mb-1">
          Coming Soon
        </h3>
        <p className="text-[11px] text-muted-foreground max-w-[250px]">
          Add custom words and technical terms that the AI might not recognize correctly,
          ensuring accurate transcriptions every time.
        </p>
      </Card>
    </SectionLayout>
  );
}
