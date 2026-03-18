import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";

interface LeadStatusBadgeProps {
  status: "new" | "measurement" | "offer" | "deal" | "done";
  className?: string;
}

const statusConfig = {
  new: {
    label: "Новый",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  measurement: {
    label: "Замер",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
  offer: {
    label: "Предложение",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  deal: {
    label: "Сделка",
    color: "bg-orange-100 text-orange-700 border-orange-200",
  },
  done: {
    label: "Завершен",
    color: "bg-green-100 text-green-700 border-green-200",
  },
};

export function LeadStatusBadge({ status, className }: LeadStatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge
      variant="outline"
      className={cn(config.color, className)}
    >
      {config.label}
    </Badge>
  );
}
