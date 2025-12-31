import { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  description: string;
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

interface SectionLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function SectionLayout({
  title,
  description,
  children,
}: SectionLayoutProps) {
  return (
    <div className="p-5 space-y-4">
      <SectionHeader title={title} description={description} />
      {children}
    </div>
  );
}
