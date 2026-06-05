import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface StatusOption {
  label: string;
  index: number;
}

interface Props {
  label: string;
  value?: string;
  options: StatusOption[];
  onChange: (label: string) => void;
}

function badgeColor(val?: string): string {
  if (!val) return "border-muted";
  const v = val.toLowerCase();
  if (v === "valid" || v === "yes" || v === "yes & valid" || v === "mr received" || v === "established" || v === "complete" || v === "ready") return "border-emerald-300 bg-emerald-50";
  if (v === "collect") return "border-amber-300 bg-amber-50";
  if (v === "evaluate" || v === "generate") return "border-blue-300 bg-blue-50";
  if (v === "not serving" || v === "not needed") return "border-gray-200 bg-gray-50";
  if (v === "invalid" || v === "missing" || v === "no" || v === "yes, but invalid" || v === "not established" || v === "escalate" || v === "stuck") return "border-red-300 bg-red-50";
  if (v === "insulin") return "border-sky-300 bg-sky-50";
  if (v === "hypo") return "border-violet-300 bg-violet-50";
  if (v.startsWith("attempt")) return "border-blue-200 bg-blue-50";
  if (v.startsWith("e1") || v.startsWith("e0") || v.startsWith("o2")) return "border-violet-200 bg-violet-50";
  return "border-muted";
}

export function StatusSelect({ label, value, options, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50">
      <span className="text-sm text-muted-foreground whitespace-nowrap">{label}</span>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className={`w-[160px] h-8 text-xs font-medium ${badgeColor(value)}`}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.index} value={opt.label} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
