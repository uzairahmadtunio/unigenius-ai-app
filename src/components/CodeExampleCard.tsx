import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/MarkdownMessage";
import type { CodeExample } from "@/lib/notes-reader";

const RUNNABLE_IN_CODE_LAB = new Set(["cpp", "c", "python", "javascript", "java"]);

/**
 * One code example from a topic page: explanation, highlighted code
 * (with copy, via the shared CodeBlock), and a "Run in Code Lab"
 * handoff — CodeLabPage consumes the sessionStorage prefill on mount.
 */
const CodeExampleCard = ({ example }: { example: CodeExample }) => {
  const navigate = useNavigate();
  const lang = (example.language || "cpp").toLowerCase();
  const runnable = RUNNABLE_IN_CODE_LAB.has(lang);

  const runInCodeLab = () => {
    try {
      sessionStorage.setItem(
        "ug-codelab-prefill",
        JSON.stringify({ code: example.code, language: lang }),
      );
    } catch { /* storage unavailable — Code Lab still opens */ }
    navigate("/code-lab");
  };

  return (
    <div className="space-y-2">
      {example.title && (
        <h4 className="font-display font-semibold text-sm text-foreground">{example.title}</h4>
      )}
      <CodeBlock language={lang} code={example.code} />
      {example.explanation && (
        <p className="text-sm leading-relaxed text-muted-foreground">{example.explanation}</p>
      )}
      {runnable && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-xl text-xs gap-1.5"
          onClick={runInCodeLab}
        >
          <Play className="w-3.5 h-3.5" /> Run in Code Lab
        </Button>
      )}
    </div>
  );
};

export default CodeExampleCard;
