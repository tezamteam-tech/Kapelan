import { Badge } from "./ui/badge";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "../utils/clipboard";

interface SessionInfoProps {
  sessionId: string;
}

export function SessionInfo({ sessionId }: SessionInfoProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="font-mono text-xs">
        Session: {sessionId.substring(0, 20)}...
      </Badge>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-gray-100 rounded transition-colors"
        title="Копировать Session ID"
      >
        {copied ? (
          <Check className="size-4 text-green-600" />
        ) : (
          <Copy className="size-4 text-gray-400" />
        )}
      </button>
    </div>
  );
}
